import { getEnv } from "../../config/env.js";
import { AppError } from "../../plugins/errorHandler.js";
import { CODE_PURPOSE_LABEL, codeTtlSentence, type CodePurpose } from "../../services/bot-messages.js";

// ---------------------------------------------------------------------------
// Доставка кодов подтверждения через Telegram-бота (@GetVoxlybot).
//
// Прямой `fetch` к Bot API здесь допустим: запрет `.cursorrules` §1 на raw
// fetch касается LLM-провайдеров, для которых требуется слой абстракции.
// Telegram — транспорт доставки, а не пласт бизнес-логики.
//
// Два сценария:
//   1. chat_id известен  → отправляем код прямо в чат.
//   2. chat_id неизвестен → отдаём deep-link `?start=auth_<token>`; хук /start
//      привязывает chat_id и сразу отправляет код в ответ.
// ---------------------------------------------------------------------------

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Bot API отвечает 200 с ok:false на логические ошибки, поэтому читаем тело. */
interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

export interface TelegramSendResult {
  delivered: boolean;
  /** Заполняется, когда доставка невозможна: причина для лога, не для клиента. */
  reason?: string;
}

export class TelegramUnavailableError extends AppError {
  constructor() {
    super(
      503,
      "TELEGRAM_UNAVAILABLE",
      "Telegram-бот не настроен. Обратитесь к администратору платформы.",
    );
  }
}

/** Экранирование под parse_mode=HTML: код и логин подставляются в сообщение. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class TelegramService {
  private readonly token: string | undefined;
  private readonly botUsername: string;

  constructor() {
    const env = getEnv();
    this.token = env.TELEGRAM_AUTH_BOT_TOKEN;
    this.botUsername = env.TELEGRAM_AUTH_BOT_USERNAME;
  }

  /** Настроен ли транспорт: без токена канал Telegram недоступен. */
  get isConfigured(): boolean {
    return this.token !== undefined && this.token.length > 0;
  }

  get username(): string {
    return this.botUsername;
  }

  /**
   * Ссылка на бота, которая при первом запуске свяжет чат с сессией.
   *
   * Telegram передаёт всё после `start=` одним параметром и разрешает только
   * `A-Za-z0-9_-`, поэтому разделителем служит `_`, а токен генерируется в
   * base64url.
   */
  deepLink(token: string): string {
    return `https://t.me/${this.botUsername}?start=auth_${token}`;
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<TelegramResponse> {
    if (!this.isConfigured) throw new TelegramUnavailableError();

    // Явный таймаут: без него зависший вызов Bot API держал бы HTTP-запрос
    // пользователя до таймаута Fastify.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body: unknown = await res.json().catch(() => null);

      if (typeof body !== "object" || body === null) {
        return { ok: false, description: `Malformed response (HTTP ${res.status})` };
      }

      return body as TelegramResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      return { ok: false, description: reason };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Отправляет код в чат.
   *
   * Возвращает результат, а не бросает исключение при отказе Telegram: причина
   * (пользователь заблокировал бота, удалил чат) не должна превращаться в 500 —
   * вызывающий код показывает пользователю ссылку на бота.
   */
  async sendCode(chatId: number, code: string, purpose: CodePurpose): Promise<TelegramSendResult> {
    const text =
      `<b>GETVOXLY</b>\n\nКод для ${CODE_PURPOSE_LABEL[purpose]}: <code>${escapeHtml(code)}</code>\n\n` +
      `${codeTtlSentence()} Если вы не запрашивали код — просто игнорируйте это сообщение.`;

    const res = await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: false,
    });

    return res.ok ? { delivered: true } : { delivered: false, reason: res.description };
  }

  /** Приветствие в ответ на /start без токена привязки. */
  async sendGreeting(chatId: number): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text:
        "<b>GETVOXLY</b>\n\nЭтот бот отправляет коды подтверждения для входа и регистрации.\n\n" +
        "Начните регистрацию на сайте и нажмите «Получить код» — я пришлю код сюда.",
      parse_mode: "HTML",
    });
  }

  /** Сообщение о просроченной или неизвестной ссылке привязки. */
  async sendLinkExpired(chatId: number): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text:
        "Ссылка устарела или уже использована. Вернитесь на сайт и нажмите «Получить код» ещё раз.",
      parse_mode: "HTML",
    });
  }

  /**
   * Регистрирует webhook. Вызывается на старте, чтобы адрес не оставался
   * указывающим на снятый сервис: у бота был прописан URL удалённого легаси-стека,
   * и Telegram доставлял обновления в 404.
   */
  async setWebhook(url: string, secret: string | undefined): Promise<TelegramResponse> {
    return this.call("setWebhook", {
      url,
      allowed_updates: ["message"],
      // Старые обновления, скопившиеся пока webhook был битым, отбрасываем:
      // среди них нет ничего, что стоило бы обрабатывать сейчас.
      drop_pending_updates: true,
      ...(secret !== undefined && secret.length > 0 && { secret_token: secret }),
    });
  }
}
