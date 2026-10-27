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

  if (!redisUrl) {
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 4000,
      retryStrategy(times: number) {
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
 * Параметры подключения к Redis для BullMQ / ioredis.
 */
export function getRedisConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  maxRetriesPerRequest: null;
  enableOfflineQueue?: boolean;
  connectTimeout?: number;
  retryStrategy?: (times: number) => number | null;
} | null {
  let redisUrl: string | undefined;
  try {
    const env = getEnv();
    redisUrl = env.REDIS_URL || process.env.REDIS_URL;
  } catch {
    redisUrl = process.env.REDIS_URL;
  }

  if (!redisUrl) {
    return null;
  }

  try {
    const parsed = new URL(redisUrl);
    const dbNum = parsed.pathname ? parseInt(parsed.pathname.replace(/^\//, ""), 10) || 0 : 0;
    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      db: dbNum,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      retryStrategy(times: number) {
        if (times > 3) return null;
        return Math.min(times * 300, 1500);
      },
    };
  } catch {
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
