import argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { testDatabaseUrl, withTestDb } from "./test-db.js";
import { OWNER_PERMISSIONS, ROLE_PERMISSIONS } from "../../config/permissions.js";
import type { Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Сборка приложения и фикстуры данных для интеграционных тестов.
//
// Окружение выставляется до первого `getEnv()`: результат кешируется, поэтому
// импорт `app.ts` раньше этой функции зафиксировал бы пустую конфигурацию.
//
// Боты и SMTP сознательно НЕ настраиваются: `TELEGRAM_AUTH_BOT_TOKEN` и
// `MAX_BOT_TOKEN` отсутствуют, поэтому `assertChannelConfigured` отвечает 503, а
// тесты, которым нужен код, пишут строку `auth_sessions` напрямую. Альтернатива
// — мокать HTTP-клиент Telegram, но тогда проверялся бы мок, а не поведение
// сервера, а живой Bot API в тестах недопустим.
// ---------------------------------------------------------------------------

/** Секрет длиной 32+ и не из списка запрещённых — иначе `getEnv` не пройдёт. */
const TEST_JWT_SECRET = "test-jwt-secret-for-integration-tests-0123456789";

export function applyTestEnv(): void {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  process.env.CORS_ORIGIN = "http://localhost:3000";
  // Пул на 5: тесты последовательны, а меньший пул быстрее выявил бы удержание
  // соединения (именно этот класс дефектов правился в M0.12.5).
  process.env.PGPOOL_MAX = "5";

  // Каналы и почта выключены явно: значение могло остаться в окружении
  // разработчика, и тест начал бы обращаться к живому Bot API.
  delete process.env.TELEGRAM_AUTH_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.MAX_BOT_TOKEN;
  delete process.env.MAX_WEBHOOK_SECRET;
  delete process.env.SMTP_HOST;
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;
}

/**
 * Поднимает приложение без прослушивания порта.
 *
 * `app.inject()` проходит полный конвейер Fastify — хуки, схемы, обработчик
 * ошибок, — поэтому реальный сокет ничего не добавляет, а отсутствие порта
 * снимает вопрос его занятости при параллельных прогонах.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  applyTestEnv();

  // Импорт после applyTestEnv: `getEnv()` кеширует первое чтение process.env.
  const { buildApp } = await import("../../app.js");
  const app = await buildApp();
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Фикстуры
// ---------------------------------------------------------------------------

export interface TenantFixture {
  tenantId: string;
  slug: string;
}

export interface UserFixture {
  id: string;
  tenantId: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
}

/** Уникальный суффикс: тесты в одном файле не должны конфликтовать по slug. */
function unique(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function createTenant(
  overrides: { slug?: string; plan?: string; status?: string } = {},
): Promise<TenantFixture> {
  const slug = overrides.slug ?? `t${unique()}`;

  const tenantId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, plan, status, trial_ends_at)
       VALUES ($1, $2, $3, $4, now() + INTERVAL '14 days')
       RETURNING id`,
      [slug, slug, overrides.plan ?? "trial", overrides.status ?? "trial"],
    );
    return result.rows[0]?.id ?? "";
  });

  return { tenantId, slug };
}

export async function createUser(input: {
  tenantId: string;
  email?: string;
  phone?: string;
  password?: string;
  role?: Role;
  /** Приглашённый, ещё не активированный сотрудник. */
  activated?: boolean;
  deleted?: boolean;
  telegramChatId?: number | null;
  platformRole?: string | null;
}): Promise<UserFixture> {
  const email = input.email ?? `user-${unique()}@example.com`;
  const phone = input.phone ?? `79${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 11);
  const password = input.password ?? "correct-horse-battery";
  const role: Role = input.role ?? "owner";
  const activated = input.activated ?? true;

  const passwordHash = activated ? await argon2.hash(password) : null;
  const permissions = role === "owner" ? OWNER_PERMISSIONS : ROLE_PERMISSIONS[role];

  const id = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users
         (tenant_id, email, phone, name, role, platform_role, password_hash, permissions,
          telegram_chat_id, activated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.tenantId,
        email,
        phone,
        email.split("@")[0] ?? "user",
        role,
        input.platformRole ?? null,
        passwordHash,
        [...permissions],
        input.telegramChatId ?? null,
        activated ? new Date() : null,
        input.deleted === true ? new Date() : null,
      ],
    );
    return result.rows[0]?.id ?? "";
  });

  return { id, tenantId: input.tenantId, email, phone, password, role };
}

/**
 * Подтверждённая или ожидающая сессия кода — записывается напрямую.
 *
 * Через API её создать нельзя: `/auth/code/request` требует настроенного бота, а
 * доставка кода идёт во внешний Bot API. Здесь важно поведение сервера после
 * получения кода, поэтому строка готовится в БД, а сам код возвращается
 * вызывающему.
 */
export async function createAuthSession(input: {
  purpose: "register" | "login" | "link";
  phone: string;
  email?: string | null;
  userId?: string | null;
  code?: string | null;
  channel?: "telegram" | "max";
  telegramChatId?: number | null;
  verified?: boolean;
  consumed?: boolean;
  expiresInMinutes?: number;
  attempts?: number;
  deepLinkToken?: string | null;
}): Promise<{ sessionId: string; code: string }> {
  const code = input.code ?? "123456";
  const codeHash = input.code === null ? null : await argon2.hash(code);
  const expiresInMinutes = input.expiresInMinutes ?? 5;

  const sessionId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions
         (purpose, channel, phone, email, user_id, code_hash, attempts, telegram_chat_id,
          deep_link_token, delivered_at, verified_at, consumed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               now() + ($13::int * INTERVAL '1 minute'))
       RETURNING id`,
      [
        input.purpose,
        input.channel ?? "telegram",
        input.phone.replace(/\D/g, ""),
        input.email ?? null,
        input.userId ?? null,
        codeHash,
        input.attempts ?? 0,
        input.telegramChatId ?? null,
        input.deepLinkToken ?? null,
        codeHash === null ? null : new Date(),
        input.verified === true ? new Date() : null,
        input.consumed === true ? new Date() : null,
        expiresInMinutes,
      ],
    );
    return result.rows[0]?.id ?? "";
  });

  return { sessionId, code };
}

/** SHA-256 в том же виде, в котором хранят токены сервисы. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let addressCounter = 0;

/**
 * Уникальный адрес источника для `app.inject({ remoteAddress })`.
 *
 * Нужен тестам эндпоинтов со собственным лимитом (`/auth/forgot-password` и
 * `/auth/code/request` — 5/мин на IP). Инъекции по умолчанию приходят с
 * `127.0.0.1`, поэтому счётчик общий на весь файл: шестой запрос к такому
 * эндпоинту получал `429`, и падал не тот тест, который его исчерпал.
 *
 * Разные адреса вместо увеличения лимита в тестовой конфигурации: лимит — часть
 * поведения, и подменять его значит проверять не то, что работает на проде.
 */
export function uniqueRemoteAddress(): string {
  addressCounter += 1;
  const third = Math.floor(addressCounter / 254) % 254;
  const fourth = (addressCounter % 254) + 1;
  return `10.0.${third}.${fourth}`;
}
