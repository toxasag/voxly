import type { FastifyInstance } from "fastify";
import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { query, queryOne, transaction, type TransactionClient } from "../../db/client.js";
import { AppError, UnauthorizedError } from "../../plugins/errorHandler.js";
import { getEnv } from "../../config/env.js";
import { OWNER_PERMISSIONS, toPermissions } from "../../config/permissions.js";
import type { Permission, PlatformRole, Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: Role;
    platform_role: PlatformRole | null;
    permissions: Permission[];
  };
  tenant: {
    id: string;
    name: string;
    /** Personal subdomain: {slug}.getvoxly.ru. */
    slug: string;
    plan: string;
    status: string;
    custom_price_rubles?: number | null;
    custom_plan_name?: string | null;
  };
}

interface AuthUserRow {
  id: string;
  tenant_id: string;
  email: string;
  phone: string;
  name: string;
  role: Role;
  platform_role: PlatformRole | null;
  permissions: string[] | null;
  password_hash: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_plan: string;
  tenant_status: string;
  tenant_custom_price_rubles?: number | null;
  tenant_custom_plan_name?: string | null;
}

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date | string;
}

interface RefreshRow {
  id: string;
  user_id: string;
  tenant_id: string;
  revoked_at: Date | string | null;
  expires_at: Date | string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Deliberately identical for unknown phone, wrong code and expired code. */
class InvalidCredentialsError extends UnauthorizedError {
  constructor(message = "Invalid credentials") {
    super(message);
  }
}

class OtpAttemptsExceededError extends AppError {
  constructor() {
    super(429, "OTP_ATTEMPTS_EXCEEDED", "Too many attempts. Request a new code.");
  }
}

/**
 * Outcome of an OTP verification, returned from the transaction as a value.
 *
 * Required because the attempt counter and the consume marker must commit, and
 * an exception thrown inside the transaction body rolls them back along with the
 * useful work.
 */
type VerifyOtpOutcome =
  | { kind: "ok"; tokens: AuthTokens }
  | { kind: "unknown" }
  | { kind: "attempts_exceeded" }
  | { kind: "expired" }
  | { kind: "wrong_code" };

/**
 * Outcome of a refresh-token rotation, returned as a value for the same reason:
 * detecting reuse must revoke the whole token family, and that revocation is a
 * write which cannot be rolled back by the error that follows it.
 */
type RefreshOutcome =
  | { kind: "ok"; tokens: AuthTokens }
  | { kind: "unknown" }
  | { kind: "reused" }
  | { kind: "expired" }
  | { kind: "user_gone" }
  | { kind: "tenant_inactive"; status: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_COLUMNS = `u.id, u.tenant_id, u.email, u.phone, u.name, u.role, u.platform_role, u.permissions,
    u.password_hash, t.name AS tenant_name, t.slug AS tenant_slug, t.plan AS tenant_plan,
    t.status AS tenant_status, t.custom_price_rubles AS tenant_custom_price_rubles, t.custom_plan_name AS tenant_custom_plan_name`;

/**
 * Условие «учётная запись пригодна для входа» одной строкой SQL.
 *
 * Экспортируется, потому что тот же предикат обязан стоять в
 * `AuthSessionService`: код второго фактора адресуется ровно тому пользователю,
 * которого затем найдёт `findByEmail`. Пока условия жили в двух файлах
 * независимо, они расходились — резолв адресата брал первую строку по e-mail без
 * фильтров, поэтому удалённый или ещё не активированный однофамилец
 * перехватывал выборку, его телефон попадал в сессию, и вход падал на сверке
 * «Код выдан для другого номера».
 *
 * `deleted_at IS NULL` — уволенный не входит. `activated_at IS NOT NULL` —
 * приглашённый без пароля не считается существующим пользователем: `argon2` на
 * NULL-хеше дал бы 500 вместо честного отказа.
 */
export function activeUserPredicate(alias: string): string {
  return `${alias}.deleted_at IS NULL AND ${alias}.activated_at IS NOT NULL`;
}

/** Digits only, so `+7 999 123 45 67` and `+79991234567` resolve to one user. */
function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Subdomain label rules, kept identical to the `tenants_slug_format` CHECK in
 * the schema: lowercase alphanumerics and inner hyphens, 3–63 characters.
 * Duplicated deliberately so a bad value is rejected with a field-level error
 * before it ever reaches the constraint.
 */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Пробный период нового арендатора, в днях.
 *
 * Совпадает с `trial_days` модулей в каталоге маркетплейса: разные сроки для
 * аккаунта и модулей означали бы, что счёт появляется раньше, чем истекает
 * пробный период аккаунта.
 */
const TRIAL_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Tenants that are suspended or past due must not receive fresh tokens. */
function assertTenantActive(status: string): void {
  if (status === "suspended" || status === "past_due") {
    throw new AppError(403, "TENANT_INACTIVE", `Tenant subscription is ${status}`);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuthService {
  constructor(private readonly app: FastifyInstance) {}

  // -- lookups --------------------------------------------------------------

  /**
   * Все выборки для входа отсекают удалённых и неактивированных.
   *
   * `deleted_at IS NULL` — иначе уволенный сотрудник продолжал бы входить.
   * `activated_at IS NOT NULL` — иначе приглашённый, ещё не задавший пароль,
   * считался бы существующим пользователем: `password_hash` у него NULL, и
   * попытка входа привела бы к ошибке argon2 вместо честного отказа.
   */
  private static readonly ACTIVE_USER = activeUserPredicate("u");

  private async findByPhone(phone: string): Promise<AuthUserRow | null> {
    return queryOne<AuthUserRow>(
      `SELECT ${USER_COLUMNS}
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE regexp_replace(u.phone, '\\D', '', 'g') = $1
         AND ${AuthService.ACTIVE_USER}
       ORDER BY u.created_at
       LIMIT 1`,
      [normalisePhone(phone)],
    );
  }

  private async findByEmail(email: string): Promise<AuthUserRow | null> {
    return queryOne<AuthUserRow>(
      `SELECT ${USER_COLUMNS}
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = lower($1)
         AND ${AuthService.ACTIVE_USER}
       ORDER BY u.created_at
       LIMIT 1`,
      [email],
    );
  }

  private async findById(userId: string, tenantId: string): Promise<AuthUserRow | null> {
    return queryOne<AuthUserRow>(
      `SELECT ${USER_COLUMNS}
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2
         AND ${AuthService.ACTIVE_USER}`,
      [userId, tenantId],
    );
  }

  // -- token issuing --------------------------------------------------------

  /**
   * Signs an access token bound to the real user and tenant, and persists a
   * rotated refresh token. `typ` lets authenticate.ts reject a refresh token
   * presented as a bearer credential.
   */
  private async issueTokens(
    user: AuthUserRow,
    tx?: TransactionClient,
    replacesId?: string,
  ): Promise<AuthTokens> {
    const env = getEnv();

    const access_token = this.app.jwt.sign({
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      typ: "access",
    });

    const refresh_token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const insert = `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`;
    const params = [user.tenant_id, user.id, hashToken(refresh_token), expiresAt];

    const created =
      tx === undefined
        ? await queryOne<{ id: string }>(insert, params)
        : await tx.queryOne<{ id: string }>(insert, params);

    if (created === null) {
      throw new Error("Failed to persist refresh token");
    }

    if (tx !== undefined && replacesId !== undefined) {
      await tx.query(`UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1`, [
        replacesId,
        created.id,
      ]);
    }

    return {
      access_token,
      refresh_token,
      token_type: "Bearer",
      expires_in: env.ACCESS_TOKEN_TTL,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        platform_role: user.platform_role,
        permissions: toPermissions(user.permissions),
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
        plan: user.tenant_plan,
        status: user.tenant_status,
        custom_price_rubles:
          user.tenant_custom_price_rubles !== null && user.tenant_custom_price_rubles !== undefined
            ? Number(user.tenant_custom_price_rubles)
            : null,
        custom_plan_name: user.tenant_custom_plan_name ?? null,
      },
    };
  }

  // -- OTP ------------------------------------------------------------------

  /**
   * Issues a login code. The response never reveals whether the phone is
   * registered, so the endpoint cannot be used to enumerate users; when it is
   * unknown no row is written and no code is generated.
   */
  async sendOtp(phone: string): Promise<{ message: string; expires_in_minutes: number }> {
    const env = getEnv();
    const user = await this.findByPhone(phone);

    if (user !== null) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

      await transaction(async (tx) => {
        // Supersede any code still outstanding for this phone.
        await tx.query(
          `UPDATE otp_codes SET consumed_at = now()
           WHERE phone = $1 AND consumed_at IS NULL`,
          [normalisePhone(phone)],
        );

        await tx.query(
          `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)`,
          [normalisePhone(phone), await argon2.hash(code), expiresAt],
        );
      });

      // Delivery via SMS/Telegram/WhatsApp is not wired yet (M0.6.2 follow-up).
      // Logged at debug so a production log level never records the code.
      this.app.log.debug({ phone, code }, "OTP generated");
    }

    return { message: "OTP sent", expires_in_minutes: env.OTP_TTL_MINUTES };
  }

  /**
   * Verifies the code and returns real tokens for the resolved user.
   *
   * The outcome leaves the transaction as a value and the error is raised after
   * it commits. Throwing from inside rolled the transaction back together with
   * the attempt counter and the consume marker, so neither survived: the attempt
   * limit did not hold at all and a code could be brute-forced indefinitely.
   * Same defect and same fix as `AuthSessionService.verifyCode`.
   */
  async verifyOtp(phone: string, code: string): Promise<AuthTokens> {
    const env = getEnv();
    const user = await this.findByPhone(phone);

    if (user === null) throw new InvalidCredentialsError("Invalid phone or code");
    assertTenantActive(user.tenant_status);

    const outcome = await transaction<VerifyOtpOutcome>(async (tx) => {
      // FOR UPDATE serialises concurrent verifications of the same code, so the
      // attempt counter cannot be bypassed by parallel requests.
      const otp = await tx.queryOne<OtpRow>(
        `SELECT id, code_hash, attempts, expires_at
         FROM otp_codes
         WHERE phone = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [normalisePhone(phone)],
      );

      if (otp === null) return { kind: "unknown" };

      if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
        await tx.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);
        return { kind: "attempts_exceeded" };
      }

      if (toDate(otp.expires_at).getTime() < Date.now()) {
        await tx.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);
        return { kind: "expired" };
      }

      if (!(await argon2.verify(otp.code_hash, code))) {
        await tx.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
        return { kind: "wrong_code" };
      }

      // Single use: consumed inside the same transaction as the token issue.
      await tx.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);

      return { kind: "ok", tokens: await this.issueTokens(user, tx) };
    });

    switch (outcome.kind) {
      case "ok":
        return outcome.tokens;
      case "attempts_exceeded":
        throw new OtpAttemptsExceededError();
      case "expired":
        throw new InvalidCredentialsError("Code has expired");
      case "unknown":
      case "wrong_code":
        throw new InvalidCredentialsError("Invalid phone or code");
    }
  }

  // -- password login -------------------------------------------------------

  /**
   * Verifies the password with argon2. A dummy verify runs when the e-mail is
   * unknown so response timing does not disclose which addresses exist.
   */
  async loginWithPassword(email: string, password: string): Promise<AuthTokens> {
    const user = await this.findByEmail(email);

    if (user === null) {
      await argon2.verify(
        "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000",
        password,
      ).catch(() => false);
      throw new InvalidCredentialsError("Invalid email or password");
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.password_hash, password);
    } catch {
      // Malformed or legacy hash — treated as a failed login, not a 500.
      valid = false;
    }

    if (!valid) throw new InvalidCredentialsError("Invalid email or password");

    assertTenantActive(user.tenant_status);

    return this.issueTokens(user);
  }

  /**
   * Вход с паролем и кодом из бота (второй фактор).
   *
   * Пароль проверяется первым и той же функцией, что и обычный вход: код не
   * должен служить заменой пароля. Только после успешной проверки пароля код
   * сверяется и гасится.
   */
  async loginWithPasswordAndCode(
    sessions: {
      verifyCode: (sessionId: string, code: string) => Promise<unknown>;
      consumeVerified: (input: {
        sessionId: string;
        purpose: "register" | "login";
        phone: string | null;
        email?: string;
        userId?: string;
      }) => Promise<void>;
      /**
       * Запоминает чат у пользователя — только после доказанного входа.
       * Исход игнорируется: вход уже состоялся, и занятый другой учётной
       * записью чат не должен его ломать.
       */
      linkVerifiedRecipient: (input: { sessionId: string; userId: string }) => Promise<unknown>;
    },
    input: { email: string; password: string; session_id: string; code: string },
  ): Promise<AuthTokens> {
    const user = await this.findByEmail(input.email);

    // Проверка пароля выполняется всегда, в том числе для неизвестного адреса:
    // loginWithPassword делает фиктивный verify, чтобы время ответа не выдавало
    // существование пользователя.
    if (user === null) {
      await argon2
        .verify(
          "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000",
          input.password,
        )
        .catch(() => false);
      throw new InvalidCredentialsError("Invalid email or password");
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.password_hash, input.password);
    } catch {
      valid = false;
    }

    if (!valid) throw new InvalidCredentialsError("Invalid email or password");

    assertTenantActive(user.tenant_status);

    await sessions.verifyCode(input.session_id, input.code);
    await sessions.consumeVerified({
      sessionId: input.session_id,
      purpose: "login",
      phone: user.phone,
      email: user.email,
      // Владелец сверяется по идентификатору, когда сессия его знает: это
      // строже телефона (уникален глобально, а не внутри арендатора) и не
      // отказывает пользователю без телефона, у которого в сессии заглушка.
      userId: user.id,
    });

    // Запоминаем чат только здесь: предъявлены и пароль, и код, поэтому владение
    // и аккаунтом, и чатом доказано. Записывать адресата раньше (на /start в
    // боте) означало бы привязку по неподтверждённому телефону.
    await sessions.linkVerifiedRecipient({ sessionId: input.session_id, userId: user.id });

    return this.issueTokens(user);
  }

  // -- refresh --------------------------------------------------------------

  /**
   * Rotates the refresh token: the presented one is revoked and a fresh pair is
   * issued in the same transaction. Presenting an already-revoked token revokes
   * the whole family, since reuse indicates the token leaked.
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const outcome = await transaction<RefreshOutcome>(async (tx) => {
      const row = await tx.queryOne<RefreshRow>(
        `SELECT id, user_id, tenant_id, revoked_at, expires_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [hashToken(refreshToken)],
      );

      if (row === null) return { kind: "unknown" };

      if (row.revoked_at !== null) {
        // Family-wide revocation must commit. Throwing here rolled it back
        // together with the transaction, so a leaked token produced a plain
        // "already used" error while every other session of that user stayed
        // valid — exactly the outcome this branch exists to prevent. Caught by
        // the "reuse revokes the whole family" test.
        await tx.query(
          `UPDATE refresh_tokens SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id],
        );
        return { kind: "reused" };
      }

      if (toDate(row.expires_at).getTime() < Date.now()) {
        return { kind: "expired" };
      }

      const user = await this.findById(row.user_id, row.tenant_id);
      if (user === null) return { kind: "user_gone" };

      if (user.tenant_status === "suspended" || user.tenant_status === "past_due") {
        return { kind: "tenant_inactive", status: user.tenant_status };
      }

      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);

      return { kind: "ok", tokens: await this.issueTokens(user, tx, row.id) };
    });

    switch (outcome.kind) {
      case "ok":
        return outcome.tokens;
      case "unknown":
        throw new UnauthorizedError("Invalid refresh token");
      case "reused":
        throw new UnauthorizedError("Refresh token already used");
      case "expired":
        throw new UnauthorizedError("Refresh token has expired");
      case "user_gone":
        throw new UnauthorizedError("User not found");
      case "tenant_inactive":
        // Через ту же функцию, что и остальные пути входа: код и текст ошибки
        // не должны различаться в зависимости от способа получения токена.
        assertTenantActive(outcome.status);
        throw new UnauthorizedError("Tenant is not active");
    }
  }

  // -- impersonation --------------------------------------------------------

  /**
   * Вход суперадминистратора платформы под учётной записью арендатора (Impersonation).
   *
   * Используется для диагностики ошибок, отладки обращений в поддержку и помощи клиентам.
   * Находит владельца (owner) или первого активного сотрудника организации и выпускает
   * для него полноценный JWT-токен, записывая действие в аудит-лог платформы.
   */
  async impersonateTenant(tenantId: string, actorUserId: string): Promise<AuthTokens> {
    const user = await queryOne<AuthUserRow>(
      `SELECT u.id, u.tenant_id, u.role, u.platform_role, u.name, u.email, u.phone,
              u.password_hash, u.permissions,
              t.name AS tenant_name, t.slug AS tenant_slug, t.plan AS tenant_plan, t.status AS tenant_status,
              t.custom_price_rubles AS tenant_custom_price_rubles, t.custom_plan_name AS tenant_custom_plan_name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
       ORDER BY (CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END), u.created_at ASC
       LIMIT 1`,
      [tenantId],
    );

    if (user === null) {
      throw new AppError(404, "USER_NOT_FOUND", "В компании нет активных пользователей для входа");
    }

    const tokens = await this.issueTokens(user);

    await query(
      `INSERT INTO tenant_audit_log
         (tenant_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'tenant.impersonate', 'user', $3, $4::jsonb)`,
      [
        tenantId,
        actorUserId,
        user.id,
        JSON.stringify({
          impersonated_user_id: user.id,
          impersonated_user_email: user.email,
          impersonated_user_role: user.role,
        }),
      ],
    );

    return tokens;
  }

  // -- registration ---------------------------------------------------------

  /**
   * Checks whether a subdomain slug can be taken.
   *
   * Runs before the tenant exists, so it cannot be tenant-scoped. Reserved
   * names live in the `reserved_slugs` table rather than only in code, so the
   * rule also holds for a direct INSERT.
   */
  async isSlugAvailable(slug: string): Promise<{ slug: string; available: boolean; reason: string | null }> {
    const normalised = slug.trim().toLowerCase();

    if (!SLUG_PATTERN.test(normalised)) {
      return { slug: normalised, available: false, reason: "INVALID_FORMAT" };
    }

    const reserved = await queryOne<{ slug: string }>(
      `SELECT slug FROM reserved_slugs WHERE slug = $1`,
      [normalised],
    );
    if (reserved !== null) {
      return { slug: normalised, available: false, reason: "RESERVED" };
    }

    const taken = await queryOne<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [
      normalised,
    ]);

    return {
      slug: normalised,
      available: taken === null,
      reason: taken === null ? null : "TAKEN",
    };
  }

  /**
   * Creates a tenant with its own subdomain plus the owner account, and signs
   * the owner in immediately.
   *
   * Everything runs in one transaction: a tenant without its owner would be
   * unreachable, and an owner without a tenant cannot be issued a token. The
   * unique index on `tenants.slug` is the actual arbiter of the race between
   * two simultaneous registrations picking the same slug — the availability
   * check above is a UX affordance, not a lock, so `23505` is translated into
   * a field-level error rather than a 500.
   */
  async register(input: {
    slug: string;
    email: string;
    phone: string;
    password: string;
    /** chat_id подтверждённой сессии; привязывается к владельцу. */
    telegram_chat_id?: number | null;
    /** MAX user_id подтверждённой сессии; привязывается к владельцу. */
    max_user_id?: string | null;
    /**
     * Гашение сессии подтверждения — внутри транзакции создания арендатора.
     *
     * Передаётся колбэком, а не выполняется вызывающим до `register`: при
     * `SLUG_TAKEN` или занятом e-mail транзакция откатывается вместе с
     * гашением, и пользователь исправляет поле тем же кодом. Прежде код
     * расходовался раньше вставок, и для правки одного поля требовалось
     * запрашивать новый код и снова открывать бота (`M0.12.8`).
     */
    consumeSession?: (tx: TransactionClient) => Promise<void>;
  }): Promise<AuthTokens> {
    const slug = input.slug.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();

    // Название компании и имя владельца больше не спрашиваются на этапе
    // регистрации: форма сведена к минимуму (поддомен, e-mail, пароль,
    // телефон). Значения выводятся из slug и e-mail, а изменить их можно в
    // настройках арендатора.
    const companyName = slug;
    const ownerName = email.split("@")[0] ?? slug;

    const availability = await this.isSlugAvailable(slug);
    if (!availability.available) {
      throw new AppError(400, "VALIDATION_ERROR", "Subdomain is not available", {
        slug: [
          availability.reason === "RESERVED"
            ? "Этот поддомен зарезервирован"
            : availability.reason === "INVALID_FORMAT"
              ? "Допустимы латиница, цифры и дефис (3–63 символа)"
              : "Этот поддомен уже занят",
        ],
      });
    }

    // Email must be unique platform-wide, not per tenant: it is the login
    // identifier for password sign-in, which has no tenant context.
    const existingEmail = await this.findByEmail(email);
    if (existingEmail !== null) {
      throw new AppError(400, "VALIDATION_ERROR", "Email already registered", {
        email: ["Этот e-mail уже зарегистрирован"],
      });
    }

    const passwordHash = await argon2.hash(input.password);

    try {
      return await transaction(async (tx) => {
        // Гашение первым шагом внутри транзакции: `FOR UPDATE` на строке сессии
        // сериализует две одновременные регистрации по одному коду, поэтому
        // второй достанется «Код уже использован», а не второй арендатор.
        if (input.consumeSession !== undefined) await input.consumeSession(tx);

        // Пробный период аккаунта фиксируется при создании: без него страница
        // биллинга показывала бы «осталось 0 дней» новой компании.
        const tenant = await tx.queryOne<{ id: string }>(
          `INSERT INTO tenants (name, slug, plan, status, trial_ends_at)
           VALUES ($1, $2, 'trial', 'trial', now() + ($3::int * INTERVAL '1 day'))
           RETURNING id`,
          [companyName, slug, TRIAL_DAYS],
        );
        if (tenant === null) throw new Error("Failed to create tenant");

        // `activated_at = now()`: владелец задаёт пароль здесь же, поэтому он
        // активен сразу. Без этого он не прошёл бы выборки входа, которые
        // требуют `activated_at IS NOT NULL`.
        const user = await tx.queryOne<{ id: string }>(
          `INSERT INTO users
             (tenant_id, email, phone, name, role, password_hash, permissions,
              telegram_chat_id, max_user_id, activated_at)
           VALUES ($1, $2, $3, $4, 'owner', $5, $6, $7, $8, now())
           RETURNING id`,
          [
            tenant.id,
            email,
            input.phone.trim(),
            ownerName,
            passwordHash,
            [...OWNER_PERMISSIONS],
            input.telegram_chat_id ?? null,
            input.max_user_id ?? null,
          ],
        );
        if (user === null) throw new Error("Failed to create owner");

        const created = await tx.queryOne<AuthUserRow>(
          `SELECT ${USER_COLUMNS}
           FROM users u JOIN tenants t ON t.id = u.tenant_id
           WHERE u.id = $1`,
          [user.id],
        );
        if (created === null) throw new Error("Failed to load created owner");

        return this.issueTokens(created, tx);
      });
    } catch (error) {
      // 23505 = unique_violation. Несколько разных ограничений дают этот код, и
      // сообщения должны отличаться, иначе занятый Telegram выглядел бы как
      // занятый поддомен.
      if (typeof error === "object" && error !== null && "code" in error) {
        if ((error as { code?: unknown }).code === "23505") {
          const constraint = String((error as { constraint?: unknown }).constraint ?? "");

          if (constraint === "idx_users_telegram_chat_id") {
            throw new AppError(409, "TELEGRAM_ALREADY_LINKED", "Telegram already linked", {
              phone: ["Этот Telegram уже привязан к другой учётной записи"],
            });
          }

          if (constraint === "idx_users_max_user_id") {
            throw new AppError(409, "MAX_ALREADY_LINKED", "MAX already linked", {
              phone: ["Этот аккаунт MAX уже привязан к другой учётной записи"],
            });
          }

          throw new AppError(409, "SLUG_TAKEN", "Subdomain was just taken", {
            slug: ["Этот поддомен только что занят, выберите другой"],
          });
        }
      }
      throw error;
    }
  }

  // -- logout ---------------------------------------------------------------

  /** Idempotent: an unknown or already-revoked token still reports success. */
  async logout(refreshToken: string): Promise<{ message: string }> {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(refreshToken)],
    );

    return { message: "Logged out" };
  }

  /** Revokes every active session of a user (password change, admin action). */
  async revokeAllSessions(userId: string): Promise<void> {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  // -- password helpers -----------------------------------------------------

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /** Constant-time compare for opaque tokens handled outside argon2. */
  static safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
