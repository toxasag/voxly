import { describe, it, expect } from 'vitest';
import { applyMarkup } from '../src/markup';

describe('applyMarkup', () => {
  it('applies a 50% markup', () => {
    // 1.00 * 1.50 = 1.5
    expect(applyMarkup(1, 50)).toBe(1.5);
  });

  it('applies a 0% markup (identity)', () => {
    expect(applyMarkup(2.5, 0)).toBe(2.5);
  });

  it('rounds to 4 decimal places', () => {
    // 1.23456 * 1.5 = 1.85184 -> rounded to 1.8518 (4 dp)
    expect(applyMarkup(1.23456, 50)).toBe(1.8518);
  });

  it('handles a 100% markup (double)', () => {
    expect(applyMarkup(10, 100)).toBe(20);
  });

  it('handles fractional provider costs', () => {
    // 0.15 * 1.5 = 0.225 -> 0.225
    expect(applyMarkup(0.15, 50)).toBe(0.225);
  });
});
