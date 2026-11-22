// ---------------------------------------------------------------------------
// Короткий Redis-кэш аутентификации (пользователь + установленные модули).
//
// Убирает 2 обязательных SELECT-запроса к Postgres на каждый защищённый API-
// запрос (на 100 RPS это ~200 SELECT/s экономии). При любой мутации прав,
// роли, профиля, увольнения или установки/удаления модуля вызывается
// синхронная инвалидация соответствующих ключей.
//
// Fail-open: при недоступности Redis (или в NODE_ENV=test) все функции
// прозрачно возвращают cache miss / no-op, и authenticate идёт напрямую в БД.
// ---------------------------------------------------------------------------

import { deleteKeysByPattern, getRedisClient, isRedisAvailable } from "../infrastructure/redis.js";
import type { User } from "../types/index.js";

export const AUTH_CACHE_TTL_SECONDS = 30;

export function authUserCacheKey(tenantId: string, userId: string): string {
  return `auth:user:${tenantId}:${userId}`;
}

export function tenantModulesCacheKey(tenantId: string): string {
  return `auth:mods:${tenantId}`;
}

function getCacheClient() {
  if (process.env.NODE_ENV === "test") return null;
  if (!isRedisAvailable()) return null;
  return getRedisClient();
}

export async function getCachedAuthUser(tenantId: string, userId: string): Promise<User | null> {
  const redis = getCacheClient();
  if (!redis) return null;

  try {
    const raw = await redis.get(authUserCacheKey(tenantId, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<User>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.tenant_id !== "string" ||
      typeof candidate.role !== "string" ||
      !Array.isArray(candidate.permissions)
    ) {
      return null;
    }
    return candidate as User;
  } catch {
    return null;
  }
}

export async function setCachedAuthUser(user: User): Promise<void> {
  const redis = getCacheClient();
  if (!redis) return;

  try {
    await redis.set(
      authUserCacheKey(user.tenant_id, user.id),
      JSON.stringify(user),
      "EX",
      AUTH_CACHE_TTL_SECONDS,
    );
  } catch {
    // Ошибка записи кэша не должна ломать авторизованный запрос.
  }
}

export async function getCachedTenantModules(tenantId: string): Promise<string[] | null> {
  const redis = getCacheClient();
  if (!redis) return null;

  try {
    const raw = await redis.get(tenantModulesCacheKey(tenantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedTenantModules(tenantId: string, modules: string[]): Promise<void> {
  const redis = getCacheClient();
  if (!redis) return;

  try {
    await redis.set(
      tenantModulesCacheKey(tenantId),
      JSON.stringify(modules),
      "EX",
      AUTH_CACHE_TTL_SECONDS,
    );
  } catch {
    // Ошибка записи кэша не должна ломать запрос.
  }
}

/** Инвалидирует кэш конкретного пользователя (смена роли, прав, профиля, удаление). */
export async function invalidateAuthUserCache(tenantId: string, userId: string): Promise<void> {
  const redis = getCacheClient();
  if (!redis) return;

  try {
    await redis.del(authUserCacheKey(tenantId, userId));
  } catch {
    // Игнорируем временную недоступность Redis; TTL 30s ограничит окно рассинхрона.
  }
}

/** Инвалидирует кэш установленных модулей тенанта (установка / удаление модуля). */
export async function invalidateTenantModulesCache(tenantId: string): Promise<void> {
  const redis = getCacheClient();
  if (!redis) return;

  try {
    await redis.del(tenantModulesCacheKey(tenantId));
  } catch {
    // Игнорируем временную недоступность Redis.
  }
}

/** Инвалидирует кэш всех пользователей и модулей тенанта (смена статуса партнёра, удаление тенанта). */
export async function invalidateTenantAuthCache(tenantId: string): Promise<void> {
  const redis = getCacheClient();
  if (!redis) return;

  try {
    await Promise.all([
      deleteKeysByPattern(redis, `auth:user:${tenantId}:*`),
      redis.del(tenantModulesCacheKey(tenantId)),
    ]);
  } catch {
    // Игнорируем временную недоступность Redis.
  }
}
