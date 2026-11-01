import { getEnv } from "../config/env.js";
import { AppError } from "../plugins/errorHandler.js";
import { platformConfigService } from "../modules/admin/platform-config.service.js";
import { smartModelRouter } from "../modules/ai/gateway/index.js";

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

export class GatewayChatProvider implements ChatProvider {
  private readonly baseUrl: string | undefined;

  constructor() {
    try {
      const env = getEnv();
      this.baseUrl = env.LLM_API_BASE_URL?.replace(/\/+$/, "");
    } catch {
      this.baseUrl = process.env.LLM_API_BASE_URL?.replace(/\/+$/, "");
    }
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
    tenantId?: string;
  }): Promise<ChatCompletionResult> {
    const config = await platformConfigService.getRotatedLlmConfig();
    const activeBaseUrl = (config?.baseUrl || this.baseUrl)?.replace(/\/+$/, "");

    if (!activeBaseUrl) {
      throw new ChatUnavailableError();
    }

    let targetModel = input.model;
    if (!targetModel || targetModel === "default" || targetModel === "auto") {
      if (config?.chatModel && config.chatModel.trim().length > 0) {
        targetModel = config.chatModel;
      }
    }
    if (targetModel.startsWith("gemini/")) {
      targetModel = targetModel.replace(/^gemini\//, "");
    }

    try {
      const result = await smartModelRouter.execute(
        {
          model: targetModel,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          jsonMode: input.jsonMode,
        },
        {
          tenantId: input.tenantId,
        },
      );

      return {
        content: result.content,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        model: result.model,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new ChatFailedError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Стриминг ответа от LLM (Server-Sent Events) с поддержкой ротации ключей.
   */
  async *streamComplete(input: {
    model: string;
    messages: readonly ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    tenantId?: string;
    signal?: AbortSignal;
  }): AsyncIterable<{ delta: string; model: string; isComplete: boolean }> {
    let targetModel = input.model;
    if (targetModel.startsWith("gemini/")) {
      targetModel = targetModel.replace(/^gemini\//, "");
    }

    yield* smartModelRouter.stream(
      {
        model: targetModel,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      },
      {
        tenantId: input.tenantId,
        signal: input.signal,
      },
    );
  }
}
