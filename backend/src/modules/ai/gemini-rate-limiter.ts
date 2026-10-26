import crypto from "node:crypto";
import { getRedisClient, isRedisAvailable } from "../../infrastructure/redis.js";

export interface ModelQuotaConfig {
  rpm: number;
  tpm: number;
  rpd: number;
}

export interface KeyModelUsage {
  rpm: number;
  tpm: number;
  rpd: number;
  rpmLimit: number;
  tpmLimit: number;
  rpdLimit: number;
  inCooldown: boolean;
  cooldownTtlSeconds: number;
  cooldownReason?: string;
  loadScore: number;
}

export interface CanAcquireResult {
  allowed: boolean;
  reason?: "COOLDOWN" | "RPM_LIMIT" | "TPM_LIMIT" | "RPD_LIMIT";
  retryAfterSeconds?: number;
  loadScore: number;
}

/**
 * Конфигурация квот Free Tier Google Gemini API (из дашборда Google AI Studio).
 * - RPM: Requests Per Minute
 * - TPM: Tokens Per Minute
 * - RPD: Requests Per Day
 */
export const GEMINI_MODEL_QUOTAS: Record<string, ModelQuotaConfig> = {
  // Flash Lite (высокий суточный лимит: 500 RPD, 15 RPM)
  "gemini-3.5-flash-lite": { rpm: 15, tpm: 250_000, rpd: 500 },
  "gemini-3.1-flash-lite": { rpm: 15, tpm: 250_000, rpd: 500 },
  "gemini-3.1-flash-lite-preview": { rpm: 15, tpm: 250_000, rpd: 500 },
  "gemini-2.5-flash-lite": { rpm: 10, tpm: 250_000, rpd: 20 },

  // Standard Flash (жесткий суточный лимит Free Tier: 20 RPD, 5 RPM)
  "gemini-3-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-3.8-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-3.7-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-3.6-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-3.5-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-2.5-flash": { rpm: 5, tpm: 250_000, rpd: 20 },
  "gemini-1.5-flash": { rpm: 15, tpm: 1_000_000, rpd: 1500 },

  // Pro & Reasoning models
  "gemini-2.5-pro": { rpm: 2, tpm: 32_000, rpd: 50 },
  "gemini-3.1-pro-preview": { rpm: 2, tpm: 32_000, rpd: 50 },
  "gemini-1.5-pro": { rpm: 2, tpm: 32_000, rpd: 50 },

  // Векторные эмбеддинги
  "gemini-embedding-001": { rpm: 100, tpm: 30_000, rpd: 1000 },
  "gemini-embedding-2": { rpm: 100, tpm: 30_000, rpd: 1000 },
  "gemini-embedding-2-preview": { rpm: 100, tpm: 30_000, rpd: 1000 },

  // Дефолтные безопасные ограничения для неперечисленных моделей
  "default": { rpm: 5, tpm: 250_000, rpd: 20 },
};

/**
 * Каскадный приоритет совместимых моделей при исчерпании квоты (Fallback Chain).
 * При превышении суточного RPD (20 запросов) на стандартных Flash автоматически
 * переключается на высоколимитные Flash Lite (500 RPD).
 */
export const GEMINI_MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  // Flash модели (быстрый переход на Flash Lite при исчерпании 20 RPD)
  "gemini-3.8-flash": ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  "gemini-3.7-flash": ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  "gemini-3.6-flash": ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  "gemini-3.5-flash": ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
  "gemini-3-flash": ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  "gemini-2.5-flash": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],

  // Flash Lite (высокопроизводительные)
  "gemini-3.5-flash-lite": ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash"],
  "gemini-3.1-flash-lite": ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash"],
  "gemini-2.5-flash-lite": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],

  // Pro & Reasoning
  "gemini-2.5-pro": ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
  "gemini-3.1-pro-preview": ["gemini-2.5-pro", "gemini-3.5-flash", "gemini-3.5-flash-lite"],

  // Эмбеддинги
  "gemini-embedding-001": ["gemini-embedding-2-preview", "gemini-embedding-2"],
  "gemini-embedding-2": ["gemini-embedding-001", "gemini-embedding-2-preview"],
};

/**
 * Нормализация имени модели (удаление префиксов models/, google/, gemini/).
 */
export function normalizeGeminiModel(model: string): string {
  let clean = model.trim();
  // Отрезаем суффиксы вызова методов API, например :generateContent или :streamGenerateContent
  clean = clean.replace(/:[a-zA-Z]+$/, "");
  if (clean.startsWith("models/")) {
    clean = clean.replace(/^models\//, "");
  }
  if (clean.startsWith("google/")) {
    clean = clean.replace(/^google\//, "");
  }
  if (clean.startsWith("gemini/")) {
    clean = clean.replace(/^gemini\//, "");
  }
  if (clean.startsWith("openrouter/google/")) {
    clean = clean.replace(/^openrouter\/google\//, "");
  }
  return clean.toLowerCase();
}

/**
 * Получение параметров квот для модели.
 */
export function getModelQuota(model: string): ModelQuotaConfig {
  const normalized = normalizeGeminiModel(model);
  const matched = GEMINI_MODEL_QUOTAS[normalized];
  if (matched) return matched;

  if (normalized.includes("flash-lite")) {
    return GEMINI_MODEL_QUOTAS["gemini-3.5-flash-lite"]!;
  }
  if (normalized.includes("flash")) {
    return GEMINI_MODEL_QUOTAS["gemini-3.5-flash"]!;
  }
  if (normalized.includes("pro")) {
    return GEMINI_MODEL_QUOTAS["gemini-2.5-pro"]!;
  }
  if (normalized.includes("embed")) {
    return GEMINI_MODEL_QUOTAS["gemini-embedding-001"]!;
  }

  return GEMINI_MODEL_QUOTAS["default"]!;
}

/**
 * Получение цепочки совместимых моделей для каскадного фоллбэка.
 */
export function getModelFallbackChain(model: string): string[] {
  const normalized = normalizeGeminiModel(model);
  return GEMINI_MODEL_FALLBACK_CHAINS[normalized] ?? [];
}

/**
 * Безопасный детерминированный идентификатор ключа для логов и ключей Redis (без утечки секретов).
 */
export function hashApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
  return `gk_${hash}`;
}

/**
 * Расчет секунд до полуночи UTC (момент сброса суточных квот RPD в Google AI Studio).
 */
export function getSecondsUntilUtcMidnight(): number {
  const now = new Date();
  const tomorrowUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return Math.max(1, Math.floor((tomorrowUtc.getTime() - now.getTime()) / 1000));
}

interface InMemoryRecord {
  timestamps: number[];
  tpmByMinute: Map<number, number>;
  rpdByDay: Map<string, number>;
  cooldownUntil: number;
  cooldownReason?: string;
}

export class GeminiRateLimiter {
  private inMemoryMap = new Map<string, InMemoryRecord>();
  private inMemoryGlobalCooldown = new Map<string, { cooldownUntil: number; cooldownReason?: string }>();

  private getCompositeKey(keyId: string, model: string): string {
    return `${keyId}:${normalizeGeminiModel(model)}`;
  }

  private getInMemoryRecord(keyId: string, model: string): InMemoryRecord {
    const composite = this.getCompositeKey(keyId, model);
    let record = this.inMemoryMap.get(composite);
    if (!record) {
      record = {
        timestamps: [],
        tpmByMinute: new Map(),
        rpdByDay: new Map(),
        cooldownUntil: 0,
      };
      this.inMemoryMap.set(composite, record);
    }
    return record;
  }

  /**
   * Проверка возможности сделать запрос по ключу и модели.
   */
  async canAcquire(
    keyId: string,
    model: string,
    estimatedTokens = 1000,
  ): Promise<CanAcquireResult> {
    const usage = await this.getUsage(keyId, model);

    if (usage.inCooldown) {
      return {
        allowed: false,
        reason: "COOLDOWN",
        retryAfterSeconds: usage.cooldownTtlSeconds,
        loadScore: 9999,
      };
    }

    if (usage.rpd >= usage.rpdLimit) {
      return {
        allowed: false,
        reason: "RPD_LIMIT",
        retryAfterSeconds: getSecondsUntilUtcMidnight(),
        loadScore: 9999,
      };
    }

    if (usage.rpm >= usage.rpmLimit) {
      return {
        allowed: false,
        reason: "RPM_LIMIT",
        retryAfterSeconds: 5,
        loadScore: 9999,
      };
    }

    if (usage.tpm + estimatedTokens > usage.tpmLimit && usage.tpm > 0) {
      return {
        allowed: false,
        reason: "TPM_LIMIT",
        retryAfterSeconds: 10,
        loadScore: 9999,
      };
    }

    return {
      allowed: true,
      loadScore: usage.loadScore,
    };
  }

  /**
   * Получение текущих метрик утилизации квот по ключу и модели.
   */
  async getUsage(keyId: string, model: string): Promise<KeyModelUsage> {
    const normalizedModel = normalizeGeminiModel(model);
    const quota = getModelQuota(normalizedModel);
    const now = Date.now();
    const utcDateStr = new Date(now).toISOString().slice(0, 10);
    const minuteBucket = Math.floor(now / 60_000);

    const redis = isRedisAvailable() ? getRedisClient() : null;

    if (redis) {
      try {
        const rpmWindowKey = `gemini:keys:${keyId}:${normalizedModel}:rpm_window`;
        const tpmMinuteKey = `gemini:keys:${keyId}:${normalizedModel}:tpm:${minuteBucket}`;
        const rpdDayKey = `gemini:keys:${keyId}:${normalizedModel}:rpd:${utcDateStr}`;
        const cooldownKey = `gemini:keys:${keyId}:${normalizedModel}:cooldown`;
        const globalCooldownKey = `gemini:keys:${keyId}:cooldown`;

        const windowStart = now - 60_000;

        const results = await redis
          .pipeline()
          .zremrangebyscore(rpmWindowKey, 0, windowStart)
          .zcard(rpmWindowKey)
          .get(tpmMinuteKey)
          .get(rpdDayKey)
          .ttl(cooldownKey)
          .get(cooldownKey)
          .ttl(globalCooldownKey)
          .get(globalCooldownKey)
          .exec();

        if (results) {
          const rpmCount = typeof results[1]?.[1] === "number" ? results[1][1] : 0;
          const tpmCount = parseInt((results[2]?.[1] as string) || "0", 10) || 0;
          const rpdCount = parseInt((results[3]?.[1] as string) || "0", 10) || 0;

          const modelCooldownTtl = typeof results[4]?.[1] === "number" ? results[4][1] : -2;
          const modelCooldownReason = (results[5]?.[1] as string) || undefined;

          const globalCooldownTtl = typeof results[6]?.[1] === "number" ? results[6][1] : -2;
          const globalCooldownReason = (results[7]?.[1] as string) || undefined;

          const inCooldown = modelCooldownTtl > 0 || globalCooldownTtl > 0;
          const cooldownTtlSeconds = Math.max(modelCooldownTtl, globalCooldownTtl, 0);
          const cooldownReason = modelCooldownReason || globalCooldownReason;

          // Индекс нагрузки (0.0 — свободен, 1.0 — загружен)
          const rpmRatio = quota.rpm > 0 ? rpmCount / quota.rpm : 0;
          const rpdRatio = quota.rpd > 0 ? rpdCount / quota.rpd : 0;
          const loadScore = rpmRatio * 0.65 + rpdRatio * 0.35;

          return {
            rpm: rpmCount,
            tpm: tpmCount,
            rpd: rpdCount,
            rpmLimit: quota.rpm,
            tpmLimit: quota.tpm,
            rpdLimit: quota.rpd,
            inCooldown,
            cooldownTtlSeconds,
            cooldownReason,
            loadScore,
          };
        }
      } catch (err) {
        // При сбое Redis бесшовно уходим в in-memory
      }
    }

    // In-memory fallback
    const record = this.getInMemoryRecord(keyId, normalizedModel);
    record.timestamps = record.timestamps.filter((ts) => ts > now - 60_000);
    const rpmCount = record.timestamps.length;
    const tpmCount = record.tpmByMinute.get(minuteBucket) ?? 0;
    const rpdCount = record.rpdByDay.get(utcDateStr) ?? 0;

    const globalCd = this.inMemoryGlobalCooldown.get(keyId);
    const isGlobalCooldown = globalCd ? globalCd.cooldownUntil > now : false;
    const isModelCooldown = record.cooldownUntil > now;
    const inCooldown = isModelCooldown || isGlobalCooldown;

    const modelTtl = isModelCooldown ? Math.ceil((record.cooldownUntil - now) / 1000) : 0;
    const globalTtl = isGlobalCooldown && globalCd ? Math.ceil((globalCd.cooldownUntil - now) / 1000) : 0;
    const cooldownTtlSeconds = Math.max(modelTtl, globalTtl);
    const cooldownReason = isModelCooldown ? record.cooldownReason : globalCd?.cooldownReason;

    const rpmRatio = quota.rpm > 0 ? rpmCount / quota.rpm : 0;
    const rpdRatio = quota.rpd > 0 ? rpdCount / quota.rpd : 0;
    const loadScore = rpmRatio * 0.65 + rpdRatio * 0.35;

    return {
      rpm: rpmCount,
      tpm: tpmCount,
      rpd: rpdCount,
      rpmLimit: quota.rpm,
      tpmLimit: quota.tpm,
      rpdLimit: quota.rpd,
      inCooldown,
      cooldownTtlSeconds,
      cooldownReason,
      loadScore,
    };
  }

  /**
   * Фиксация отправленного запроса (инкремент счетчиков Sliding Window RPM и суточного RPD).
   */
  async recordRequest(keyId: string, model: string, estimatedTokens = 1000): Promise<void> {
    const normalizedModel = normalizeGeminiModel(model);
    const now = Date.now();
    const utcDateStr = new Date(now).toISOString().slice(0, 10);
    const minuteBucket = Math.floor(now / 60_000);
    const requestId = `${now}_${Math.random().toString(36).slice(2, 6)}`;

    const redis = isRedisAvailable() ? getRedisClient() : null;

    if (redis) {
      try {
        const rpmWindowKey = `gemini:keys:${keyId}:${normalizedModel}:rpm_window`;
        const tpmMinuteKey = `gemini:keys:${keyId}:${normalizedModel}:tpm:${minuteBucket}`;
        const rpdDayKey = `gemini:keys:${keyId}:${normalizedModel}:rpd:${utcDateStr}`;

        await redis
          .pipeline()
          .zadd(rpmWindowKey, now, requestId)
          .expire(rpmWindowKey, 120)
          .incrby(tpmMinuteKey, estimatedTokens)
          .expire(tpmMinuteKey, 120)
          .incr(rpdDayKey)
          .expire(rpdDayKey, 172800) // 48 часов
          .exec();
      } catch {
        // Fallback
      }
    }

    // Всегда обновляем локальный in-memory счетчик для консистентности
    const record = this.getInMemoryRecord(keyId, normalizedModel);
    record.timestamps.push(now);
    record.tpmByMinute.set(minuteBucket, (record.tpmByMinute.get(minuteBucket) ?? 0) + estimatedTokens);
    record.rpdByDay.set(utcDateStr, (record.rpdByDay.get(utcDateStr) ?? 0) + 1);
  }

  /**
   * Корректировка токенов по фактическому ответу LLM (из поля usage).
   */
  async recordTokens(keyId: string, model: string, actualTokens: number): Promise<void> {
    if (actualTokens <= 0) return;
    const normalizedModel = normalizeGeminiModel(model);
    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const tpmMinuteKey = `gemini:keys:${keyId}:${normalizedModel}:tpm:${minuteBucket}`;
        await redis.incrby(tpmMinuteKey, actualTokens);
      } catch {}
    }

    const record = this.getInMemoryRecord(keyId, normalizedModel);
    record.tpmByMinute.set(minuteBucket, (record.tpmByMinute.get(minuteBucket) ?? 0) + actualTokens);
  }

  /**
   * Установка режима паузы (Cooldown / Circuit Breaker) для ключа при получении 429.
   */
  async setCooldown(
    keyId: string,
    model: string | null,
    durationSeconds: number,
    reason: string,
  ): Promise<void> {
    const effectiveDuration = Math.max(1, durationSeconds);
    const now = Date.now();
    const isGlobal = !model || model === "all" || model === "*";

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        if (!isGlobal && model) {
          const normalizedModel = normalizeGeminiModel(model);
          const cooldownKey = `gemini:keys:${keyId}:${normalizedModel}:cooldown`;
          await redis.set(cooldownKey, reason, "EX", effectiveDuration);
        } else {
          const globalCooldownKey = `gemini:keys:${keyId}:cooldown`;
          await redis.set(globalCooldownKey, reason, "EX", effectiveDuration);
        }
      } catch {}
    }

    if (!isGlobal && model) {
      const record = this.getInMemoryRecord(keyId, model);
      record.cooldownUntil = now + effectiveDuration * 1000;
      record.cooldownReason = reason;
    } else {
      // Глобальный кулдаун для всех моделей ключа в in-memory
      this.inMemoryGlobalCooldown.set(keyId, {
        cooldownUntil: now + effectiveDuration * 1000,
        cooldownReason: reason,
      });
      for (const [comp, rec] of this.inMemoryMap.entries()) {
        if (comp.startsWith(`${keyId}:`)) {
          rec.cooldownUntil = now + effectiveDuration * 1000;
          rec.cooldownReason = reason;
        }
      }
    }
  }

  /**
   * Очистка статистики (для изолированных тестов).
   */
  async resetStats(): Promise<void> {
    this.inMemoryMap.clear();
    this.inMemoryGlobalCooldown.clear();
    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const keys = await redis.keys("gemini:keys:*");
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {}
    }
  }
}

export const geminiRateLimiter = new GeminiRateLimiter();
