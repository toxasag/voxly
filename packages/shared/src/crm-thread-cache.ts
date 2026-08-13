// CRM chat thread-list cache (Phase 2.2).
//
// `GET /api/crm-chat/:recordId` resolves the thread list (`listCrmChatTargets`)
// by scanning GiftSubscriber + Conversation (+ CrmRecordLink) across channels —
// expensive to run on every poll of the CRM chat panel. We cache the resolved
// thread list in Redis for a few seconds and invalidate it when a worker stores
// an inbound message for the same CRM record, so a new message shows up at once
// instead of waiting for the TTL.
//
// The helpers take a minimal Redis-like client (`get`/`set`/`del`) so this stays
// in `@voxly/shared` without an ioredis dependency and is trivially unit-testable.
// Messages themselves are always read live in the route — only the thread list
// (channel pills / target metadata) is cached here.

/** Seconds a resolved thread list stays cached. Kept in the 5–10s window (TZ 2.2). */
export const CRM_THREAD_CACHE_TTL_SEC = 8;

/** Cache key for a tenant's resolved thread list for one CRM record (Person/Opportunity id). */
export function crmThreadCacheKey(tenantId: string, recordId: string): string {
  return `crm:threads:${tenantId}:${recordId}`;
}

/** Minimal Redis surface used by the cache (satisfied by ioredis). */
export interface CrmThreadCacheRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/** Read a cached thread list; returns parsed value or null on miss / any error. */
export async function readCrmThreadCache<T>(
  redis: Pick<CrmThreadCacheRedis, 'get'>,
  tenantId: string,
  recordId: string,
): Promise<T | null> {
  try {
    const raw = await redis.get(crmThreadCacheKey(tenantId, recordId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null; // Cache is best-effort — fall through to a live resolve.
  }
}

/** Store a resolved thread list with the shared TTL. Best-effort (errors swallowed). */
export async function writeCrmThreadCache(
  redis: Pick<CrmThreadCacheRedis, 'set'>,
  tenantId: string,
  recordId: string,
  value: unknown,
): Promise<void> {
  try {
    await redis.set(
      crmThreadCacheKey(tenantId, recordId),
      JSON.stringify(value),
      'EX',
      CRM_THREAD_CACHE_TTL_SEC,
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Invalidate the thread-list cache for every record id touched by an inbound
 * message (the conversation's Person id and Opportunity id). Deduplicates and
 * ignores empty ids; safe to call with both ids where either may be null.
 */
export async function invalidateCrmThreadCache(
  redis: Pick<CrmThreadCacheRedis, 'del'>,
  tenantId: string,
  recordIds: Array<string | null | undefined>,
): Promise<void> {
  const keys = [
    ...new Set(recordIds.filter((id): id is string => Boolean(id))),
  ].map((id) => crmThreadCacheKey(tenantId, id));
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}

/** Seconds a read-receipt fire is suppressed after firing once (Phase 2.5 debounce). */
export const CRM_READ_DEBOUNCE_SEC = 10;

/** Debounce key for read-receipt firing on one conversation. */
export function crmReadDebounceKey(tenantId: string, conversationId: string): string {
  return `crm:read:${tenantId}:${conversationId}`;
}

/**
 * Claim a read-receipt fire for a conversation. Returns true when the caller
 * should actually mark-read / fire channel read receipts, false when a fire
 * already happened inside the debounce window. Best-effort: on any Redis error
 * it returns true so behavior degrades to "always fire" (never silently drops
 * a read on a real error). Uses get+set (a tiny race is acceptable for a
 * debounce — worst case two fires instead of one).
 */
export async function claimCrmReadDebounce(
  redis: Pick<CrmThreadCacheRedis, 'get' | 'set'>,
  tenantId: string,
  conversationId: string,
  windowSec: number = CRM_READ_DEBOUNCE_SEC,
): Promise<boolean> {
  const key = crmReadDebounceKey(tenantId, conversationId);
  try {
    const existing = await redis.get(key);
    if (existing) return false;
    await redis.set(key, '1', 'EX', windowSec);
    return true;
  } catch {
    return true;
  }
}
