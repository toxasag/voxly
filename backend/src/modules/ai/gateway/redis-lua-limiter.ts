import crypto from "node:crypto";
import { getRedisClient, isRedisAvailable } from "../../../infrastructure/redis.js";
import type { ModelLimits, SlotReservationCheck } from "./gateway.types.js";

/**
 * Lua-скрипт атомарной проверки квот и резервирования слота.
 * Выполняется неделимо в Redis, предотвращая race condition при параллельных запросах
 * от множества инстансов Fastify.
 */
const RESERVE_SLOT_LUA = `
local cooldownKey = KEYS[1]
local globalCooldownKey = KEYS[2]
local circuitKey = KEYS[3]
local rpmWindowKey = KEYS[4]
local tpmMinuteKey = KEYS[5]
local rpdDayKey = KEYS[6]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxRpm = tonumber(ARGV[3])
local maxTpm = tonumber(ARGV[4])
local maxRpd = tonumber(ARGV[5])
local estimatedTokens = tonumber(ARGV[6])
local requestId = ARGV[7]
local secondsUntilMidnight = tonumber(ARGV[8])

-- 1. Проверка индивидуального кулдауна ключа для модели
local cdTtl = redis.call('TTL', cooldownKey)
if cdTtl > 0 then
  return {0, 'COOLDOWN', cdTtl}
end

-- 2. Проверка глобального кулдауна ключа
local globalTtl = redis.call('TTL', globalCooldownKey)
if globalTtl > 0 then
  return {0, 'COOLDOWN', globalTtl}
end

-- 3. Проверка Circuit Breaker для модели/провайдера
local circuitTtl = redis.call('TTL', circuitKey)
if circuitTtl > 0 then
  return {0, 'CIRCUIT_OPEN', circuitTtl}
end

-- 4. Очистка старых меток времени за пределами скользящего окна
local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', rpmWindowKey, 0, windowStart)

-- 5. Проверка RPM (Requests Per Minute)
local currentRpm = redis.call('ZCARD', rpmWindowKey)
if currentRpm >= maxRpm then
  return {0, 'RPM_LIMIT', 5}
end

-- 6. Проверка TPM (Tokens Per Minute)
local currentTpm = tonumber(redis.call('GET', tpmMinuteKey) or '0')
if currentTpm > 0 and (currentTpm + estimatedTokens) > maxTpm then
  return {0, 'TPM_LIMIT', 10}
end

-- 7. Проверка RPD (Requests Per Day), если задан
local currentRpd = 0
if maxRpd > 0 then
  currentRpd = tonumber(redis.call('GET', rpdDayKey) or '0')
  if currentRpd >= maxRpd then
    return {0, 'RPD_LIMIT', secondsUntilMidnight}
  end
end

-- 8. Все проверки пройдены: атомарно резервируем слот
redis.call('ZADD', rpmWindowKey, now, requestId)
redis.call('EXPIRE', rpmWindowKey, 120)

redis.call('INCRBY', tpmMinuteKey, estimatedTokens)
redis.call('EXPIRE', tpmMinuteKey, 120)

if maxRpd > 0 then
  redis.call('INCR', rpdDayKey)
  redis.call('EXPIRE', rpdDayKey, 172800) -- 48 часов
  currentRpd = currentRpd + 1
end

-- Расчет текущего индекса нагрузки ключа
local rpmRatio = currentRpm / maxRpm
local rpdRatio = 0
if maxRpd > 0 then
  rpdRatio = currentRpd / maxRpd
end
local loadScore = (rpmRatio * 0.65) + (rpdRatio * 0.35)

return {1, 'OK', tostring(loadScore)}
`;

export function getSecondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

interface InMemoryRecord {
  timestamps: number[];
  tpmByMinute: Map<number, number>;
  rpdByDay: Map<string, number>;
  cooldownUntil: number;
  cooldownReason?: string;
}

export class RedisLuaLimiter {
  private readonly inMemoryMap = new Map<string, InMemoryRecord>();
  private readonly inMemoryGlobalCooldown = new Map<string, { until: number; reason?: string }>();
  private readonly inMemoryCircuit = new Map<string, { openUntil: number; failures: number; lastFailure: number }>();

  private getCompositeKey(keyId: string, model: string): string {
    return `${keyId}:${model.toLowerCase().trim()}`;
  }

  private getInMemoryRecord(keyId: string, model: string): InMemoryRecord {
    const comp = this.getCompositeKey(keyId, model);
    let record = this.inMemoryMap.get(comp);
    if (!record) {
      record = {
        timestamps: [],
        tpmByMinute: new Map(),
        rpdByDay: new Map(),
        cooldownUntil: 0,
      };
      this.inMemoryMap.set(comp, record);
    }
    return record;
  }

  /**
   * Атомарное бронирование слота запроса через Redis Lua-скрипт (с in-memory fallback).
   */
  async reserveSlot(
    keyId: string,
    provider: string,
    model: string,
    limits: ModelLimits,
    estimatedTokens = 1000,
  ): Promise<SlotReservationCheck> {
    const normalizedModel = model.toLowerCase().trim();
    const now = Date.now();
    const windowMs = 60_000;
    const utcDateStr = new Date(now).toISOString().slice(0, 10);
    const minuteBucket = Math.floor(now / 60_000);
    const requestId = `${now}_${crypto.randomBytes(4).toString("hex")}`;
    const secondsUntilMidnight = getSecondsUntilUtcMidnight();

    const redis = isRedisAvailable() ? getRedisClient() : null;

    if (redis) {
      try {
        const cooldownKey = `llm:cooldown:${keyId}:${normalizedModel}`;
        const globalCooldownKey = `llm:cooldown:${keyId}:global`;
        const circuitKey = `llm:circuit:${provider}:${normalizedModel}`;
        const rpmWindowKey = `llm:keys:${keyId}:${normalizedModel}:rpm_window`;
        const tpmMinuteKey = `llm:keys:${keyId}:${normalizedModel}:tpm:${minuteBucket}`;
        const rpdDayKey = `llm:keys:${keyId}:${normalizedModel}:rpd:${utcDateStr}`;

        const result = (await redis.eval(
          RESERVE_SLOT_LUA,
          6,
          cooldownKey,
          globalCooldownKey,
          circuitKey,
          rpmWindowKey,
          tpmMinuteKey,
          rpdDayKey,
          now.toString(),
          windowMs.toString(),
          limits.rpm.toString(),
          limits.tpm.toString(),
          (limits.rpd ?? 0).toString(),
          estimatedTokens.toString(),
          requestId,
          secondsUntilMidnight.toString(),
        )) as [number, string, string | number];

        if (Array.isArray(result) && result[0] === 1) {
          const loadScore = parseFloat(String(result[2])) || 0;
          return { allowed: true, loadScore };
        } else if (Array.isArray(result)) {
          const reason = result[1] as SlotReservationCheck["reason"];
          const retryAfterSeconds = typeof result[2] === "number" ? result[2] : parseInt(String(result[2]), 10) || 10;
          return { allowed: false, reason, retryAfterSeconds, loadScore: 9999 };
        }
      } catch {
        // При сбое Redis бесшовно уходим в in-memory
      }
    }

    // In-Memory Fallback
    const circuitKey = `${provider}:${normalizedModel}`;
    const circuit = this.inMemoryCircuit.get(circuitKey);
    if (circuit && circuit.openUntil > now) {
      const ttl = Math.ceil((circuit.openUntil - now) / 1000);
      return { allowed: false, reason: "CIRCUIT_OPEN", retryAfterSeconds: ttl, loadScore: 9999 };
    }

    const globalCd = this.inMemoryGlobalCooldown.get(keyId);
    if (globalCd && globalCd.until > now) {
      const ttl = Math.ceil((globalCd.until - now) / 1000);
      return { allowed: false, reason: "COOLDOWN", retryAfterSeconds: ttl, loadScore: 9999 };
    }

    const record = this.getInMemoryRecord(keyId, normalizedModel);
    if (record.cooldownUntil > now) {
      const ttl = Math.ceil((record.cooldownUntil - now) / 1000);
      return { allowed: false, reason: "COOLDOWN", retryAfterSeconds: ttl, loadScore: 9999 };
    }

    record.timestamps = record.timestamps.filter((ts) => ts > now - windowMs);
    const currentRpm = record.timestamps.length;
    if (currentRpm >= limits.rpm) {
      return { allowed: false, reason: "RPM_LIMIT", retryAfterSeconds: 5, loadScore: 9999 };
    }

    const currentTpm = record.tpmByMinute.get(minuteBucket) ?? 0;
    if (currentTpm > 0 && currentTpm + estimatedTokens > limits.tpm) {
      return { allowed: false, reason: "TPM_LIMIT", retryAfterSeconds: 10, loadScore: 9999 };
    }

    const maxRpd = limits.rpd ?? 0;
    let currentRpd = 0;
    if (maxRpd > 0) {
      currentRpd = record.rpdByDay.get(utcDateStr) ?? 0;
      if (currentRpd >= maxRpd) {
        return { allowed: false, reason: "RPD_LIMIT", retryAfterSeconds: secondsUntilMidnight, loadScore: 9999 };
      }
      record.rpdByDay.set(utcDateStr, currentRpd + 1);
    }

    record.timestamps.push(now);
    record.tpmByMinute.set(minuteBucket, currentTpm + estimatedTokens);

    const rpmRatio = currentRpm / limits.rpm;
    const rpdRatio = maxRpd > 0 ? currentRpd / maxRpd : 0;
    const loadScore = rpmRatio * 0.65 + rpdRatio * 0.35;

    return { allowed: true, loadScore };
  }

  /**
   * Корректировка фактически израсходованных токенов после ответа LLM.
   */
  async recordTokens(
    keyId: string,
    model: string,
    actualTokens: number,
  ): Promise<void> {
    const normalizedModel = model.toLowerCase().trim();
    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const tpmMinuteKey = `llm:keys:${keyId}:${normalizedModel}:tpm:${minuteBucket}`;
        await redis.incrby(tpmMinuteKey, actualTokens);
        await redis.expire(tpmMinuteKey, 120);
      } catch {}
    }

    const record = this.getInMemoryRecord(keyId, normalizedModel);
    const current = record.tpmByMinute.get(minuteBucket) ?? 0;
    record.tpmByMinute.set(minuteBucket, current + actualTokens);
  }

  /**
   * Перевод ключа в статус COOLDOWN (при HTTP 429).
   */
  async setCooldown(
    keyId: string,
    model: string | null,
    seconds: number,
    reason: string,
  ): Promise<void> {
    const duration = Math.max(1, seconds);
    const now = Date.now();
    const isGlobal = !model || model === "all" || model === "*";

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        if (!isGlobal && model) {
          const normalizedModel = model.toLowerCase().trim();
          await redis.set(`llm:cooldown:${keyId}:${normalizedModel}`, reason, "EX", duration);
        } else {
          await redis.set(`llm:cooldown:${keyId}:global`, reason, "EX", duration);
        }
      } catch {}
    }

    if (!isGlobal && model) {
      const record = this.getInMemoryRecord(keyId, model);
      record.cooldownUntil = now + duration * 1000;
      record.cooldownReason = reason;
    } else {
      this.inMemoryGlobalCooldown.set(keyId, {
        until: now + duration * 1000,
        reason,
      });
      for (const [comp, rec] of this.inMemoryMap.entries()) {
        if (comp.startsWith(`${keyId}:`)) {
          rec.cooldownUntil = now + duration * 1000;
          rec.cooldownReason = reason;
        }
      }
    }
  }

  /**
   * Проверка кулдауна ключа.
   */
  async isCooldown(keyId: string, model: string): Promise<{ inCooldown: boolean; ttlSeconds: number; reason?: string }> {
    const normalizedModel = model.toLowerCase().trim();
    const now = Date.now();

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const cooldownKey = `llm:cooldown:${keyId}:${normalizedModel}`;
        const globalCooldownKey = `llm:cooldown:${keyId}:global`;

        const pipelineResults = await redis
          .pipeline()
          .ttl(cooldownKey)
          .get(cooldownKey)
          .ttl(globalCooldownKey)
          .get(globalCooldownKey)
          .exec();

        const cdTtl = typeof pipelineResults?.[0]?.[1] === "number" ? pipelineResults[0][1] : -2;
        const cdVal = typeof pipelineResults?.[1]?.[1] === "string" ? pipelineResults[1][1] : undefined;
        const gTtl = typeof pipelineResults?.[2]?.[1] === "number" ? pipelineResults[2][1] : -2;
        const gVal = typeof pipelineResults?.[3]?.[1] === "string" ? pipelineResults[3][1] : undefined;

        const inCooldown = cdTtl > 0 || gTtl > 0;
        const ttlSeconds = Math.max(cdTtl, gTtl, 0);
        const reason: string | undefined = cdVal || gVal;
        if (inCooldown) {
          return { inCooldown: true, ttlSeconds, reason };
        }
      } catch {}
    }

    const globalCd = this.inMemoryGlobalCooldown.get(keyId);
    if (globalCd && globalCd.until > now) {
      return {
        inCooldown: true,
        ttlSeconds: Math.ceil((globalCd.until - now) / 1000),
        reason: globalCd.reason,
      };
    }

    const record = this.getInMemoryRecord(keyId, normalizedModel);
    if (record.cooldownUntil > now) {
      return {
        inCooldown: true,
        ttlSeconds: Math.ceil((record.cooldownUntil - now) / 1000),
        reason: record.cooldownReason,
      };
    }

    return { inCooldown: false, ttlSeconds: 0 };
  }

  /**
   * Фиксация сбоя 5xx для Circuit Breaker.
   * Если число последовательных ошибок превышает порог (3), модель исключается на 30 с.
   */
  async recordFailure(provider: string, model: string, threshold = 3, cooloffSeconds = 30): Promise<boolean> {
    const normalizedModel = model.toLowerCase().trim();
    const circuitKey = `llm:circuit:${provider}:${normalizedModel}`;
    const failuresKey = `llm:circuit:${provider}:${normalizedModel}:failures`;

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const count = await redis.incr(failuresKey);
        await redis.expire(failuresKey, 60);

        if (count >= threshold) {
          await redis.set(circuitKey, "OPEN", "EX", cooloffSeconds);
          return true;
        }
      } catch {}
    }

    const memKey = `${provider}:${normalizedModel}`;
    const now = Date.now();
    let state = this.inMemoryCircuit.get(memKey);
    if (!state || now - state.lastFailure > 60_000) {
      state = { openUntil: 0, failures: 1, lastFailure: now };
    } else {
      state.failures += 1;
      state.lastFailure = now;
    }

    if (state.failures >= threshold) {
      state.openUntil = now + cooloffSeconds * 1000;
      this.inMemoryCircuit.set(memKey, state);
      return true;
    }
    this.inMemoryCircuit.set(memKey, state);
    return false;
  }

  /**
   * Сброс ошибок Circuit Breaker при успешном запросе.
   */
  async recordSuccess(provider: string, model: string): Promise<void> {
    const normalizedModel = model.toLowerCase().trim();
    const failuresKey = `llm:circuit:${provider}:${normalizedModel}:failures`;
    const circuitKey = `llm:circuit:${provider}:${normalizedModel}`;

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        await redis.del(failuresKey, circuitKey);
      } catch {}
    }

    const memKey = `${provider}:${normalizedModel}`;
    this.inMemoryCircuit.delete(memKey);
  }

  /**
   * Сброс всех счетчиков и кулдаунов (для тестов).
   */
  async resetAll(): Promise<void> {
    this.inMemoryMap.clear();
    this.inMemoryGlobalCooldown.clear();
    this.inMemoryCircuit.clear();

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const keys = await redis.keys("llm:*");
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {}
    }
  }
}

export const redisLuaLimiter = new RedisLuaLimiter();
