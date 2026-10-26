import { Redis } from "ioredis";
import { getEnv } from "../config/env.js";

let redisInstance: Redis | null = null;
let isConnected = false;
let initAttempted = false;

/**
 * Получение единого инстанса ioredis.
 * При отсутствии REDIS_URL или недоступности сервера возвращает null,
 * позволяя подсистемам прозрачно переключаться на in-memory fallback.
 */
export function getRedisClient(): Redis | null {
  if (redisInstance) {
    return isConnected ? redisInstance : null;
  }

  if (initAttempted) {
    return null;
  }

  initAttempted = true;

  let redisUrl: string | undefined;
  try {
    const env = getEnv();
    redisUrl = env.REDIS_URL || process.env.REDIS_URL;
  } catch {
    redisUrl = process.env.REDIS_URL;
  }

  // Если URL не задан явно, в production используем контейнер automation-redis-1
  if (!redisUrl && process.env.NODE_ENV === "production") {
    redisUrl = "redis://automation-redis-1:6379";
  }

  if (!redisUrl) {
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 4000,
      retryStrategy(times) {
        if (times > 5) return null; // Прекращаем попытки при длительном отсутствии Redis
        return Math.min(times * 300, 2000);
      },
    });

    client.on("connect", () => {
      isConnected = true;
    });

    client.on("ready", () => {
      isConnected = true;
    });

    client.on("error", (err: unknown) => {
      isConnected = false;
      if (process.env.NODE_ENV !== "test") {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Redis] connection warning: ${msg}`);
      }
    });

    client.on("close", () => {
      isConnected = false;
    });

    redisInstance = client;
    return client;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Redis] initialization error: ${msg}`);
    return null;
  }
}

/**
 * Проверка доступности активного соединения с Redis.
 */
export function isRedisAvailable(): boolean {
  return isConnected && redisInstance !== null;
}

/**
 * Закрытие соединения (для юнит-тестов и graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    } finally {
      redisInstance = null;
      isConnected = false;
      initAttempted = false;
    }
  }
}
