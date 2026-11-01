import { getEnv } from "../../config/env.js";
import { AppError } from "../../plugins/errorHandler.js";
import { platformConfigService } from "../admin/platform-config.service.js";
import {
  type KeyModelUsage,
  GeminiRateLimiter,
  geminiRateLimiter,
  getModelFallbackChain,
  getSecondsUntilUtcMidnight,
  hashApiKey,
  normalizeGeminiModel,
} from "./gemini-rate-limiter.js";

export interface AcquiredKeyResult {
  apiKey: string;
  keyId: string;
  maskedKey: string;
  model: string;
  isFallback: boolean;
  originalModel: string;
}

export interface AcquireKeyOptions {
  estimatedTokens?: number;
  tenantId?: string;
  excludeKeyIds?: string[];
}

export interface GeminiKeyStats {
  keyId: string;
  maskedKey: string;
  isHealthy: boolean;
  inCooldown: boolean;
  cooldownTtlSeconds: number;
  models: Record<string, KeyModelUsage>;
}

export interface GeminiPoolStats {
  totalKeys: number;
  availableKeys: number;
  keys: GeminiKeyStats[];
  timestamp: string;
}

export class GeminiQuotaExhaustedError extends AppError {
  public readonly retryAfterSeconds: number;
  public readonly modelsChecked: string[];

  constructor(message: string, retryAfterSeconds = 15, modelsChecked: string[] = []) {
    super(
      429,
      "GEMINI_QUOTA_EXHAUSTED",
      `${message} (Повторите запрос через ${retryAfterSeconds} с)`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
    this.modelsChecked = modelsChecked;
  }
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export class GeminiKeyPoolService {
  constructor(private readonly rateLimiter: GeminiRateLimiter = geminiRateLimiter) {}

  /**
   * Сбор всех сконфигурированных ключей Google Gemini из БД и переменных окружения.
   */
  async getAllPoolKeys(): Promise<string[]> {
    const rawKeys: string[] = [];

    // 1. Ключи из платформенной конфигурации БД
    try {
      const integrations = await platformConfigService.getEffectiveIntegrations();
      const geminiProvider = integrations.llmProviders.find(
        (p) => p.providerType === "gemini" || p.id === "prov-gemini",
      );
      if (geminiProvider && geminiProvider.apiKeys && geminiProvider.apiKeys.length > 0) {
        rawKeys.push(...geminiProvider.apiKeys);
      }
    } catch {
      // Игнорируем ошибку чтения БД при раннем старте
    }

    // 2. Ключи из переменной окружения GEMINI_API_KEYS (список через запятую или перевод строки)
    try {
      const env = getEnv();
      if (env.GEMINI_API_KEYS) {
        const envKeys = env.GEMINI_API_KEYS.split(/[\r\n,]+/)
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        rawKeys.push(...envKeys);
      }
      if (env.LLM_API_KEY && (env.LLM_API_KEY.startsWith("AIza") || env.LLM_API_KEY.startsWith("AQ."))) {
        rawKeys.push(env.LLM_API_KEY.trim());
      }
    } catch {
      if (process.env.GEMINI_API_KEYS) {
        const envKeys = process.env.GEMINI_API_KEYS.split(/[\r\n,]+/)
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        rawKeys.push(...envKeys);
      }
    }

    // Дедупликация и очистка
    const uniqueKeys = Array.from(new Set(rawKeys.map((k) => k.trim()).filter((k) => k.length > 0)));

    // Фильтрация невалидных ключей (удаленные сервисные аккаунты, битые токены)
    return uniqueKeys.filter((k) => !platformConfigService.isKeyInvalid(k));
  }

  /**
   * Умный выбор наименее загруженного ключа из пула с поддержкой каскадного фоллбэка по моделям.
   * Алгоритм:
   * 1. Нормализует целевую модель и строит цепочку совместимых fallback-моделей.
   * 2. Для каждой модели проверяет доступные ключи (не в кулдауне, не превышены RPM/TPM/RPD).
   * 3. Среди подходящих ключей выбирает ключ с наименьшим индексом утилизации (Least Loaded).
   * 4. Если на целевой модели все ключи исчерпали квоту (например, 20 RPD на Flash),
   *    каскадно переключается на смежную совместимую модель (например, Flash Lite с 500 RPD).
   */
  async acquireKey(
    requestedModel: string,
    options: AcquireKeyOptions = {},
  ): Promise<AcquiredKeyResult> {
    const keys = await this.getAllPoolKeys();
    if (keys.length === 0) {
      throw new AppError(
        503,
        "LLM_UNAVAILABLE",
        "В пуле Google Gemini нет доступных API-ключей. Добавьте ключи в настройках интеграций.",
      );
    }

    const estimatedTokens = options.estimatedTokens ?? 1000;
    const excluded = new Set(options.excludeKeyIds ?? []);

    const normalizedRequested = normalizeGeminiModel(requestedModel);
    const candidateModels = [
      normalizedRequested,
      ...getModelFallbackChain(normalizedRequested),
    ];

    let minRetryAfter = 60;

    for (const candidateModel of candidateModels) {
      interface CandidateItem {
        key: string;
        keyId: string;
        loadScore: number;
      }

      const availableForModel: CandidateItem[] = [];

      for (const key of keys) {
        const keyId = hashApiKey(key);
        if (excluded.has(keyId)) continue;

        const check = await this.rateLimiter.canAcquire(keyId, candidateModel, estimatedTokens);
        if (check.allowed) {
          availableForModel.push({
            key,
            keyId,
            loadScore: check.loadScore,
          });
        } else if (check.retryAfterSeconds && check.retryAfterSeconds < minRetryAfter) {
          minRetryAfter = check.retryAfterSeconds;
        }
      }

      if (availableForModel.length > 0) {
        // Сортируем по возрастанию индекса нагрузки (наименее загруженный ключ первым)
        availableForModel.sort((a, b) => a.loadScore - b.loadScore);
        const selected = availableForModel[0]!;

        // Фиксируем запрос в счетчиках Sliding Window
        await this.rateLimiter.recordRequest(selected.keyId, candidateModel, estimatedTokens);

        return {
          apiKey: selected.key,
          keyId: selected.keyId,
          maskedKey: maskKey(selected.key),
          model: candidateModel,
          isFallback: candidateModel !== normalizedRequested,
          originalModel: normalizedRequested,
        };
      }
    }

    // Если все ключи для всех совместимых моделей исчерпали лимиты
    throw new GeminiQuotaExhaustedError(
      `Все ${keys.length} API-ключей Google Gemini временно исчерпали лимиты запросов (RPM/RPD) для моделей: ${candidateModels.join(", ")}`,
      minRetryAfter,
      candidateModels,
    );
  }

  /**
   * Отчет о фактически израсходованных токенах после завершения запроса.
   */
  async reportUsage(keyId: string, model: string, actualTokens: number): Promise<void> {
    await this.rateLimiter.recordTokens(keyId, model, actualTokens);
  }

  /**
   * Обработка превышения квоты (429 Rate Limit / Resource Exhausted).
   * Мгновенно ставит ключ на паузу (Circuit Breaker):
   * - При суточном превышении RPD: кулдаун до полуночи UTC.
   * - При минутном превышении RPM: кулдаун по заголовку Retry-After или 60 секунд.
   */
  async markRateLimited(
    keyIdOrApiKey: string,
    model: string,
    retryAfterSeconds?: number,
    limitType: "RPM" | "RPD" = "RPM",
  ): Promise<void> {
    const keyId = keyIdOrApiKey.startsWith("gk_") ? keyIdOrApiKey : hashApiKey(keyIdOrApiKey);
    const duration =
      limitType === "RPD"
        ? getSecondsUntilUtcMidnight()
        : Math.max(5, retryAfterSeconds ?? 60);

    const reason = limitType === "RPD" ? "RESOURCE_EXHAUSTED_DAILY_RPD" : "RATE_LIMIT_RPM";
    await this.rateLimiter.setCooldown(keyId, model, duration, reason);
  }

  /**
   * Получение детального статуса и метрик утилизации пула ключей.
   */
  async getPoolStats(): Promise<GeminiPoolStats> {
    const keys = await this.getAllPoolKeys();
    const trackedModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-2.5-pro",
      "gemini-embedding-001",
    ];

    const statsList: GeminiKeyStats[] = [];
    let availableCount = 0;

    for (const key of keys) {
      const keyId = hashApiKey(key);
      const modelsUsage: Record<string, KeyModelUsage> = {};
      let hasAnyAvailable = false;
      let minCooldown = 0;
      let inCooldown = false;

      for (const m of trackedModels) {
        const usage = await this.rateLimiter.getUsage(keyId, m);
        modelsUsage[m] = usage;
        if (!usage.inCooldown && usage.rpd < usage.rpdLimit && usage.rpm < usage.rpmLimit) {
          hasAnyAvailable = true;
        }
        if (usage.inCooldown) {
          inCooldown = true;
          if (usage.cooldownTtlSeconds > minCooldown) {
            minCooldown = usage.cooldownTtlSeconds;
          }
        }
      }

      if (hasAnyAvailable) {
        availableCount++;
      }

      statsList.push({
        keyId,
        maskedKey: maskKey(key),
        isHealthy: hasAnyAvailable,
        inCooldown,
        cooldownTtlSeconds: minCooldown,
        models: modelsUsage,
      });
    }

    return {
      totalKeys: keys.length,
      availableKeys: availableCount,
      keys: statsList,
      timestamp: new Date().toISOString(),
    };
  }
}

export const geminiKeyPoolService = new GeminiKeyPoolService();
