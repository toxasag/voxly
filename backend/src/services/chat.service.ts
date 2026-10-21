import { getEnv } from "../config/env.js";
import { AppError } from "../plugins/errorHandler.js";
import { platformConfigService } from "../modules/admin/platform-config.service.js";

// ---------------------------------------------------------------------------
// Слой абстракции чат-вызовов LLM (`.cursorrules` §1: без прямого `fetch` к
// провайдерам из сервисов).
//
// Отдельный интерфейс от `EmbeddingProvider`: у эмбеддингов и чата разные форма
// запроса, единица расхода и режим отказа. Общий интерфейс с необязательными
// полями скрывал бы, что часть моделей умеет только одно из двух.
//
// Реализация — тот же OpenAI-совместимый шлюз. Стриминг здесь не нужен:
// пользователю уходят готовые сообщения через Telegram, а не поток символов в
// браузер. `streamChat` появится вместе с SSE-чатом в интерфейсе (`M4.2.4`).
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** Модель, которой шлюз фактически выполнил запрос: `auto/*` маршрутизирует сам. */
  model: string;
  latencyMs: number;
}

export interface ChatProvider {
  readonly isConfigured: boolean;
  complete(input: {
    model: string;
    messages: readonly ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** Требовать от модели строгий JSON. */
    jsonMode?: boolean;
  }): Promise<ChatCompletionResult>;
}

export class ChatUnavailableError extends AppError {
  constructor() {
    super(
      503,
      "LLM_UNAVAILABLE",
      "Доступ к моделям не настроен на платформе. Обратитесь к администратору.",
    );
  }
}

export class ChatFailedError extends AppError {
  constructor(reason: string) {
    super(502, "LLM_FAILED", `Модель не ответила: ${reason}`);
  }
}

/**
 * Таймаут одного вызова.
 *
 * 90 с: ответ агента в мессенджере уже задержан дебаунсом на 15–20 с, и ещё
 * полторы минуты ожидания клиент воспримет как «не ответили». Дольше держать
 * незачем — лучше честно записать отказ в журнал.
 */
const REQUEST_TIMEOUT_MS = 90_000;

interface ParsedCompletion {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/**
 * Ответ разбирается вручную, а не приводится типом.
 *
 * Тело приходит от внешнего сервиса: `as` означал бы, что структура принята на
 * веру, и отсутствующее поле обнаружилось бы позже — при отправке `undefined` в
 * Telegram или при записи NULL в журнал расхода.
 */
function parseCompletion(body: unknown): ParsedCompletion {
  if (typeof body !== "object" || body === null) {
    throw new ChatFailedError("ответ провайдера не является объектом");
  }

  const envelope = body as { choices?: unknown; usage?: unknown; model?: unknown };

  if (!Array.isArray(envelope.choices) || envelope.choices.length === 0) {
    throw new ChatFailedError("в ответе нет `choices`");
  }

  const first = envelope.choices[0];

  if (typeof first !== "object" || first === null) {
    throw new ChatFailedError("элемент `choices` не является объектом");
  }

  const message = (first as { message?: unknown }).message;

  if (typeof message !== "object" || message === null) {
    throw new ChatFailedError("в `choices[0]` нет `message`");
  }

  const content = (message as { content?: unknown }).content;

  if (typeof content !== "string") {
    throw new ChatFailedError("`message.content` не строка");
  }

  const usage = envelope.usage;
  const readUsage = (field: string): number => {
    if (typeof usage !== "object" || usage === null) return 0;
    const value = (usage as Record<string, unknown>)[field];
    return typeof value === "number" ? value : 0;
  };

  return {
    content,
    tokensIn: readUsage("prompt_tokens"),
    tokensOut: readUsage("completion_tokens"),
    model: typeof envelope.model === "string" ? envelope.model : "",
  };
}

export class GatewayChatProvider implements ChatProvider {
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor() {
    const env = getEnv();
    this.baseUrl = env.LLM_API_BASE_URL?.replace(/\/+$/, "");
    this.apiKey = env.LLM_API_KEY;
  }

  get isConfigured(): boolean {
    return platformConfigService.isLlmConfiguredSync();
  }

  async complete(input: {
    model: string;
    messages: readonly ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }): Promise<ChatCompletionResult> {
    const effective = await platformConfigService.getEffectiveIntegrations();
    const activeBaseUrl = (effective.llm.baseUrl?.trim() || this.baseUrl)?.replace(/\/+$/, "");
    const activeApiKey = effective.llm.apiKey?.trim() || this.apiKey;

    if (!activeBaseUrl || !activeApiKey) {
      throw new ChatUnavailableError();
    }

    const startedAt = Date.now();

    // Явный таймаут: без него зависший вызов держал бы обработчик входящего
    // сообщения и вместе с ним место в очереди дебаунса.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${activeBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.7,
          max_tokens: input.maxTokens ?? 1024,
          // `stream: false` задаётся явно: шлюз для части моделей включает
          // стриминг по умолчанию, и тогда тело приходит как SSE, а не JSON.
          stream: false,
          ...(input.jsonMode === true && { response_format: { type: "json_object" } }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Тело читается только для сообщения: наружу уходит код и краткая
        // причина, без заголовков и ключа.
        const text = await response.text().catch(() => "");
        throw new ChatFailedError(
          `HTTP ${response.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }

      const parsed = parseCompletion(await response.json());

      return {
        content: parsed.content,
        tokensIn: parsed.tokensIn,
        tokensOut: parsed.tokensOut,
        model: parsed.model.length > 0 ? parsed.model : input.model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      const reason = error instanceof Error ? error.message : "неизвестная ошибка";
      throw new ChatFailedError(reason);
    } finally {
      clearTimeout(timeout);
    }
  }
}
