import crypto from "node:crypto";
import { getEnv } from "../../../config/env.js";
import { platformConfigService } from "../../admin/platform-config.service.js";
import { redisLuaLimiter, getSecondsUntilUtcMidnight } from "./redis-lua-limiter.js";
import type { ModelLimits, AcquiredSlot, ProviderKeySlot } from "./gateway.types.js";

export function hashApiKey(key: string, provider = "llm"): string {
  const hash = crypto.createHash("sha256").update(key.trim()).digest("hex").slice(0, 8);
  return `${provider.slice(0, 2)}k_${hash}`;
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 7)}••••${trimmed.slice(-4)}`;
}

export interface AcquireKeySlotOptions {
  tenantId?: string;
  estimatedTokens?: number;
  excludeKeyIds?: string[];
}

export class KeyPoolManager {
  constructor(private readonly limiter = redisLuaLimiter) {}

  /**
   * Сбор всех сконфигурированных ключей для указанного провайдера.
   * Источники:
   * 1. База данных платформы (platform_integrations_config.llmProviders)
   * 2. Переменные окружения (GEMINI_API_KEYS, OPENAI_API_KEYS, DEEPSEEK_API_KEYS, LLM_API_KEY)
   * 3. Тенант-специфичные настройки (при передаче tenantId)
   */
  async getKeysForProvider(provider: string, tenantId?: string): Promise<ProviderKeySlot[]> {
    const rawKeys: string[] = [];

    // 1. Читаем из платформенной конфигурации в БД
    try {
      const config = await platformConfigService.getRotatedLlmConfig();
      if (config) {
        const isMatch =
          (provider === "gemini" && (config.baseUrl.includes("googleapis.com") || config.providerId?.includes("gemini") || config.chatModel?.includes("gemini"))) ||
          (provider === "openai" && (config.baseUrl.includes("openai.com") || config.providerId?.includes("openai") || config.chatModel?.includes("gpt") || config.chatModel?.includes("o1") || config.chatModel?.includes("o3"))) ||
          (provider === "deepseek" && (config.baseUrl.includes("deepseek.com") || config.providerId?.includes("deepseek") || config.chatModel?.includes("deepseek"))) ||
          (provider === "openrouter" && (config.baseUrl.includes("openrouter.ai") || config.providerId?.includes("openrouter")));
        if (isMatch) {
          if (config.allKeys && config.allKeys.length > 0) {
            rawKeys.push(...config.allKeys);
          } else if (config.apiKey) {
            rawKeys.push(config.apiKey);
          }
        }
      }

      const integrations = await platformConfigService.getEffectiveIntegrations();
      const matchedProviders = integrations.llmProviders.filter((p) => {
        if (!p.isActive || !p.apiKeys || p.apiKeys.length === 0) return false;
        if (provider === "gemini") return p.providerType === "gemini" || p.id.includes("gemini") || (p.baseUrl && p.baseUrl.includes("googleapis.com"));
        if (provider === "openai") return p.providerType === "openai" || p.id.includes("openai") || (p.baseUrl && p.baseUrl.includes("openai.com"));
        if (provider === "deepseek") return p.providerType === "deepseek" || p.id.includes("deepseek") || (p.baseUrl && p.baseUrl.includes("deepseek.com"));
        if (provider === "anthropic") return p.providerType === "custom" && p.baseUrl.includes("anthropic");
        if (provider === "openrouter") return p.providerType === "openrouter" || p.id.includes("openrouter") || (p.baseUrl && p.baseUrl.includes("openrouter.ai"));
        return p.providerType === provider || p.id === provider;
      });

      for (const prov of matchedProviders) {
        if (prov.apiKeys) {
          rawKeys.push(...prov.apiKeys);
        }
      }
    } catch {}

    // 2. Читаем из переменных окружения
    try {
      const env = getEnv();
      if (provider === "gemini" && env.GEMINI_API_KEYS) {
        rawKeys.push(...env.GEMINI_API_KEYS.split(/[\r\n,]+/).map((k) => k.trim()));
      }
      if (provider === "gemini" && env.LLM_API_KEY && (env.LLM_API_KEY.startsWith("AIza") || env.LLM_API_KEY.startsWith("AQ."))) {
        rawKeys.push(env.LLM_API_KEY.trim());
      }
      if (provider === "openai" && process.env.OPENAI_API_KEYS) {
        rawKeys.push(...process.env.OPENAI_API_KEYS.split(/[\r\n,]+/).map((k) => k.trim()));
      }
      if (provider === "deepseek" && process.env.DEEPSEEK_API_KEYS) {
        rawKeys.push(...process.env.DEEPSEEK_API_KEYS.split(/[\r\n,]+/).map((k) => k.trim()));
      }
      if (env.LLM_API_KEY && !rawKeys.includes(env.LLM_API_KEY.trim())) {
        // Если настроен базовый шлюз LLM_API_BASE_URL (OmniRoute, OpenRouter, LiteLLM)
        const baseUrl = env.LLM_API_BASE_URL || "";
        const isMatch =
          (provider === "gemini" && baseUrl.includes("googleapis.com")) ||
          (provider === "openai" && baseUrl.includes("openai.com")) ||
          (provider === "deepseek" && baseUrl.includes("deepseek.com")) ||
          (provider === "openrouter" && baseUrl.includes("openrouter.ai")) ||
          provider === "custom" ||
          Boolean(baseUrl);
        if (isMatch) {
          rawKeys.push(env.LLM_API_KEY.trim());
        }
      }
    } catch {
      if (process.env.LLM_API_KEY) {
        rawKeys.push(process.env.LLM_API_KEY.trim());
      }
    }

    // Дедупликация и фильтрация невалидных ключей
    const uniqueRaw = Array.from(new Set(rawKeys.map((k) => k.trim()).filter((k) => k.length > 0)));
    const validKeys = uniqueRaw.filter((k) => !platformConfigService.isKeyInvalid(k));

    return validKeys.map((key) => {
      const id = hashApiKey(key, provider);
      return {
        id,
        provider,
        key,
        maskedKey: maskApiKey(key),
        status: "active",
        tenantId,
        cooldownUntil: 0,
        loadScore: 0,
      };
    });
  }

  /**
   * Атомарный выбор наименее загруженного ключа (Least-Loaded) из пула для целевой модели.
   */
  async acquireKeySlot(
    provider: string,
    model: string,
    limits: ModelLimits,
    options: AcquireKeySlotOptions = {},
  ): Promise<AcquiredSlot | null> {
    const keys = await this.getKeysForProvider(provider, options.tenantId);
    if (keys.length === 0) {
      return null;
    }

    const estimatedTokens = options.estimatedTokens ?? 1000;
    const excluded = new Set(options.excludeKeyIds ?? []);

    interface CandidateSlot {
      slot: ProviderKeySlot;
      loadScore: number;
    }

    const availableCandidates: CandidateSlot[] = [];

    for (const keySlot of keys) {
      if (excluded.has(keySlot.id)) continue;

      // Атомарная проверка слота через Redis Lua скрипт
      const reservation = await this.limiter.reserveSlot(
        keySlot.id,
        provider,
        model,
        limits,
        estimatedTokens,
      );

      if (reservation.allowed) {
        availableCandidates.push({
          slot: keySlot,
          loadScore: reservation.loadScore,
        });
      }
    }

    if (availableCandidates.length === 0) {
      return null;
    }

    // Сортируем кандидатов по возрастанию индекса нагрузки (наименее нагруженный ключ первым)
    availableCandidates.sort((a, b) => a.loadScore - b.loadScore);
    const chosen = availableCandidates[0]!;

    return {
      keyId: chosen.slot.id,
      apiKey: chosen.slot.key,
      maskedKey: chosen.slot.maskedKey,
      provider,
      model,
      originalModel: model,
      tier: "FAST_CHEAP",
      isFallback: false,
      loadScore: chosen.loadScore,
    };
  }

  /**
   * Обработка ошибки превышения квоты (HTTP 429) с парсингом заголовков retry-after и x-ratelimit-reset.
   */
  async handleRateLimit(
    keyId: string,
    provider: string,
    model: string,
    headers: Headers,
    bodyText = "",
  ): Promise<number> {
    const retryAfterHeader = headers.get("retry-after");
    const resetRequestsHeader = headers.get("x-ratelimit-reset-requests");
    const resetHeader = headers.get("x-ratelimit-reset");

    let cooloffSeconds = 60;

    if (retryAfterHeader) {
      const parsedInt = parseInt(retryAfterHeader, 10);
      if (!Number.isNaN(parsedInt)) {
        cooloffSeconds = parsedInt;
      } else {
        // Парсинг HTTP Date
        const dateMs = Date.parse(retryAfterHeader);
        if (!Number.isNaN(dateMs)) {
          cooloffSeconds = Math.max(5, Math.ceil((dateMs - Date.now()) / 1000));
        }
      }
    } else if (resetRequestsHeader) {
      const parsed = parseFloat(resetRequestsHeader);
      if (!Number.isNaN(parsed)) cooloffSeconds = Math.ceil(parsed);
    } else if (resetHeader) {
      const parsed = parseFloat(resetHeader);
      if (!Number.isNaN(parsed)) {
        if (parsed > 1_000_000_000) {
          cooloffSeconds = Math.max(5, Math.ceil((parsed * 1000 - Date.now()) / 1000));
        } else {
          cooloffSeconds = Math.ceil(parsed);
        }
      }
    }

    const lowerBody = bodyText.toLowerCase();
    const isDaily =
      lowerBody.includes("per day") ||
      lowerBody.includes("requestsperday") ||
      lowerBody.includes("requests per day") ||
      lowerBody.includes("day limit") ||
      (lowerBody.includes("quota exceeded") && lowerBody.includes("day"));

    if (isDaily) {
      cooloffSeconds = getSecondsUntilUtcMidnight();
    } else {
      cooloffSeconds = Math.min(Math.max(cooloffSeconds, 10), 60); // 10s .. 60s
    }

    const reason = isDaily ? `DAILY_RPD_EXHAUSTED_${provider.toUpperCase()}` : "RATE_LIMIT_429";
    await this.limiter.setCooldown(keyId, model, cooloffSeconds, reason);

    return cooloffSeconds;
  }

  /**
   * Фиксация израсходованных токенов после успешного завершения запроса.
   */
  async reportUsage(keyId: string, model: string, actualTokens: number): Promise<void> {
    await this.limiter.recordTokens(keyId, model, actualTokens);
  }
}

export const keyPoolManager = new KeyPoolManager();
