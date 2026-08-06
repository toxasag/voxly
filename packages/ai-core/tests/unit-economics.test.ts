import { describe, expect, it } from 'vitest';
import { applyMarkup } from '../src/markup.js';

describe('AI unit-economics invariants', () => {
  it('charged amount is never below provider cost when markup ≥ 0', () => {
    for (const cost of [0.01, 0.5, 1, 12.34, 100]) {
      for (const markup of [0, 10, 50, 100]) {
        const charged = applyMarkup(cost, markup);
        expect(charged).toBeGreaterThanOrEqual(cost - 1e-9);
      }
    }
  });

  it('applies markup exactly once (no double compounding)', () => {
    const cost = 10;
    const once = applyMarkup(cost, 50);
    expect(once).toBe(15);
    // Mistakenly applying again would yield 22.5 — guard the formula shape.
    expect(applyMarkup(once, 50)).toBe(22.5);
    expect(once).not.toBe(22.5);
  });

  it('zero provider cost yields zero charge', () => {
    expect(applyMarkup(0, 50)).toBe(0);
  });
});
