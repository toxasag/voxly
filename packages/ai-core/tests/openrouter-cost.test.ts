import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeCostUsdFromTokens,
  costUsdFromOpenRouter,
  parsePricingField,
  resetOpenRouterPricingCache,
  usdToProviderCostRub,
  type ModelTokenPricing,
} from '../src/openrouter-cost';

describe('parsePricingField', () => {
  it('parses string and number', () => {
    expect(parsePricingField('0.00000015')).toBeCloseTo(0.00000015);
    expect(parsePricingField(0.5)).toBe(0.5);
    expect(parsePricingField(undefined)).toBe(0);
  });
});

describe('computeCostUsdFromTokens', () => {
  const pricing: ModelTokenPricing = {
    prompt: 0.15 / 1_000_000,
    completion: 0.6 / 1_000_000,
  };

  it('uses prompt + completion separately', () => {
    const usd = computeCostUsdFromTokens(pricing, {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(0.75, 6);
  });

  it('falls back to average when only total_tokens', () => {
    const usd = computeCostUsdFromTokens(pricing, { total_tokens: 1_000_000 });
    expect(usd).toBeCloseTo(0.375, 6);
  });
});

describe('costUsdFromOpenRouter', () => {
  beforeEach(() => resetOpenRouterPricingCache());

  it('ignores usage.cost zero and falls through to pricing', () => {
    const map = new Map<string, ModelTokenPricing>([
      [
        'google/gemini-2.5-flash',
        { prompt: 0.15 / 1_000_000, completion: 0.6 / 1_000_000 },
      ],
    ]);
    const r = costUsdFromOpenRouter({
      model: 'google/gemini-2.5-flash',
      usage: { cost: 0, total_tokens: 1_000_000 },
      pricingByModel: map,
    });
    expect(r.source).toBe('models_pricing');
    expect(r.costUsd).toBeCloseTo(0.375, 6);
  });

  it('prefers positive usage.cost', () => {
    const r = costUsdFromOpenRouter({
      model: 'google/gemini-2.5-flash',
      usage: { cost: 0.0123, total_tokens: 100 },
    });
    expect(r.source).toBe('usage.cost');
    expect(r.costUsd).toBe(0.0123);
  });

  it('uses models pricing when cost missing', () => {
    const map = new Map<string, ModelTokenPricing>([
      [
        'openai/gpt-4o-mini',
        { prompt: 0.15 / 1_000_000, completion: 0.6 / 1_000_000 },
      ],
    ]);
    const r = costUsdFromOpenRouter({
      model: 'openai/gpt-4o-mini',
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
      pricingByModel: map,
    });
    expect(r.source).toBe('models_pricing');
    expect(r.costUsd).toBeCloseTo(0.15 / 1000 + 0.6 / 2000, 8);
  });

  it('uses hardcoded fallback when no pricing map', () => {
    const r = costUsdFromOpenRouter({
      model: 'unknown/model',
      usage: { total_tokens: 1_000_000 },
    });
    expect(r.source).toBe('hardcoded_fallback');
    expect(r.costUsd).toBeCloseTo(0.375, 6);
  });
});

describe('usdToProviderCostRub', () => {
  it('converts and rounds to 4 dp', () => {
    expect(usdToProviderCostRub(0.01, 90)).toBe(0.9);
    expect(usdToProviderCostRub(0.001234, 90)).toBe(0.1111);
  });
});
