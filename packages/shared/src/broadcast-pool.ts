// Broadcast account pool: least-loaded selection helpers
// (docs/agent/MAILING-LIMITS.md «Ротация аккаунтов», Job 1B.1).

export interface BroadcastPoolCandidate {
  id: string;
  /** Current per-day outbound count (Redis tg:day:{bot}:{date}:sent). */
  used: number;
  /** Effective daily limit for the account. */
  limit: number;
  /** Flooded / spam-blocked by the platform until this time (skip while in future). */
  floodedUntil?: Date | string | null;
}

export function isBotFlooded(
  candidate: BroadcastPoolCandidate,
  now: Date = new Date(),
): boolean {
  if (!candidate.floodedUntil) return false;
  const until =
    candidate.floodedUntil instanceof Date
      ? candidate.floodedUntil
      : new Date(candidate.floodedUntil);
  return until.getTime() > now.getTime();
}

/**
 * Whole-pool pause (Job 1B.4): when NO candidate is available, return the
 * resume timestamp (nearest future `floodedUntil`) if the cause is a flood —
 * the caller should pause the job until then instead of failing it.
 * Returns null when the pool still has available accounts or when the
 * exhaustion is the daily limit (no flood pending) — fail in that case.
 */
export function poolPauseUntil(
  candidates: BroadcastPoolCandidate[],
  now: Date = new Date(),
): number | null {
  const hasAvailable = candidates.some(
    (c) => c.used < c.limit && !isBotFlooded(c, now),
  );
  if (hasAvailable) return null;
  let nearest: number | null = null;
  for (const candidate of candidates) {
    if (!candidate.floodedUntil) continue;
    const t =
      candidate.floodedUntil instanceof Date
        ? candidate.floodedUntil.getTime()
        : new Date(candidate.floodedUntil).getTime();
    if (t > now.getTime() && (nearest === null || t < nearest)) nearest = t;
  }
  return nearest;
}

/**
 * Least-loaded available account from the pool: minimal used count among
 * non-flooded candidates that are still below their daily limit.
 * Returns null when the whole pool is exhausted or blocked.
 */
export function pickLeastLoadedBot(
  candidates: BroadcastPoolCandidate[],
  now: Date = new Date(),
): BroadcastPoolCandidate | null {
  let best: BroadcastPoolCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.used >= candidate.limit) continue;
    if (isBotFlooded(candidate, now)) continue;
    if (!best || candidate.used < best.used) best = candidate;
  }
  return best;
}

/**
 * Pool ids from a broadcast messageJson: `botIds[]` with `botId` fallback
 * (backward-compatible with broadcasts scheduled before the pool existed).
 */
export function broadcastPoolIds(msg: {
  botId?: unknown;
  botIds?: unknown;
} | null | undefined): string[] {
  if (!msg) return [];
  const ids: string[] = [];
  if (Array.isArray(msg.botIds)) {
    for (const id of msg.botIds) {
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
    }
  }
  if (typeof msg.botId === 'string' && msg.botId && !ids.includes(msg.botId)) {
    ids.push(msg.botId);
  }
  return ids;
}
