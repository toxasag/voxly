import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERIOD_DISCOUNTS, PRICING, PRODUCT_CODES, TRIAL_PERIOD_DAYS } from '@voxly/shared';

const here = dirname(fileURLToPath(import.meta.url));

describe('segment configurability without core rewrites', () => {
  it('keeps catalogue prices in @voxly/shared, not hardcoded-only in portal pages', () => {
    const portalAi = readFileSync(
      resolve(here, '../../saas-portal/src/app/dashboard/ai/page.tsx'),
      'utf8',
    );
    expect(portalAi).toMatch(/PRICING|@voxly\/shared/);
    expect(PRICING.AI_TELEGRAM_MONTHLY).toBe(1000);
    expect(PRICING.AI_AGENT_MONTHLY).toBe(500);
    expect(TRIAL_PERIOD_DAYS).toBe(7);
    expect(PERIOD_DISCOUNTS[12]).toBe(10);
    expect(PRODUCT_CODES.AI_TOPUP).toBe('ai_topup');
  });
});
