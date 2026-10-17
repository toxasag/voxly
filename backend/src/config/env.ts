import { z } from "zod";

// ---------------------------------------------------------------------------
// Environment validation (M6.2.6).
//
// Parsed once at startup so a misconfigured deployment fails immediately with
// a readable message, instead of surfacing later as a runtime error or — worse
// — as a server signing tokens with a publicly known development secret.
// ---------------------------------------------------------------------------

/** Rejected outright in production; it shipped as the previous inline fallback. */
const FORBIDDEN_SECRETS: ReadonlySet<string> = new Set([
  "change-me-in-production",
  "changeme",
  "secret",
  "development",
]);

const MIN_SECRET_LENGTH = 32;

/**
 * Optional variable that treats an empty string as absent.
 *
 * Required for anything declared in docker-compose as `${VAR:-}`: that form sets
 * the variable to `""` inside the container rather than leaving it unset, so a
 * plain `.optional()` still validates `""` against the inner schema. With a
 * format-checked secret that turned a deliberately optional variable into a boot
 * failure — `getEnv()` throws before `listen()`, and `restart: unless-stopped`
 * then crash-loops the API instead of merely disabling the one channel.
 */
function optionalNonEmpty<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    schema.optional(),
  ) as z.ZodType<z.output<T> | undefined, z.ZodTypeDef, unknown>;
}

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

const baseSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  ACCESS_TOKEN_TTL: z.string().min(1).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  /**
   * Bot that delivers login codes. Optional so the API still boots without it
   * (password login and the existing phone OTP keep working); the Telegram
   * channel then reports that it is unavailable instead of failing at runtime.
   */
  TELEGRAM_AUTH_BOT_TOKEN: optionalNonEmpty(z.string()),
  TELEGRAM_AUTH_BOT_USERNAME: z.string().min(1).default("GetVoxlybot"),
  /**
   * Bot that delivers login codes via MAX (RuMAX). Optional for the same reasons
   * as the Telegram bot.
   */
  MAX_BOT_TOKEN: optionalNonEmpty(z.string()),
  MAX_BOT_USERNAME: z.string().min(1).default("id505030516451_bot"),
  /**
   * Shared secret for the MAX webhook, verified via the `X-Max-Bot-Api-Secret`
   * header. MAX restricts it to `[a-zA-Z0-9_-]{5,256}`, which is validated here
   * so a rejected subscription surfaces at boot rather than as silently
   * undelivered updates.
   */
  MAX_WEBHOOK_SECRET: optionalNonEmpty(
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{5,256}$/, "MAX_WEBHOOK_SECRET must match [A-Za-z0-9_-]{5,256}"),
  ),
  /**
   * Externally reachable base URL of this API, used to register the Telegram
   * webhook. Cannot be derived from HOST/PORT: the API sits behind a proxy and
   * binds 0.0.0.0:4000 internally.
   */
  PUBLIC_API_URL: z.string().optional(),

  /**
   * SMTP transport. Optional as a group: without SMTP_HOST the mailer reports
   * itself unconfigured and callers skip sending, rather than the API refusing
   * to boot — e-mail is a side channel, not a startup dependency.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(465),
  /**
   * `true` = implicit TLS (port 465), `false` = STARTTLS (port 587).
   * Coerced from a string because env values are always strings and
   * `Boolean("false")` is `true`.
   */
  SMTP_SECURE: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** RFC 5322 From, e.g. `"Voxly" <admin@getvoxly.ru>`. */
  SMTP_FROM: z.string().default('"Voxly" <admin@getvoxly.ru>'),
  /** Base URL used for links inside e-mails. */
  PUBLIC_APP_URL: z.string().default("https://app.getvoxly.ru"),
  /**
   * Shared secret for the webhook path, verified via Telegram's
   * `X-Telegram-Bot-Api-Secret-Token` header. Without it anyone who learns the
   * URL could POST forged updates and bind an arbitrary chat_id to a session.
   */
  TELEGRAM_WEBHOOK_SECRET: optionalNonEmpty(z.string()),

  /**
   * Ключи MTProto (my.telegram.org → API development tools).
   *
   * Это НЕ токен бота: они нужны для подключения пользовательских аккаунтов
   * Telegram через MTProto, тогда как `TELEGRAM_AUTH_BOT_TOKEN` доставляет коды
   * входа в саму CRM. Две разные подсистемы, поэтому и переменные разные.
   *
   * Необязательны как группа: без них канал Telegram отвечает
   * `503 TELEGRAM_MTPROTO_UNAVAILABLE`, а остальная часть API работает. Требовать
   * их через `:?` означало бы, что забытая переменная останавливает весь сервер.
   */
  TELEGRAM_API_ID: optionalNonEmpty(z.coerce.number().int().positive()),
  TELEGRAM_API_HASH: optionalNonEmpty(z.string().regex(/^[a-f0-9]{32}$/i, "TELEGRAM_API_HASH must be a 32-character hex string")),

  /**
   * Ключ шифрования `channel_accounts.credentials` (32 байта в hex или base64).
   *
   * Обязателен именно здесь, а не «когда-нибудь потом»: сохранённая
   * StringSession — это полный доступ к аккаунту Telegram пользователя (чтение
   * всех личных чатов и отправка от его имени). Дампа БД или SQL-инъекции
   * достаточно, чтобы получить чужие переписки, поэтому хранение в открытом виде
   * несоразмерно риску. RLS от этого не защищает: она ограничивает запросы
   * приложения, а не доступ к файлам БД и резервным копиям.
   */
  CREDENTIALS_ENCRYPTION_KEY: optionalNonEmpty(z.string().min(32)),

  /**
   * Шлюз LLM, совместимый с OpenAI API.
   *
   * Один базовый адрес и один ключ на все модели: платформа обращается к шлюзу,
   * который сам маршрутизирует запрос к OpenAI, Anthropic и остальным. Отдельные
   * ключи на провайдера потребовали бы столько же переменных, сколько моделей в
   * каталоге, и каждая новая модель означала бы правку окружения.
   *
   * Необязательны как группа: без них база знаний отвечает
   * `503 EMBEDDINGS_UNAVAILABLE`, а остальная часть API работает. Требовать их
   * означало бы, что забытая переменная останавливает весь сервер.
   */
  LLM_API_BASE_URL: optionalNonEmpty(z.string().url("LLM_API_BASE_URL must be a URL")),
  LLM_API_KEY: optionalNonEmpty(z.string().min(8)),

  /**
    * Модель эмбеддингов. Значение по умолчанию проверено живым вызовом шлюза:
    * возвращает ровно 1536 значений, что соответствует типу
    * `vector(1536)` в `knowledge_base_chunks`.
    *
    * Менять её нельзя без миграции: векторы другой размерности в той же таблице
    * несравнимы, и поиск молча возвращал бы мусор. Проверка размерности
    * выполняется в рантайме (`embeddings.service.ts`).
    */
  LLM_EMBEDDING_MODEL: z.string().min(1).default("openrouter/openai/text-embedding-3-small"),

  /**
   * Эквайринг Robokassa для SaaS-тарифов и пополнения AI-баланса.
   * Опционально: если не заданы, сервер запускается, но генерация платежных ссылок
   * выдает понятную ошибку 503 ROBOKASSA_NOT_CONFIGURED.
   */
  ROBOKASSA_MERCHANT_LOGIN: optionalNonEmpty(z.string()),
  ROBOKASSA_PASSWORD_1: optionalNonEmpty(z.string()),
  ROBOKASSA_PASSWORD_2: optionalNonEmpty(z.string()),
  ROBOKASSA_IS_TEST: z
    .string()
    .default("true")
    .transform((val) => val.toLowerCase() === "true" || val === "1"),
  ROBOKASSA_HASH_ALGO: z.enum(["MD5", "SHA256"]).default("SHA256"),
  ROBOKASSA_TAX: z.enum(["none", "vat0", "vat10", "vat20", "vat22", "vat5", "vat7"]).default("none"),
});

/**
 * Production tightens the secret rules. Development keeps them loose on
 * purpose so `npm run dev` works without a full .env, but the value can never
 * be one of the known placeholders once NODE_ENV=production.
 */
const envSchema = baseSchema.superRefine((env, ctx) => {
  // Проверяется в любом окружении: webhook публичен, и без секрета кто угодно,
  // узнав URL, привязал бы произвольный аккаунт к сессии подтверждения. Требуем
  // секрет только когда канал вообще включён — иначе выключенный канал не
  // должен мешать запуску.
  if (env.MAX_BOT_TOKEN !== undefined && env.MAX_WEBHOOK_SECRET === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MAX_WEBHOOK_SECRET"],
      message:
        "MAX_WEBHOOK_SECRET is required when MAX_BOT_TOKEN is set: the webhook is public and would otherwise accept forged updates. Generate one with: openssl rand -hex 32",
    });
  }

  if (env.TELEGRAM_AUTH_BOT_TOKEN !== undefined && env.TELEGRAM_WEBHOOK_SECRET === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TELEGRAM_WEBHOOK_SECRET"],
      message:
        "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_AUTH_BOT_TOKEN is set: the webhook is public and would otherwise accept forged updates. Generate one with: openssl rand -hex 32",
    });
  }

  // Ключи MTProto имеют смысл только в паре: с одним из двух GramJS не
  // подключится, и канал молча не работал бы вместо честного отказа на старте.
  const hasApiId = env.TELEGRAM_API_ID !== undefined;
  const hasApiHash = env.TELEGRAM_API_HASH !== undefined;

  if (hasApiId !== hasApiHash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasApiId ? "TELEGRAM_API_HASH" : "TELEGRAM_API_ID"],
      message:
        "TELEGRAM_API_ID and TELEGRAM_API_HASH must be set together: MTProto needs both. Get them at https://my.telegram.org → API development tools",
    });
  }

  // Без ключа шифрования сессии MTProto легли бы в БД открытым текстом, а это
  // полный доступ к аккаунтам пользователей. Требуем ключ ровно тогда, когда
  // канал включён.
  if (hasApiId && env.CREDENTIALS_ENCRYPTION_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CREDENTIALS_ENCRYPTION_KEY"],
      message:
        "CREDENTIALS_ENCRYPTION_KEY is required when TELEGRAM_API_ID is set: a stored MTProto session grants full access to the user's Telegram account and must not sit in the database in plaintext. Generate one with: openssl rand -hex 32",
    });
  }

  // Адрес и ключ шлюза имеют смысл только в паре: с одним из двух вызов
  // завершился бы 401 у провайдера, то есть база знаний ломалась бы в рантайме
  // вместо честного отказа на старте.
  const hasLlmUrl = env.LLM_API_BASE_URL !== undefined;
  const hasLlmKey = env.LLM_API_KEY !== undefined;

  if (hasLlmUrl !== hasLlmKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasLlmUrl ? "LLM_API_KEY" : "LLM_API_BASE_URL"],
      message:
        "LLM_API_BASE_URL and LLM_API_KEY must be set together: the gateway rejects a request without a key, so a half-configured pair breaks the knowledge base at runtime instead of at boot.",
    });
  }

  // Параметры Robokassa задаются комплексно: логин и оба пароля
  const hasRoboLogin = env.ROBOKASSA_MERCHANT_LOGIN !== undefined;
  const hasRoboPass1 = env.ROBOKASSA_PASSWORD_1 !== undefined;
  const hasRoboPass2 = env.ROBOKASSA_PASSWORD_2 !== undefined;

  if (hasRoboLogin && (!hasRoboPass1 || !hasRoboPass2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [!hasRoboPass1 ? "ROBOKASSA_PASSWORD_1" : "ROBOKASSA_PASSWORD_2"],
      message:
        "ROBOKASSA_PASSWORD_1 and ROBOKASSA_PASSWORD_2 must be set when ROBOKASSA_MERCHANT_LOGIN is provided: payment generation and webhook verification require both passwords.",
    });
  }

  if (env.NODE_ENV !== "production") return;

  if (FORBIDDEN_SECRETS.has(env.JWT_SECRET.toLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message:
        "JWT_SECRET must not be a known placeholder value in production. Generate one with: openssl rand -base64 48",
    });
  }

  if (env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`,
    });
  }
});

export type Env = z.infer<typeof baseSchema>;

let cached: Env | null = null;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Returns the validated environment, parsing it on first call.
 *
 * Throws with every failing variable listed at once, so a misconfiguration is
 * fixed in a single pass rather than one variable per restart.
 */
export function getEnv(): Env {
  if (cached !== null) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(parsed.error)}\n` +
        "See backend/.env.example for the expected variables.",
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: forces the next getEnv() call to re-read process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function corsOrigins(): string[] {
  return getEnv()
    .CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Builds the CORS origin matcher.
 *
 * A plain list is not enough once every tenant gets its own subdomain: the
 * browser sends `Origin: https://firma.getvoxly.ru`, which is not in the
 * configured list, so the preflight failed and sign-in was impossible from any
 * tenant portal. Entries may therefore use a `*.` prefix
 * (`https://*.getvoxly.ru`), matched against exactly one label so
 * `https://evil.com/?x=.getvoxly.ru` or a nested `a.b.getvoxly.ru` cannot slip
 * through.
 */
export function corsOriginMatcher(): (origin: string | undefined) => boolean {
  const patterns = corsOrigins();

  const exact = new Set(patterns.filter((p) => !p.includes("*")));
  const wildcards = patterns
    .filter((p) => p.includes("*"))
    .map((p) => {
      // https://*.getvoxly.ru -> ^https://[a-z0-9-]+\.getvoxly\.ru$
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", "[a-z0-9-]+");
      return new RegExp(`^${escaped}$`, "i");
    });

  return (origin) => {
    // Same-origin and non-browser callers (curl, health checks) send no Origin.
    if (origin === undefined || origin.length === 0) return true;
    if (exact.has(origin)) return true;
    return wildcards.some((re) => re.test(origin));
  };
}
