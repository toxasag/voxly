// CRM unread-badge aggregate cache (Phase 2.4).
//
// `GET /api/crm-chat/unread-badges` recomputes per-Person / per-Opportunity unread
// counts with a raw SQL scan over ChatMessage⋈Conversation. shell-ux polls this
// frequently for the CRM board/list badges, so we cache the small aggregated
// response in Redis for a few seconds. SQL remains the authoritative source: on a
// cache miss we recompute and repopulate. Workers invalidate on inbound and the
// API invalidates when an operator opens a chat (marks read), so counts stay fresh
// without waiting for the TTL.
//
// Uses the same minimal Redis surface as crm-thread-cache (get/set/del) so it lives
// in @voxly/shared without an ioredis dependency and is unit-testable.

/** Seconds the aggregated unread-badge response stays cached. */
export const CRM_UNREAD_CACHE_TTL_SEC = 8;

/** Cache key for a tenant's aggregated unread-badge response. */
export function crmUnreadCacheKey(tenantId: string): string {
  return `crm:unread:${tenantId}`;
}

/** Minimal Redis surface (satisfied by ioredis). */
export interface CrmUnreadCacheRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/** Read cached unread aggregate; null on miss / any error (→ recompute from SQL). */
export async function readCrmUnreadCache<T>(
  redis: Pick<CrmUnreadCacheRedis, 'get'>,
  tenantId: string,
): Promise<T | null> {
  try {
    const raw = await redis.get(crmUnreadCacheKey(tenantId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Store the aggregated unread response with the shared TTL. Best-effort. */
export async function writeCrmUnreadCache(
  redis: Pick<CrmUnreadCacheRedis, 'set'>,
  tenantId: string,
  value: unknown,
): Promise<void> {
  try {
    await redis.set(
      crmUnreadCacheKey(tenantId),
      JSON.stringify(value),
      'EX',
      CRM_UNREAD_CACHE_TTL_SEC,
    );
  } catch {
    /* best-effort */
  }
}

/** Invalidate a tenant's unread aggregate (on inbound or on operator read). Best-effort. */
export async function invalidateCrmUnreadCache(
  redis: Pick<CrmUnreadCacheRedis, 'del'>,
  tenantId: string,
): Promise<void> {
  try {
    await redis.del(crmUnreadCacheKey(tenantId));
  } catch {
    /* best-effort */
  }
}
