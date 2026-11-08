import { getEnv } from "../../../config/env.js";
import { AppError } from "../../../plugins/errorHandler.js";
import { platformConfigService } from "../../admin/platform-config.service.js";
import { keyPoolManager, KeyPoolManager } from "./key-pool-manager.js";
import { modelTierRouter, ModelTierRouter } from "./model-tier-router.js";
import { redisLuaLimiter, RedisLuaLimiter } from "./redis-lua-limiter.js";
import {
  type GatewayChatMessage,
  type GatewayExecutionOptions,
  type GatewayExecutionResult,
  type GatewayStreamChunk,
  type AcquiredSlot,
  LlmGatewayExhaustedError,
} from "./gateway.types.js";

const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;

export interface SmartModelRouterInput {
  model: string;
  messages: readonly GatewayChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export class SmartModelRouter {
  constructor(
    private readonly poolManager: KeyPoolManager = keyPoolManager,
    private readonly tierRouter: ModelTierRouter = modelTierRouter,
    private readonly limiter: RedisLuaLimiter = redisLuaLimiter,
  ) {}

  /**
   * Определение базового URL для указанного провайдера.
   */
  private async resolveBaseUrl(provider: string): Promise<string> {
    try {
      const integrations = await platformConfigService.getEffectiveIntegrations();
      const prov = integrations.llmProviders.find(
        (p) => p.isActive && Boolean(p.baseUrl) && (p.providerType === provider || p.id.includes(provider)),
      );
      if (prov && prov.baseUrl) {
        return prov.baseUrl.replace(/\/+$/, "");
      }
    } catch {}

    try {
      const config = await platformConfigService.getRotatedLlmConfig();
      if (config?.baseUrl) {
        const isMatch =
          (provider === "gemini" && (config.baseUrl.includes("googleapis.com") || config.providerId?.includes("gemini"))) ||
          (provider === "openai" && (config.baseUrl.includes("openai.com") || config.providerId?.includes("openai"))) ||
          (provider === "deepseek" && (config.baseUrl.includes("deepseek.com") || config.providerId?.includes("deepseek"))) ||
          (provider === "openrouter" && (config.baseUrl.includes("openrouter.ai") || config.providerId?.includes("openrouter")));
        if (isMatch) {
          return config.baseUrl.replace(/\/+$/, "");
        }
      }
    } catch {}

    try {
      const env = getEnv();
      const envUrl = env.LLM_API_BASE_URL || process.env.LLM_API_BASE_URL;
      if (envUrl && envUrl.trim().length > 0) {
        return envUrl.replace(/\/+$/, "");
      }
    } catch {}

    if (provider === "gemini") {
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    }
    if (provider === "openai") {
      return "https://api.openai.com/v1";
    }
    if (provider === "deepseek") {
      return "https://api.deepseek.com/v1";
    }
    if (provider === "openrouter") {
      return "https://openrouter.ai/api/v1";
    }

    return "https://generativelanguage.googleapis.com/v1beta/openai";
  }

  /**
   * Разбор OpenAI-совместимого ответа completion.
   */
  private parseCompletion(body: unknown, fallbackModel: string): { content: string; tokensIn: number; tokensOut: number; model: string } {
    if (typeof body !== "object" || body === null) {
      throw new Error("Ответ провайдера не является JSON-объектом");
    }

    const envelope = body as { choices?: unknown; usage?: unknown; model?: unknown };
    if (!Array.isArray(envelope.choices) || envelope.choices.length === 0) {
      throw new Error("В ответе LLM отсутствует массив choices");
    }

    const first = envelope.choices[0] as { message?: { content?: unknown } };
    const content = first?.message?.content;
    if (typeof content !== "string") {
      throw new Error("В ответе LLM choices[0].message.content не является строкой");
    }

    const usage = envelope.usage as Record<string, unknown> | undefined;
    const tokensIn = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const tokensOut = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
    const model = typeof envelope.model === "string" ? envelope.model : fallbackModel;

    return { content, tokensIn, tokensOut, model };
  }

  /**
   * Выполнение запроса к LLM с двухуровневой ротацией (Key Rotation + Model Fallback).
   */
  async execute(
    input: SmartModelRouterInput,
    options: GatewayExecutionOptions = {},
  ): Promise<GatewayExecutionResult> {
    const startedAt = Date.now();
    const promptChars = input.messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(promptChars / 4) + (input.maxTokens ?? 1024);

    const normalizedRequested = this.tierRouter.normalizeModelId(input.model);
    const customFallbacks = (options.fallbackModels ?? [])
      .map((m) => this.tierRouter.normalizeModelId(m))
      .filter((m) => m.length > 0 && m !== normalizedRequested);
    const defaultChain = this.tierRouter.getFallbackChain(normalizedRequested, options.tierHint);

    const candidateModels = Array.from(new Set([
      normalizedRequested,
      ...customFallbacks,
      ...defaultChain,
    ]));

    const maxAttempts = options.maxAttempts ?? Math.min(candidateModels.length * 3, 10);
    const globallyExcludedKeyIds = new Set<string>();
    const excludedKeyModelPairs = new Set<string>();
    const excludedModels = new Set<string>();
    const modelsChecked: string[] = [];

    let lastError: Error | null = null;
    let minRetryAfter = 30;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (options.signal?.aborted) {
        throw new AppError(499, "CLIENT_CLOSED_REQUEST", "Запрос к LLM был отменен клиентом");
      }

      // Находим первую доступную модель из цепочки фоллбэка, у которой есть свободный ключ
      let selectedSlot: AcquiredSlot | null = null;
      let selectedModelProfile = this.tierRouter.getModelProfile(normalizedRequested);

      for (const candidateModel of candidateModels) {
        if (excludedModels.has(candidateModel)) {
          continue;
        }

        const profile = this.tierRouter.getModelProfile(candidateModel);
        if (!modelsChecked.includes(candidateModel)) {
          modelsChecked.push(candidateModel);
        }

        const keysToExclude = Array.from(globallyExcludedKeyIds);
        for (const pair of excludedKeyModelPairs) {
          const colonIdx = pair.indexOf(":");
          if (colonIdx !== -1) {
            const kId = pair.slice(0, colonIdx);
            const mId = pair.slice(colonIdx + 1);
            if (mId === candidateModel && kId && !keysToExclude.includes(kId)) {
              keysToExclude.push(kId);
            }
          }
        }

        const slot = await this.poolManager.acquireKeySlot(
          profile.provider,
          candidateModel,
          profile.limits,
          {
            tenantId: options.tenantId,
            estimatedTokens,
            excludeKeyIds: keysToExclude,
          },
        );

        if (slot) {
          selectedSlot = {
            ...slot,
            tier: profile.tier,
            isFallback: candidateModel !== normalizedRequested,
            originalModel: normalizedRequested,
          };
          selectedModelProfile = profile;
          break;
        }
      }

      if (!selectedSlot) {
        // Ни для одной модели не нашлось доступных свободных ключей
        throw new LlmGatewayExhaustedError(
          `Все ключи и резервные модели исчерпали квоты (проверено моделей: ${modelsChecked.join(", ")})`,
          minRetryAfter,
          modelsChecked,
        );
      }

      const activeBaseUrl = await this.resolveBaseUrl(selectedModelProfile.provider);
      const attemptTimeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

      if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        const response = await fetch(`${activeBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${selectedSlot.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedSlot.model,
            messages: input.messages,
            temperature: input.temperature ?? 0.7,
            max_tokens: input.maxTokens ?? 1024,
            stream: false,
            ...(input.jsonMode === true && { response_format: { type: "json_object" } }),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // 1. Успешный ответ
        if (response.ok) {
          const parsed = this.parseCompletion(await response.json(), selectedSlot.model);

          // Фиксируем фактически израсходованные токены
          await this.poolManager.reportUsage(
            selectedSlot.keyId,
            selectedSlot.model,
            parsed.tokensIn + parsed.tokensOut,
          );

          // Сбрасываем счетчик сбоев Circuit Breaker
          await this.limiter.recordSuccess(selectedModelProfile.provider, selectedSlot.model);

          return {
            content: parsed.content,
            tokensIn: parsed.tokensIn,
            tokensOut: parsed.tokensOut,
            model: parsed.model || selectedSlot.model,
            originalModel: normalizedRequested,
            provider: selectedModelProfile.provider,
            tier: selectedSlot.tier,
            isFallback: selectedSlot.isFallback,
            keyId: selectedSlot.keyId,
            latencyMs: Date.now() - startedAt,
          };
        }

        // 2. Обработка ошибок HTTP
        const responseText = await response.text().catch(() => "");

        // Невалидный ключ (401/403)
        const isAuthError =
          response.status === 401 ||
          response.status === 403 ||
          responseText.includes("API key not valid") ||
          responseText.includes("deleted or disabled");

        if (isAuthError) {
          if (selectedSlot.provider === selectedModelProfile.provider) {
            platformConfigService.markKeyInvalid(selectedSlot.apiKey);
          }
          globallyExcludedKeyIds.add(selectedSlot.keyId);
          lastError = new AppError(401, "LLM_AUTH_FAILED", `API-ключ ${selectedSlot.maskedKey} недействителен`);
          continue;
        }

        // Превышение квот (HTTP 429 / Resource Exhausted)
        const isRateLimit =
          response.status === 429 ||
          responseText.includes("RESOURCE_EXHAUSTED") ||
          responseText.includes("Rate limit");

        if (isRateLimit) {
          const cooldown = await this.poolManager.handleRateLimit(
            selectedSlot.keyId,
            selectedModelProfile.provider,
            selectedSlot.model,
            response.headers,
            responseText,
          );
          if (cooldown < minRetryAfter) minRetryAfter = cooldown;
          excludedKeyModelPairs.add(`${selectedSlot.keyId}:${selectedSlot.model}`);
          lastError = new LlmGatewayExhaustedError(`Ключ ${selectedSlot.maskedKey} достиг лимита для ${selectedSlot.model}`, cooldown);
          continue;
        }

        // Ошибки перегрузки/недоступности конкретной модели (HTTP 503/504 / high demand / overloaded / UNAVAILABLE)
        // -> Исключаем ВСЮ МОДЕЛЬ из дальнейших попыток этого запроса, не перебирая остальные ключи впустую
        const isModelOverloaded =
          response.status === 503 ||
          response.status === 504 ||
          responseText.includes("high demand") ||
          responseText.includes("overloaded") ||
          responseText.includes("UNAVAILABLE") ||
          responseText.includes("is overloaded");

        if (isModelOverloaded) {
          excludedModels.add(selectedSlot.model);
          await this.limiter.recordFailure(selectedModelProfile.provider, selectedSlot.model);
          lastError = new AppError(
            503,
            "LLM_MODEL_OVERLOADED",
            `Модель ${selectedSlot.model} перегружена (${response.status}): немедленный переход на следующую резервную модель`,
          );
          continue;
        }

        // Прочие ошибки сервера провайдера (HTTP 5xx) -> Circuit Breaker
        if (response.status >= 500) {
          await this.limiter.recordFailure(selectedModelProfile.provider, selectedSlot.model);
          excludedKeyModelPairs.add(`${selectedSlot.keyId}:${selectedSlot.model}`);
          lastError = new AppError(502, "LLM_PROVIDER_ERROR", `Провайдер ${selectedModelProfile.provider} вернул ${response.status}`);
          continue;
        }

        throw new AppError(
          502,
          "LLM_REQUEST_FAILED",
          `Ошибка вызова модели ${selectedSlot.model} (${response.status}): ${responseText.slice(0, 200)}`,
        );
      } catch (err) {
        clearTimeout(timeoutId);
        if (options.signal?.aborted) {
          throw new AppError(499, "CLIENT_CLOSED_REQUEST", "Запрос был отменен");
        }

        // Если сработал таймаут попытки этой конкретной модели — исключаем модель и сразу идем к резервной
        if (controller.signal.aborted && !options.signal?.aborted) {
          excludedModels.add(selectedSlot.model);
          lastError = new AppError(504, "LLM_TIMEOUT", `Модель ${selectedSlot.model} не ответила вовремя (таймаут ${attemptTimeoutMs}ms)`);
          continue;
        }

        if (attempt < maxAttempts - 1) {
          excludedKeyModelPairs.add(`${selectedSlot.keyId}:${selectedSlot.model}`);
          lastError = err instanceof Error ? err : new Error(String(err));
          continue;
        }

        if (err instanceof AppError) throw err;
        throw new AppError(502, "LLM_FAILED", err instanceof Error ? err.message : String(err));
      }
    }

    throw lastError || new LlmGatewayExhaustedError("Все попытки вызова LLM завершились сбоем");
  }

  /**
   * Стриминг ответа от LLM (Server-Sent Events) с поддержкой ротации ключей.
   */
  async *stream(
    input: SmartModelRouterInput,
    options: GatewayExecutionOptions = {},
  ): AsyncIterable<GatewayStreamChunk> {
    const promptChars = input.messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(promptChars / 4) + (input.maxTokens ?? 1024);

    const normalizedRequested = this.tierRouter.normalizeModelId(input.model);
    const customFallbacks = (options.fallbackModels ?? [])
      .map((m) => this.tierRouter.normalizeModelId(m))
      .filter((m) => m.length > 0 && m !== normalizedRequested);
    const defaultChain = this.tierRouter.getFallbackChain(normalizedRequested, options.tierHint);

    const candidateModels = Array.from(new Set([
      normalizedRequested,
      ...customFallbacks,
      ...defaultChain,
    ]));

    let selectedSlot: AcquiredSlot | null = null;
    let selectedModelProfile = this.tierRouter.getModelProfile(normalizedRequested);

    for (const candidateModel of candidateModels) {
      const profile = this.tierRouter.getModelProfile(candidateModel);
      const slot = await this.poolManager.acquireKeySlot(profile.provider, candidateModel, profile.limits, {
        tenantId: options.tenantId,
        estimatedTokens,
      });
      if (slot) {
        selectedSlot = slot;
        selectedModelProfile = profile;
        break;
      }
    }

    if (!selectedSlot) {
      throw new LlmGatewayExhaustedError("Нет доступных ключей для стриминга");
    }

    const activeBaseUrl = await this.resolveBaseUrl(selectedModelProfile.provider);
    const response = await fetch(`${activeBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${selectedSlot.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedSlot.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 1024,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new AppError(502, "LLM_STREAM_FAILED", `Стриминг не удался (${response.status}): ${text.slice(0, 150)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.replace(/^data:\s*/, "");
          if (payload === "[DONE]") {
            yield { delta: "", model: selectedSlot.model, isComplete: true };
            return;
          }

          try {
            const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              yield { delta, model: selectedSlot.model, isComplete: false };
            }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const smartModelRouter = new SmartModelRouter();
