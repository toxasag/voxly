// Anti-flood guard: randomized inter-send delays, retry backoff, account
// cooldown helpers. Single source of truth for mailing limits/pauses
// (see docs/agent/MAILING-LIMITS.md).

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Uniform random integer in [min, max] inclusive. */
export function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Extra random spread (0..amount ms) to avoid a lockstep pattern. */
export function jitterMs(amount: number): number {
  return randomInt(0, Math.max(0, amount));
}

export type FloodActionKind = 'message' | 'story';

export interface FloodWindow {
  minMs: number;
  maxMs: number;
}

/** Safe defaults ("как положено"): 30–60s between messages, 180–300s between stories. */
export const FLOOD_DEFAULT_WINDOWS: Record<FloodActionKind, FloodWindow> = {
  message: { minMs: 30_000, maxMs: 60_000 },
  story: { minMs: 180_000, maxMs: 300_000 },
};

function envWindow(kind: FloodActionKind, fallback: FloodWindow): FloodWindow {
  const prefix = `FLOOD_${kind.toUpperCase()}`;
  const min = Number(process.env[`${prefix}_MIN_MS`]);
  const max = Number(process.env[`${prefix}_MAX_MS`]);
  return {
    minMs: Number.isFinite(min) && min >= 0 ? min : fallback.minMs,
    maxMs: Number.isFinite(max) && max >= 0 ? max : fallback.maxMs,
  };
}

/** Pure: pick the randomized delay for an action kind. Overridable per-call. */
export function pickFloodDelayMs(kind: FloodActionKind, window?: FloodWindow): number {
  const { minMs, maxMs } = window ?? envWindow(kind, FLOOD_DEFAULT_WINDOWS[kind]);
  return randomInt(minMs, maxMs);
}

/** Await a randomized pause appropriate for the action kind. */
export async function antiFloodPause(kind: FloodActionKind, window?: FloodWindow): Promise<void> {
  await sleep(pickFloodDelayMs(kind, window) + jitterMs(1_500));
}

/** Retry backoff for transient rate limits (429/FloodWait): 1s → 5s → 30s. */
export const FLOOD_RETRY_BACKOFF_MS = [1_000, 5_000, 30_000];

export function retryBackoffMs(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, FLOOD_RETRY_BACKOFF_MS.length - 1));
  return FLOOD_RETRY_BACKOFF_MS[i] + jitterMs(1_000);
}

/**
 * Warm-up multiplier for a fresh account (see docs/agent/MAILING-LIMITS.md).
 * day1 → 10%, day2-3 → 30%, day4-7 → 60%, day8+ → 100%.
 */
export function warmupFactor(ageDays: number): number {
  if (ageDays < 1) return 0.1;
  if (ageDays < 4) return 0.3;
  if (ageDays < 8) return 0.6;
  return 1;
}

/** Daily story limit by Telegram Premium status (1 non-premium / 100 premium). */
export function telegramStoryDailyLimit(isPremium: boolean, configurablePremiumLimit = 100): number {
  return isPremium ? configurablePremiumLimit : 1;
}

/** Redis key for per-account daily outbound counter (tg:day:{bot}:{date}:sent). */
export function dailyCounterKey(botId: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `tg:day:${botId}:${day}:sent`;
}

/** Redis key for per-account daily stories counter (tg:day:{bot}:{date}:stories). */
export function dailyStoryCounterKey(botId: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `tg:day:${botId}:${day}:stories`;
}

/** Per-channel safe defaults for daily outbound messages (docs/agent/MAILING-LIMITS.md). */
export const DEFAULT_DAILY_SEND_LIMIT: Record<string, number> = {
  gift: 100,
  gift_max: 200,
  ai_tg: 100,
  ai_gramjs: 200,
  ai_wa: 300,
  ai_max: 200,
};

/** Per-channel safe defaults for daily stories (0 = channel has no stories). */
export const DEFAULT_DAILY_STORY_LIMIT: Record<string, number> = {
  ai_gramjs: 100, // effective by premium via telegramStoryDailyLimit; 100 = ceiling
  ai_wa: 20,
};

/**
 * Effective daily message limit: explicit BotInstance override wins; else channel
 * default scaled by the warm-up curve when `warmupSince` is set (Job 1C.2).
 * Day 1 → 10%, day 2–3 → 30%, day 4–7 → 60%, day 8+ → 100% (warmupFactor).
 */
export function dailySendLimitFor(
  botType: string,
  override: number | null | undefined,
  warmupSince: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (typeof override === 'number' && override > 0) return override;
  const base = DEFAULT_DAILY_SEND_LIMIT[botType] ?? 200;
  if (!warmupSince) return base;
  const ageDays = Math.max(0, (now.getTime() - warmupSince.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(base * warmupFactor(ageDays)));
}

/** Effective daily story limit: override wins; ai_gramjs depends on premium (1/100); ai_wa = 20; others 0. */
export function dailyStoryLimitFor(
  botType: string,
  isPremium: boolean | null | undefined,
  override: number | null | undefined,
): number {
  if (typeof override === 'number' && override > 0) return override;
  if (botType === 'ai_gramjs') return telegramStoryDailyLimit(isPremium === true);
  return DEFAULT_DAILY_STORY_LIMIT[botType] ?? 0;
}
