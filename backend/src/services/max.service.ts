import { getEnv } from "../config/env.js";
import { AppError } from "../plugins/errorHandler.js";
import { CODE_PURPOSE_LABEL, codeTtlSentence, type CodePurpose } from "./bot-messages.js";

// ---------------------------------------------------------------------------
// Доставка кодов подтверждения через бота платформы MAX (@id505030516451_bot).
//
// Прямой `fetch` к Bot API здесь допустим: запрет `.cursorrules` §1 на raw
// fetch касается LLM-провайдеров, для которых требуется слой абстракции.
// MAX — транспорт доставки, а не пласт бизнес-логики.
//
// Отличия от Telegram Bot API, из-за которых сервис не копия telegram.service:
//   1. База — `https://platform-api2.max.ru`, токен идёт в заголовке
//      `Authorization: <token>`, а не в пути. Передача токена через query
//      больше не поддерживается платформой.
//   2. Адресат — `user_id` в query-строке (`POST /messages?user_id=…`), а не
//      `chat_id` в теле.
//   3. Разметка включается полем `format: "html"`, а не `parse_mode`.
//   4. Webhook регистрируется через `POST /subscriptions` с указанием
//      `update_types`, а секрет приходит в заголовке `X-Max-Bot-Api-Secret`.
//   5. Логический результат определяется HTTP-кодом: конверта `ok` у MAX нет.
//
// Два сценария:
//   1. max_user_id известен  → отправляем код прямо в диалог.
//   2. max_user_id неизвестен → отдаём deep-link `?start=auth_<token>`; событие
//      `bot_started` привязывает max_user_id и сразу отправляет код в ответ.
// ---------------------------------------------------------------------------

const MAX_API_BASE = "https://platform-api2.max.ru";

/** События, которых достаточно для привязки аккаунта и обработки /start. */
const WEBHOOK_UPDATE_TYPES = ["bot_started", "message_created"] as const;

export interface MaxSendResult {
  delivered: boolean;
  /** Заполняется, когда доставка невозможна: причина для лога, не для клиента. */
  reason?: string;
}

interface MaxCallResult {
  ok: boolean;
  reason?: string;
}

export class MaxUnavailableError extends AppError {
  constructor() {
    super(503, "MAX_UNAVAILABLE", "MAX-бот не настроен. Обратитесь к администратору платформы.");
  }
}

/** Экранирование под `format: "html"`: в сообщение подставляется код. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class MaxService {
  private readonly token: string | undefined;
  private readonly botUsername: string;

  constructor() {
    const env = getEnv();
    this.token = env.MAX_BOT_TOKEN;
    this.botUsername = env.MAX_BOT_USERNAME;
  }

  /** Настроен ли транспорт: без токена канал MAX недоступен. */
  get isConfigured(): boolean {
    return this.token !== undefined && this.token.length > 0;
  }

  get username(): string {
    return this.botUsername;
  }

  /**
   * Ссылка на бота MAX, которая при первом запуске свяжет аккаунт с сессией.
   *
   * Формат: `https://max.ru/{bot_username}?start=auth_<token>`. Токен
   * генерируется в base64url, поэтому в query-строку попадает без escape.
   */
  deepLink(token: string): string {
    return `https://max.ru/${this.botUsername}?start=auth_${token}`;
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
  ): Promise<MaxCallResult> {
    if (!this.isConfigured || this.token === undefined) throw new MaxUnavailableError();

    const url = new URL(`${MAX_API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    // Явный таймаут: без него зависший вызов Bot API держал бы HTTP-запрос
    // пользователя до таймаута Fastify.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          // Токен только в заголовке — передача через query больше не
          // поддерживается платформой MAX.
          Authorization: this.token,
          ...(options.body !== undefined && { "Content-Type": "application/json" }),
        },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });

      if (res.ok) return { ok: true };

      // Тело ошибки читаем только для лога: наружу отдаётся общая причина.
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}${text.length > 0 ? `: ${text}` : ""}` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      return { ok: false, reason };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Отправка произвольного сообщения пользователю в диалог с ботом MAX. */
  async sendMessage(maxUserId: string, text: string): Promise<MaxCallResult> {
    return this.call("POST", "/messages", {
      query: { user_id: maxUserId },
      body: { text, format: "html", notify: true },
    });
  }

  /**
   * Отправляет код в диалог с ботом.
   *
   * Возвращает результат, а не бросает исключение при отказе MAX: причина
   * (пользователь остановил бота, удалил диалог) не должна превращаться в 500 —
   * вызывающий код показывает пользователю ссылку на бота.
   */
  async sendOtpMessage(
    maxUserId: string,
    code: string,
    purpose: CodePurpose = "login",
  ): Promise<MaxSendResult> {
    const text =
      `<b>GETVOXLY</b>\n\nКод для ${CODE_PURPOSE_LABEL[purpose]}: <code>${escapeHtml(code)}</code>\n\n` +
      `${codeTtlSentence()} Если вы не запрашивали код — просто игнорируйте это сообщение.`;

    const res = await this.sendMessage(maxUserId, text);
    return res.ok ? { delivered: true } : { delivered: false, reason: res.reason };
  }

  /** Приветствие в ответ на /start без токена привязки. */
  async sendGreeting(maxUserId: string): Promise<void> {
    await this.sendMessage(
      maxUserId,
      "<b>GETVOXLY</b>\n\nЭтот бот отправляет коды подтверждения для входа и регистрации.\n\n" +
        "Начните вход на сайте и нажмите «Получить код» — я пришлю код сюда.",
    );
  }

  /** Сообщение о просроченной или неизвестной ссылке привязки. */
  async sendLinkExpired(maxUserId: string): Promise<void> {
    await this.sendMessage(
      maxUserId,
      "Ссылка устарела или уже использована. Вернитесь на сайт и нажмите «Получить код» ещё раз.",
    );
  }

  /**
   * Подписывает бота на события через webhook.
   *
   * Вызывается на старте по той же причине, что и у Telegram: адрес не должен
   * остаться указывающим на снятый стек. MAX дополнительно отписывает бота
   * автоматически, если endpoint не отвечает 8 часов, поэтому регистрация при
   * каждом старте восстанавливает подписку после простоя.
   */
  async setWebhook(url: string, secret: string | undefined): Promise<MaxCallResult> {
    return this.call("POST", "/subscriptions", {
      body: {
        url,
        update_types: [...WEBHOOK_UPDATE_TYPES],
        ...(secret !== undefined && secret.length > 0 && { secret }),
      },
    });
  }
}
