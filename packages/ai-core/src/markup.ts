// Pure AI markup/cost helpers — kept free of Prisma imports for unit testing.

/**
 * Apply the tenant's AI markup percentage to a provider cost.
 * Result is rounded to 4 decimal places (kopecks × 0.0001).
 */
export function applyMarkup(providerCostRub: number, markupPercent: number): number {
  return Math.round(providerCostRub * (1 + markupPercent / 100) * 10000) / 10000;
}
