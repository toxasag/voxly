// OpenRouter cost resolution: prefer usage.cost, else live /models pricing, else fallback.

import { prisma } from '@voxly/db';

export type CostSource = 'usage.cost' | 'models_pricing' | 'hardcoded_fallback';

/** Subset of OpenRouter chat/audio usage (SDK types omit `cost`). */
export interface OpenRouterUsageLike {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost?: number | null;
}

export interface ModelTokenPricing {
  /** USD per prompt token */
  prompt: number;
  /** USD per completion token */
  completion: number;
  request?: number;
  image?: number;
  audio?: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
/** Last resort if /models unreachable — openai/gpt-4o-mini ballpark (USD/token). */
const FALLBACK_PRICING: ModelTokenPricing = {
  prompt: 0.15 / 1_000_000,
  completion: 0.6 / 1_000_000,
};
const DEFAULT_USD_RUB = 90;

let cache: { fetchedAt: number; byId: Map<string, ModelTokenPricing> } | null = null;

export function parsePricingField(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function computeCostUsdFromTokens(
  pricing: ModelTokenPricing,
  usage: OpenRouterUsageLike,
): number {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  if (prompt > 0 || completion > 0) {
    return prompt * pricing.prompt + completion * pricing.completion + (pricing.request || 0);
  }
  const total = usage.total_tokens ?? 0;
  if (total > 0) {
    const avg = (pricing.prompt + pricing.completion) / 2;
    return total * avg + (pricing.request || 0);
  }
  return pricing.request || 0;
}

export function costUsdFromOpenRouter(opts: {
  usage?: OpenRouterUsageLike | null;
  model: string;
  pricingByModel?: Map<string, ModelTokenPricing> | null;
}): { costUsd: number; source: CostSource; tokens: number } {
  const usage = opts.usage || {};
  const tokens =
    usage.total_tokens ?? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost > 0) {
    return { costUsd: usage.cost, source: 'usage.cost', tokens };
  }
  // usage.cost === 0 is common when OpenRouter omits real cost — fall through to pricing.

  const pricing =
    opts.pricingByModel?.get(opts.model) ||
    (opts.model.includes('/')
      ? null
      : opts.pricingByModel?.get(`openai/${opts.model}`)) ||
    null;

  if (pricing) {
    return {
      costUsd: computeCostUsdFromTokens(pricing, usage),
      source: 'models_pricing',
      tokens,
    };
  }

  return {
    costUsd: computeCostUsdFromTokens(FALLBACK_PRICING, usage),
    source: 'hardcoded_fallback',
    tokens,
  };
}

export function usdToProviderCostRub(costUsd: number, usdRubRate: number): number {
  const rate = Number.isFinite(usdRubRate) && usdRubRate > 0 ? usdRubRate : DEFAULT_USD_RUB;
  return Math.round(costUsd * rate * 10000) / 10000;
}

/** Test helper — clears the in-memory /models cache. */
export function resetOpenRouterPricingCache(): void {
  cache = null;
}

export async function loadOpenRouterModelPricing(opts: {
  apiKey: string;
  baseUrl?: string;
  force?: boolean;
}): Promise<Map<string, ModelTokenPricing>> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.byId;
  }

  const base = (opts.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!res.ok) {
    if (cache) return cache.byId;
    throw new Error(`OpenRouter /models HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: Record<string, unknown> }>;
  };
  const byId = new Map<string, ModelTokenPricing>();
  for (const m of json.data || []) {
    if (!m.id || !m.pricing) continue;
    byId.set(m.id, {
      prompt: parsePricingField(m.pricing.prompt),
      completion: parsePricingField(m.pricing.completion),
      request: parsePricingField(m.pricing.request) || undefined,
      image: parsePricingField(m.pricing.image) || undefined,
      audio: parsePricingField(m.pricing.audio) || undefined,
    });
  }
  cache = { fetchedAt: now, byId };
  return byId;
}

/**
 * USD→RUB: env `USD_RUB_RATE` > platformSetting `usd_rub_rate` > 90.
 */
export async function getUsdRubRate(): Promise<number> {
  const env = process.env.USD_RUB_RATE;
  if (env) {
    const n = parseFloat(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try {
    const setting = await prisma.platformSetting.findUnique({
      where: { key: 'usd_rub_rate' },
    });
    if (setting) {
      const n = parseFloat(setting.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* ignore — workers may call before DB ready */
  }
  return DEFAULT_USD_RUB;
}

export async function resolveProviderCostRub(opts: {
  model: string;
  usage?: OpenRouterUsageLike | null;
  apiKey?: string;
  baseUrl?: string;
}): Promise<{
  providerCostRub: number;
  costUsd: number;
  tokens: number;
  source: CostSource;
  usdRubRate: number;
}> {
  const hasUsageCost =
    typeof opts.usage?.cost === 'number' &&
    Number.isFinite(opts.usage.cost) &&
    opts.usage.cost > 0;

  let pricingByModel: Map<string, ModelTokenPricing> | null = null;
  if (!hasUsageCost && opts.apiKey) {
    try {
      pricingByModel = await loadOpenRouterModelPricing({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
      });
    } catch (err) {
      console.warn(
        '[ai-core] OpenRouter /models pricing fetch failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const { costUsd, source, tokens } = costUsdFromOpenRouter({
    usage: opts.usage,
    model: opts.model,
    pricingByModel,
  });

  const usdRubRate = await getUsdRubRate();
  return {
    providerCostRub: usdToProviderCostRub(costUsd, usdRubRate),
    costUsd,
    tokens,
    source,
    usdRubRate,
  };
}
