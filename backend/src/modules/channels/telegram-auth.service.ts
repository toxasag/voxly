import type { FastifyInstance } from "fastify";
import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { query, queryOne, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { decryptSecret, encryptSecret } from "../../services/credentials-cipher.js";
import {
  TelegramMtprotoService,
  TelegramPasswordRequiredError,
  type SignInOutcome,
} from "./telegram-mtproto.service.js";
import type {
  QrStartResultDTO,
  QrStatusResultDTO,
  SendCodeResultDTO,
  SignInResultDTO,
} from "./telegram-auth.types.js";

// ---------------------------------------------------------------------------
// Двухшаговое подключение аккаунта Telegram.
//
// Состояние между шагами живёт в `telegram_auth_sessions` (миграция 0013), а не
// в памяти процесса: контейнер перезапускается, и незавершённая авторизация не
// должна ломаться при рестарте. Redis в проекте пока нет.
// ---------------------------------------------------------------------------

/** Окно на завершение подключения. Совпадает с требованием задания. */
const SESSION_TTL_MINUTES = 10;

/**
 * Сколько раз можно ошибиться кодом или паролем в рамках одной попытки.
 *
 * Без лимита эндпоинт превращается в перебор пятизначного кода: 100 000
 * вариантов при отсутствии ограничений подбираются за считаные минуты.
 */
const MAX_ATTEMPTS = 5;

interface SessionRow {
  id: string;
  phone: string;
  label: string;
  phone_code_hash: string;
  session_state: string;
  requires_2fa: boolean;
  password_hint: string | null;
  attempts: number;
  consumed_at: Date | string | null;
  expires_at: Date | string;
}

interface ActiveQrSession {
  tempSessionId: string;
  tenantId: string;
  actorId: string;
  label: string;
  client: TelegramClient;
  status: "waiting" | "connected" | "requires_2fa" | "error";
  qrBase64: string;
  expires: number;
  user?: { id: string; firstName: string; lastName: string; username: string | null; phone: string | null };
  passwordHint?: string | null;
  accountId?: string;
  sessionState: string;
  error?: string;
  isClosed: boolean;
  cleanupTimer: NodeJS.Timeout;
  isAdvancing?: boolean;
  advancePromise?: Promise<void>;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class TelegramAuthService {
  private readonly mtproto = new TelegramMtprotoService();
  private static readonly activeQrSessions = new Map<string, ActiveQrSession>();

  constructor(private readonly app: FastifyInstance) {}

  get isConfigured(): boolean {
    return this.mtproto.isConfigured;
  }

  private closeActiveQrSession(tempSessionId: string): void {
    const active = TelegramAuthService.activeQrSessions.get(tempSessionId);
    if (!active) return;

    active.isClosed = true;
    clearTimeout(active.cleanupTimer);
    TelegramAuthService.activeQrSessions.delete(tempSessionId);

    if (active.client) {
      void this.mtproto.close(active.client).catch(() => {});
    }
  }

  /**
   * Шаг 1: запрос кода.
   *
   * Лимит подключений по тарифу проверяется здесь, а не после ввода кода: иначе
   * пользователь получил бы SMS, ввёл код и только тогда узнал, что подключить
   * аккаунт нельзя.
   */
  async sendCode(input: {
    tenantId: string;
    actorId: string;
    phone: string;
    label: string;
  }): Promise<SendCodeResultDTO> {
    await this.assertQuotaAvailable(input.tenantId);
    await this.assertPhoneNotConnected(input.tenantId, input.phone);

    const outcome = await this.mtproto.sendCode(input.phone);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO telegram_auth_sessions
         (tenant_id, created_by, phone, label, phone_code_hash, session_state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.actorId,
        input.phone,
        input.label,
        outcome.phoneCodeHash,
        // Даже незавершённая сессия содержит auth_key соединения с Telegram,
        // поэтому шифруется так же, как готовая.
        encryptSecret(outcome.sessionState),
        expiresAt,
      ],
    );

    if (row === null) throw new Error("Failed to persist Telegram auth session");

    // Просроченные записи удаляются попутно: отдельного воркера в проекте нет, а
    // хранить состояния авторизации дольше нужного незачем.
    await this.purgeExpired(input.tenantId);

    this.app.log.info(
      { tenantId: input.tenantId, phone: maskPhone(input.phone) },
      "Telegram MTProto code requested",
    );

    return {
      tempSessionId: row.id,
      phoneCodeHash: outcome.phoneCodeHash,
      isCodeViaApp: outcome.isCodeViaApp,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Проверяет состояние живой QR-сессии: опрашивает сокет MTProto и при подтверждении
   * входа в приложении переводит сессию в статус 'connected' или 'requires_2fa'.
   */
  private async advanceActiveQrSession(tempSessionId: string): Promise<void> {
    const active = TelegramAuthService.activeQrSessions.get(tempSessionId);
    if (!active || active.isClosed || active.status !== "waiting") {
      return;
    }

    if (active.isAdvancing && active.advancePromise) {
      await active.advancePromise;
      return;
    }

    active.isAdvancing = true;
    active.advancePromise = (async () => {
      try {
        const outcome = await this.mtproto.checkOrCompleteQr(active.client);

        if (outcome.status === "connected" && outcome.user && outcome.sessionState) {
          const accountId = await this.persistAccount({
            tenantId: active.tenantId,
            label: active.label,
            sessionState: outcome.sessionState,
            user: outcome.user,
          });

          await this.consume(active.tenantId, tempSessionId);

          active.status = "connected";
          active.accountId = accountId;
          active.user = outcome.user;
          active.sessionState = outcome.sessionState;
          this.app.log.info({ tempSessionId, accountId }, "Telegram QR login completed successfully");
        } else if (outcome.status === "requires_2fa") {
          active.status = "requires_2fa";
          active.passwordHint = outcome.passwordHint ?? null;
          if (outcome.sessionState) {
            active.sessionState = outcome.sessionState;
          }

          await query(
            `UPDATE telegram_auth_sessions
               SET requires_2fa = TRUE,
                   password_hint = $2
             WHERE id = $1`,
            [tempSessionId, outcome.passwordHint ?? null],
          );
          this.app.log.info(
            { tempSessionId, hint: outcome.passwordHint },
            "Telegram QR requires 2FA password; waiting for user input",
          );
        } else if (outcome.status === "waiting" && outcome.refreshedQr) {
          active.qrBase64 = outcome.refreshedQr.qrBase64;
          active.expires = outcome.refreshedQr.expires;
        }
      } catch (err: unknown) {
        const msg = (err as Error).message || "";
        if (msg === "AUTH_USER_CANCEL") {
          active.status = "error";
          active.error = "Авторизация отменена в приложении Telegram";
        } else {
          this.app.log.warn({ tempSessionId, err }, "Telegram QR check error");
        }
      } finally {
        active.isAdvancing = false;
        active.advancePromise = undefined;
      }
    })();

    await active.advancePromise;
  }

  /**
   * Старт подключения Telegram через QR-код.
   * Клиент остаётся подключённым и ожидает сканирования в реальном времени.
   */
  async startQr(input: {
    tenantId: string;
    actorId: string;
    label: string;
  }): Promise<QrStartResultDTO> {
    await this.assertQuotaAvailable(input.tenantId);

    // Закрываем предыдущие незавершённые QR-сессии этой компании
    for (const [id, s] of TelegramAuthService.activeQrSessions.entries()) {
      if (s.tenantId === input.tenantId) {
        this.closeActiveQrSession(id);
      }
    }

    const qrInit = await this.mtproto.createQrClient();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000);
    const initialSessionState = (qrInit.client.session as StringSession).save();

    const row = await queryOne<{ id: string }>(
      `INSERT INTO telegram_auth_sessions
         (tenant_id, created_by, phone, label, phone_code_hash, session_state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.actorId,
        "qr",
        input.label || "Telegram",
        "qr",
        encryptSecret(initialSessionState),
        expiresAt,
      ],
    );

    if (row === null) {
      await this.mtproto.close(qrInit.client);
      throw new Error("Failed to persist Telegram auth session");
    }

    await this.purgeExpired(input.tenantId);

    const tempSessionId = row.id;

    // Автоматическая очистка по истечении TTL (10 минут)
    const cleanupTimer = setTimeout(() => {
      this.closeActiveQrSession(tempSessionId);
    }, SESSION_TTL_MINUTES * 60_000);

    const activeSession: ActiveQrSession = {
      tempSessionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      label: input.label || "Telegram",
      client: qrInit.client,
      status: "waiting",
      qrBase64: qrInit.qrBase64,
      expires: qrInit.expires,
      sessionState: initialSessionState,
      isClosed: false,
      cleanupTimer,
    };

    TelegramAuthService.activeQrSessions.set(tempSessionId, activeSession);

    // Слушатель пуш-уведомления от Telegram о сканировании QR-кода
    qrInit.client.addEventHandler(async (update) => {
      if (activeSession.isClosed || activeSession.status !== "waiting") return;

      if (update instanceof Api.UpdateLoginToken) {
        this.app.log.info({ tempSessionId }, "Received Telegram UpdateLoginToken push");
        try {
          await this.advanceActiveQrSession(tempSessionId);
        } catch (err) {
          this.app.log.warn({ tempSessionId, err }, "Telegram UpdateLoginToken handler error");
        }
      }
    });

    this.app.log.info(
      { tenantId: input.tenantId, sessionId: tempSessionId },
      "Telegram MTProto QR code session started and listening for scan",
    );

    return {
      tempSessionId,
      qr: qrInit.qrBase64,
      expires: qrInit.expires,
    };
  }

  /**
   * Проверка состояния авторизации по QR-коду.
   */
  async checkQrStatus(input: {
    tenantId: string;
    tempSessionId: string;
  }): Promise<QrStatusResultDTO> {
    const active = TelegramAuthService.activeQrSessions.get(input.tempSessionId);

    if (active && !active.isClosed) {
      // Если сессия ожидает сканирования — опрашиваем MTProto клиента
      if (active.status === "waiting") {
        await this.advanceActiveQrSession(input.tempSessionId);
      }

      if (active.status === "connected" && active.accountId && active.user) {
        const response: QrStatusResultDTO = {
          status: "connected",
          accountId: active.accountId,
          user: active.user,
        };
        // Закрываем клиент после успешной отдачи статуса
        this.closeActiveQrSession(input.tempSessionId);
        return response;
      }

      if (active.status === "requires_2fa") {
        return {
          status: "requires_2fa",
          passwordHint: active.passwordHint ?? null,
        };
      }

      if (active.status === "error") {
        const errorMsg = active.error || "Ошибка авторизации";
        this.closeActiveQrSession(input.tempSessionId);
        throw new AppError(400, "TELEGRAM_QR_FAILED", errorMsg);
      }

      return {
        status: "waiting",
        qr: active.qrBase64,
        expires: active.expires,
      };
    }

    // Если в памяти сессии нет (например, был перезапуск бэкенда или сессия уже завершена)
    const session = await this.loadSession(input.tenantId, input.tempSessionId);

    // Если сессия уже была использована (consumed), отдаём созданный аккаунт
    if (session.consumed_at !== null) {
      const account = await queryOne<{ id: string; remote_user_id: string; label: string }>(
        `SELECT id, remote_user_id, label FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram' AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [input.tenantId],
      );
      if (account) {
        return {
          status: "connected",
          accountId: account.id,
          user: {
            id: account.remote_user_id,
            firstName: account.label,
            lastName: "",
            username: null,
            phone: null,
          },
        };
      }
    }

    if (session.requires_2fa) {
      return {
        status: "requires_2fa",
        passwordHint: session.password_hint,
      };
    }

    throw new AppError(
      410,
      "TELEGRAM_SESSION_EXPIRED",
      "Сессия подключения истекла. Пожалуйста, обновите QR-код.",
    );
  }

  /**
   * Ввод облачного пароля 2FA для завершения QR-авторизации.
   */
  async submitQrPassword(input: {
    tenantId: string;
    tempSessionId: string;
    password: string;
  }): Promise<Extract<QrStatusResultDTO, { status: "connected" }>> {
    const session = await this.loadSession(input.tenantId, input.tempSessionId);
    const active = TelegramAuthService.activeQrSessions.get(input.tempSessionId);

    let outcome: SignInOutcome;

    if (active && !active.isClosed) {
      try {
        outcome = await this.mtproto.submitPasswordWithClient(active.client, input.password);
      } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        const msg = (err as any)?.errorMessage || (err as any)?.message || "";
        if (
          typeof msg === "string" &&
          (msg.includes("PASSWORD") || msg.includes("PASSWORD_HASH_INVALID") || msg.includes("PASSWORD_EMPTY"))
        ) {
          throw new AppError(400, "TELEGRAM_PASSWORD_INVALID", "Неверный облачный пароль (2FA)");
        }
        throw err;
      }
    } else {
      const sessionState = decryptSecret(session.session_state);
      outcome = await this.mtproto.submitPassword({
        sessionState,
        password: input.password,
      });
    }

    const accountId = await this.persistAccount({
      tenantId: input.tenantId,
      label: session.label,
      sessionState: outcome.sessionState,
      user: outcome.user,
    });

    await this.consume(input.tenantId, session.id);
    this.closeActiveQrSession(input.tempSessionId);

    this.app.log.info(
      { tenantId: input.tenantId, accountId, tgUserId: outcome.user.id },
      "Telegram account connected via QR code with 2FA password",
    );

    return {
      status: "connected",
      accountId,
      user: outcome.user,
    };
  }

  /**
   * Шаг 2: код и, если включён, облачный пароль.
   *
   * Возвращает `password_required`, когда Telegram запросил второй фактор: код
   * при этом уже принят, повторно его отправлять не нужно, поэтому сессия
   * остаётся живой, а её состояние обновляется.
   */
  async signIn(input: {
    tenantId: string;
    tempSessionId: string;
    code?: string | undefined;
    password?: string | undefined;
  }): Promise<SignInResultDTO> {
    const session = await this.loadSession(input.tenantId, input.tempSessionId);
    const sessionState = decryptSecret(session.session_state);

    if (session.attempts >= MAX_ATTEMPTS) {
      await this.consume(input.tenantId, session.id);
      throw new AppError(
        429,
        "TELEGRAM_TOO_MANY_ATTEMPTS",
        "Слишком много неверных попыток. Начните подключение заново.",
      );
    }

    try {
      // Когда код уже подтверждён и Telegram ждёт только пароль, повторный
      // auth.SignIn отклоняется: код одноразовый. Поэтому ветвление по признаку
      // из сессии, а не по наличию кода в запросе.
      const outcome = session.requires_2fa
        ? await this.submitPassword(session, sessionState, input.password)
        : await this.mtproto.signIn({
            sessionState,
            phone: session.phone,
            phoneCodeHash: session.phone_code_hash,
            code: this.requireCode(input.code),
            password: input.password,
          });

      const accountId = await this.persistAccount({
        tenantId: input.tenantId,
        label: session.label,
        sessionState: outcome.sessionState,
        user: outcome.user,
      });

      await this.consume(input.tenantId, session.id);

      this.app.log.info(
        { tenantId: input.tenantId, accountId, tgUserId: outcome.user.id },
        "Telegram account connected via MTProto",
      );

      return { status: "connected", requires2FA: false, accountId };
    } catch (error) {
      if (error instanceof TelegramPasswordRequiredError) {
        // Состояние сессии продвинулось на стороне Telegram: сохраняем признак
        // 2FA и подсказку, чтобы следующий запрос сразу шёл в CheckPassword.
        await this.markRequires2FA(input.tenantId, session.id, error.hint);

        return {
          status: "password_required",
          requires2FA: true,
          passwordHint: error.hint,
          message: "Требуется облачный пароль (2FA)",
        };
      }

      // Неверный код или пароль — расходуем попытку. Ошибки сети и конфигурации
      // попытку не тратят: пользователь в них не виноват.
      if (error instanceof AppError && isUserInputError(error.code)) {
        await this.bumpAttempts(input.tenantId, session.id);
      }

      throw error;
    }
  }

  private requireCode(code: string | undefined): string {
    if (code === undefined || code.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Введите код из Telegram", {
        code: ["Введите код из Telegram"],
      });
    }
    return code;
  }

  private async submitPassword(
    session: SessionRow,
    sessionState: string,
    password: string | undefined,
  ): Promise<Awaited<ReturnType<TelegramMtprotoService["submitPassword"]>>> {
    if (password === undefined || password.length === 0) {
      throw new TelegramPasswordRequiredError(session.password_hint);
    }

    return this.mtproto.submitPassword({ sessionState, password });
  }

  /**
   * Запись подключения.
   *
   * `ON CONFLICT` по (tenant, channel, external_id) обновляет существующую
   * строку: переподключение того же аккаунта после отзыва сессии в Telegram —
   * обычный сценарий, и оно не должно упираться в уникальный индекс.
   */
  private async persistAccount(input: {
    tenantId: string;
    label: string;
    sessionState: string;
    user: { id: string; firstName: string; lastName: string; username: string | null; phone: string | null };
  }): Promise<string> {
    const identifier =
      input.user.username !== null && input.user.username.length > 0
        ? `@${input.user.username}`
        : input.user.phone !== null && input.user.phone.length > 0
          ? `+${input.user.phone.replace(/^\+/, "")}`
          : input.user.id;

    const label =
      input.label.trim().length > 0
        ? input.label.trim()
        : [input.user.firstName, input.user.lastName].filter((part) => part.length > 0).join(" ") ||
          identifier;

    const credentials = JSON.stringify({
      // Сессия — полный доступ к аккаунту, поэтому шифруется значением, а не
      // целым JSON: остальные поля нужны для отображения и поиска.
      session: encryptSecret(input.sessionState),
      tgUserId: input.user.id,
      username: input.user.username,
    });

    return withTenant(input.tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts
           (tenant_id, channel, label, external_id, status, status_message,
            credentials, credentials_encrypted, remote_user_id, connected_at, last_sync_at)
         VALUES ($1, 'telegram', $2, $3, 'connected', '', $4::jsonb, true, $5, now(), now())
         ON CONFLICT (tenant_id, channel, external_id) WHERE deleted_at IS NULL
         DO UPDATE SET
           label = EXCLUDED.label,
           status = 'connected',
           status_message = '',
           credentials = EXCLUDED.credentials,
           credentials_encrypted = true,
           remote_user_id = EXCLUDED.remote_user_id,
           connected_at = COALESCE(channel_accounts.connected_at, now()),
           last_sync_at = now(),
           deleted_at = NULL
         RETURNING id`,
        [input.tenantId, label, identifier, credentials, input.user.id],
      );

      return row.id;
    });
  }

  /** Читает сохранённую сессию MTProto для проверки её состояния. */
  async readAccountSession(tenantId: string, accountId: string): Promise<string | null> {
    const row = await queryOne<{ credentials: { session?: string } }>(
      `SELECT credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = 'telegram' AND deleted_at IS NULL`,
      [tenantId, accountId],
    );

    const stored = row?.credentials.session;
    if (stored === undefined || stored.length === 0) return null;

    return decryptSecret(stored);
  }

  /** Проверяет, жива ли сессия, и обновляет статус подключения. */
  async refreshAccountStatus(tenantId: string, accountId: string): Promise<{ alive: boolean; reason?: string }> {
    const sessionState = await this.readAccountSession(tenantId, accountId);

    if (sessionState === null) {
      throw new NotFoundError("У подключения нет сохранённой сессии Telegram");
    }

    const result = await this.mtproto.validateSession(sessionState);

    await query(
      `UPDATE channel_accounts SET
         status = $3,
         status_message = $4,
         last_sync_at = CASE WHEN $3 = 'connected' THEN now() ELSE last_sync_at END
       WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        accountId,
        result.alive ? "connected" : "error",
        result.alive ? "" : (result.reason ?? "Сессия недействительна"),
      ],
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Внутреннее
  // -------------------------------------------------------------------------

  private async loadSession(tenantId: string, id: string): Promise<SessionRow> {
    const row = await queryOne<SessionRow>(
      `SELECT id, phone, label, phone_code_hash, session_state, requires_2fa,
              password_hint, attempts, consumed_at, expires_at
       FROM telegram_auth_sessions
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );

    if (row === null) {
      throw new NotFoundError("Попытка подключения не найдена. Начните заново.");
    }

    if (row.consumed_at !== null) {
      throw new AppError(
        409,
        "TELEGRAM_SESSION_CONSUMED",
        "Эта попытка подключения уже завершена. Начните заново.",
      );
    }

    if (toDate(row.expires_at).getTime() < Date.now()) {
      throw new AppError(
        410,
        "TELEGRAM_SESSION_EXPIRED",
        `Время на подключение истекло (${SESSION_TTL_MINUTES} мин). Запросите код заново.`,
      );
    }

    return row;
  }

  private async markRequires2FA(tenantId: string, id: string, hint: string | null): Promise<void> {
    await query(
      `UPDATE telegram_auth_sessions
       SET requires_2fa = true, password_hint = $3
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, hint],
    );
  }

  private async bumpAttempts(tenantId: string, id: string): Promise<void> {
    await query(
      `UPDATE telegram_auth_sessions SET attempts = attempts + 1
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
  }

  private async consume(tenantId: string, id: string): Promise<void> {
    await query(
      `UPDATE telegram_auth_sessions SET consumed_at = now(), session_state = ''
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
  }

  /** Удаляет просроченные попытки: состояния авторизации не должны копиться. */
  private async purgeExpired(tenantId: string): Promise<void> {
    await query(
      `DELETE FROM telegram_auth_sessions
       WHERE tenant_id = $1 AND (expires_at < now() - interval '1 hour' OR consumed_at < now() - interval '1 hour')`,
      [tenantId],
    );
  }

  private async assertQuotaAvailable(tenantId: string): Promise<void> {
    const module = await queryOne<{ quantity: number }>(
      `SELECT quantity FROM installed_modules WHERE tenant_id = $1 AND slug = 'telegram'`,
      [tenantId],
    );

    if (module === null) {
      throw new AppError(403, "MODULE_NOT_INSTALLED", "Канал Telegram не подключён в маркетплейсе");
    }

    const used = await queryOne<{ total: string }>(
      `SELECT count(*)::text AS total FROM channel_accounts
       WHERE tenant_id = $1 AND channel = 'telegram' AND deleted_at IS NULL`,
      [tenantId],
    );

    if (Number(used?.total ?? 0) >= module.quantity) {
      throw new AppError(
        409,
        "CHANNEL_LIMIT_REACHED",
        `По тарифу оплачено ${module.quantity} ${pluralConnections(module.quantity)}. Увеличьте количество в маркетплейсе.`,
      );
    }
  }

  /**
   * Тот же номер не подключается дважды.
   *
   * Проверка до отправки кода: иначе Telegram присылал бы SMS на номер, который
   * всё равно нельзя привязать, и расходовал лимит запросов кода.
   */
  private async assertPhoneNotConnected(tenantId: string, phone: string): Promise<void> {
    const digits = phone.replace(/[^\d]/g, "");

    const existing = await queryOne<{ id: string; label: string }>(
      `SELECT id, label FROM channel_accounts
       WHERE tenant_id = $1 AND channel = 'telegram' AND deleted_at IS NULL
         AND regexp_replace(external_id, '[^0-9]', '', 'g') = $2
       LIMIT 1`,
      [tenantId, digits],
    );

    if (existing !== null) {
      throw new AppError(
        409,
        "CHANNEL_ACCOUNT_EXISTS",
        `Этот номер уже подключён как «${existing.label}»`,
      );
    }
  }
}

/** Ошибки, вызванные вводом пользователя: только они расходуют попытку. */
function isUserInputError(code: string): boolean {
  return (
    code === "TELEGRAM_CODE_INVALID" ||
    code === "TELEGRAM_PASSWORD_INVALID" ||
    code === "VALIDATION_ERROR"
  );
}

/** Телефон в логах маскируется: журналы читают шире, чем сами данные. */
function maskPhone(phone: string): string {
  return phone.length <= 5 ? "***" : `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

function pluralConnections(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "подключение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "подключения";
  return "подключений";
}
