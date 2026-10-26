import { getEnv } from "../config/env.js";
import { AppError } from "../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Слой абстракции вызовов эмбеддингов (`.cursorrules` §1: LLM-вызовы идут через
// абстракцию, а не прямым `fetch` из сервиса).
//
// Провайдер здесь один — шлюз, совместимый с OpenAI API, — но интерфейс
// `EmbeddingProvider` отделяет его от вызывающего кода: смена шлюза или переход
// на локальную модель не должны означать правку сервиса базы знаний.
//
// Размерность вектора проверяется на каждом ответе. Это не перестраховка:
// колонка `knowledge_base_chunks.embedding` объявлена как `vector(1536)`, и
// вектор другой длины отклонит уже PostgreSQL — но с невнятной ошибкой БД посреди
// вставки пачки фрагментов, часть из которых уже записана. Проверка на границе
// даёт понятную ошибку до записи.
// ---------------------------------------------------------------------------

/** Размерность, зафиксированная в типе колонки. Менять только вместе с миграцией. */
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingResult {
  /** По одному вектору на каждый входной фрагмент, в том же порядке. */
  vectors: number[][];
  /** Токены, посчитанные провайдером; идут в журнал расхода. */
  tokensUsed: number;
  model: string;
}

export interface EmbeddingProvider {
  readonly isConfigured: boolean;
  readonly model: string;
  embed(inputs: readonly string[]): Promise<EmbeddingResult>;
}

export class EmbeddingsUnavailableError extends AppError {
  constructor(reason = "Провайдер эмбеддингов не настроен") {
    super(503, "EMBEDDINGS_UNAVAILABLE", reason);
  }
}

export class EmbeddingsFailedError extends AppError {
  constructor(reason: string) {
    super(502, "EMBEDDINGS_FAILED", `Не удалось получить эмбеддинги: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Разбор ответа
// ---------------------------------------------------------------------------

interface EmbeddingItem {
  index: number;
  embedding: number[];
}

/**
 * Ответ разбирается вручную, а не приводится типом.
 *
 * Тело приходит от внешнего сервиса, и `as` на нём означал бы, что структура
 * принята на веру: отсутствующее поле обнаружилось бы позже, при вставке в БД,
 * уже как ошибка `null value in column`.
 */
function parseEmbeddingResponse(
  body: unknown,
  expectedCount: number,
): { vectors: number[][]; tokensUsed: number; model: string } {
  if (typeof body !== "object" || body === null) {
    throw new EmbeddingsFailedError("ответ провайдера не является объектом");
  }

  const envelope = body as { data?: unknown; usage?: unknown; model?: unknown };

  if (!Array.isArray(envelope.data)) {
    throw new EmbeddingsFailedError("в ответе нет массива `data`");
  }

  const items: EmbeddingItem[] = [];

  for (const raw of envelope.data) {
    if (typeof raw !== "object" || raw === null) {
      throw new EmbeddingsFailedError("элемент `data` не является объектом");
    }

    const item = raw as { index?: unknown; embedding?: unknown };

    if (!Array.isArray(item.embedding)) {
      throw new EmbeddingsFailedError("в элементе `data` нет массива `embedding`");
    }

    const vector: number[] = [];

    for (const value of item.embedding) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new EmbeddingsFailedError("вектор содержит нечисловое значение");
      }
      vector.push(value);
    }

    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingsFailedError(
        `размерность ${vector.length} вместо ${EMBEDDING_DIMENSIONS}: модель эмбеддингов не соответствует схеме БД`,
      );
    }

    items.push({
      // `index` необязателен у части реализаций; при отсутствии полагаемся на
      // порядок элементов, который спецификация OpenAI сохраняет.
      index: typeof item.index === "number" ? item.index : items.length,
      embedding: vector,
    });
  }

  if (items.length !== expectedCount) {
    throw new EmbeddingsFailedError(
      `получено ${items.length} векторов вместо ${expectedCount}`,
    );
  }

  // Сортировка по `index`: соответствие «фрагмент → вектор» держится на порядке,
  // и перестановка привязала бы текст к чужому вектору. Ошибка была бы
  // незаметной — поиск просто отвечал бы не тем фрагментом.
  items.sort((left, right) => left.index - right.index);

  const usage = envelope.usage;
  const tokensUsed =
    typeof usage === "object" &&
    usage !== null &&
    typeof (usage as { total_tokens?: unknown }).total_tokens === "number"
      ? (usage as { total_tokens: number }).total_tokens
      : 0;

  return {
    vectors: items.map((item) => item.embedding),
    tokensUsed,
    model: typeof envelope.model === "string" ? envelope.model : "",
  };
}

// ---------------------------------------------------------------------------
// Реализация на OpenAI-совместимом шлюзе
// ---------------------------------------------------------------------------

import { platformConfigService } from "../modules/admin/platform-config.service.js";
import { geminiKeyPoolService, type AcquiredKeyResult } from "../modules/ai/gemini-key-pool.service.js";

/** Таймаут одного вызова. Пачка из 32 фрагментов укладывается в единицы секунд. */
const REQUEST_TIMEOUT_MS = 60_000;

export class GatewayEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  public readonly model: string;

  constructor() {
    try {
      const env = getEnv();
      this.baseUrl = env.LLM_API_BASE_URL?.replace(/\/+$/, "");
      this.apiKey = env.LLM_API_KEY;
      this.model = env.LLM_EMBEDDING_MODEL;
    } catch {
      this.baseUrl = process.env.LLM_API_BASE_URL?.replace(/\/+$/, "");
      this.apiKey = process.env.LLM_API_KEY;
      this.model = process.env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    }
  }

  get isConfigured(): boolean {
    return platformConfigService.isLlmConfiguredSync();
  }

  async embed(inputs: readonly string[]): Promise<EmbeddingResult> {
    const config = await platformConfigService.getRotatedLlmConfig();
    const activeBaseUrl = (config?.baseUrl || this.baseUrl)?.replace(/\/+$/, "");

    if (!activeBaseUrl) {
      throw new EmbeddingsUnavailableError(
        "Векторизация недоступна: на платформе не настроен доступ к моделям. Обратитесь к администратору в панели управления.",
      );
    }

    if (inputs.length === 0) {
      return { vectors: [], tokensUsed: 0, model: config?.embeddingModel || this.model };
    }

    const isGoogle =
      (activeBaseUrl.includes("generativelanguage.googleapis.com") ?? false) ||
      (config?.providerId?.includes("gemini") ?? false);

    // -------------------------------------------------------------------------
    // Специализированный умный роутер для эмбеддингов Google Gemini
    // -------------------------------------------------------------------------
    if (isGoogle) {
      let activeModel = config?.embeddingModel || this.model;
      if (!activeModel || activeModel.startsWith("text-embedding") || activeModel === "default") {
        activeModel = "gemini-embedding-001";
      } else if (activeModel.startsWith("models/")) {
        activeModel = activeModel.replace(/^models\//, "");
      }

      const estimatedTokens = Math.ceil(inputs.reduce((acc, str) => acc + str.length, 0) / 4);
      const allKeys = await geminiKeyPoolService.getAllPoolKeys();
      const maxAttempts = Math.min(Math.max(allKeys.length * 2, 4), 8);
      const excludedKeyIds: string[] = [];

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let acquisition: AcquiredKeyResult;
        try {
          acquisition = await geminiKeyPoolService.acquireKey(activeModel, {
            estimatedTokens,
            excludeKeyIds: excludedKeyIds,
          });
        } catch (err) {
          throw err instanceof AppError
            ? err
            : new EmbeddingsFailedError(err instanceof Error ? err.message : String(err));
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(`${activeBaseUrl}/embeddings`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${acquisition.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: acquisition.model,
              input: [...inputs],
              dimensions: EMBEDDING_DIMENSIONS,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            const isAuthError =
              response.status === 401 ||
              response.status === 403 ||
              text.includes("deleted or disabled") ||
              text.includes("API key not valid");

            if (isAuthError) {
              platformConfigService.markKeyInvalid(acquisition.apiKey);
              excludedKeyIds.push(acquisition.keyId);
              continue;
            }

            if (response.status === 429 || text.includes("RESOURCE_EXHAUSTED") || text.includes("Rate limit")) {
              const retryAfterHeader = response.headers.get("retry-after");
              const parsedRetryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
              const isDailyLimit =
                text.toLowerCase().includes("day") ||
                text.toLowerCase().includes("rpd") ||
                text.includes("Requests per day");
              const limitType = isDailyLimit ? "RPD" : "RPM";

              await geminiKeyPoolService.markRateLimited(
                acquisition.keyId,
                acquisition.model,
                parsedRetryAfter,
                limitType,
              );
              excludedKeyIds.push(acquisition.keyId);
              lastError = new EmbeddingsFailedError(`Ключ ${acquisition.maskedKey} достиг лимита ${limitType} (HTTP 429)`);
              continue;
            }

            if (response.status >= 500 && attempt < maxAttempts - 1) {
              excludedKeyIds.push(acquisition.keyId);
              lastError = new EmbeddingsFailedError(`Google Gemini вернул HTTP ${response.status}`);
              continue;
            }

            throw new EmbeddingsFailedError(
              `HTTP ${response.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ""}`,
            );
          }

          const parsed = parseEmbeddingResponse(await response.json(), inputs.length);

          await geminiKeyPoolService.reportUsage(
            acquisition.keyId,
            acquisition.model,
            parsed.tokensUsed,
          );

          return {
            vectors: parsed.vectors,
            tokensUsed: parsed.tokensUsed,
            model: parsed.model.length > 0 ? parsed.model : acquisition.model,
          };
        } catch (error) {
          if (attempt < maxAttempts - 1) {
            excludedKeyIds.push(acquisition.keyId);
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
          }
          if (error instanceof AppError) throw error;
          const reason = error instanceof Error ? error.message : "неизвестная ошибка";
          throw new EmbeddingsFailedError(reason);
        } finally {
          clearTimeout(timeout);
        }
      }

      throw lastError || new EmbeddingsFailedError("Все попытки вызова Google Gemini завершились ошибкой");
    }

    // -------------------------------------------------------------------------
    // Роутер по умолчанию для остальных провайдеров
    // -------------------------------------------------------------------------
    let activeModel = config?.embeddingModel || this.model;
    const keysToTry = config?.allKeys?.length ? config.allKeys : this.apiKey ? [this.apiKey] : [];

    if (keysToTry.length === 0) {
      throw new EmbeddingsUnavailableError(
        "Векторизация недоступна: на платформе не настроен доступ к моделям. Обратитесь к администратору в панели управления.",
      );
    }

    let lastError: Error | null = null;

    for (let i = 0; i < keysToTry.length; i++) {
      const activeApiKey = keysToTry[i];
      if (!activeApiKey) continue;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${activeBaseUrl}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: activeModel,
            input: [...inputs],
            dimensions: EMBEDDING_DIMENSIONS,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const isAuthError =
            response.status === 401 ||
            response.status === 403 ||
            text.includes("deleted or disabled") ||
            text.includes("API key not valid");
          if (isAuthError && activeApiKey) {
            platformConfigService.markKeyInvalid(activeApiKey);
          }

          const isRetryable =
            isAuthError ||
            response.status === 429 ||
            response.status >= 500 ||
            text.includes("RESOURCE_EXHAUSTED") ||
            text.includes("Rate limit");

          if (isRetryable && i < keysToTry.length - 1) {
            lastError = new EmbeddingsFailedError(`Ключ #${i + 1} вернул HTTP ${response.status}: ${text.slice(0, 100)}`);
            continue;
          }

          throw new EmbeddingsFailedError(
            `HTTP ${response.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ""}`,
          );
        }

        const parsed = parseEmbeddingResponse(await response.json(), inputs.length);

        return {
          vectors: parsed.vectors,
          tokensUsed: parsed.tokensUsed,
          model: parsed.model.length > 0 ? parsed.model : this.model,
        };
      } catch (error) {
        if (i < keysToTry.length - 1) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
        if (error instanceof AppError) throw error;

        const reason = error instanceof Error ? error.message : "неизвестная ошибка";
        throw new EmbeddingsFailedError(reason);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new EmbeddingsFailedError("Все API-ключи в пуле исчерпали лимиты запросов");
  }
}
