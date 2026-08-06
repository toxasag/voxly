import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Regression guard: the two hottest unbounded findMany sites must keep a take: cap. */
describe('findMany take guards', () => {
  it('caps broadcast audience conversations', () => {
    const src = readFileSync(resolve(here, '../src/routes/bots.ts'), 'utf8');
    const idx = src.indexOf('resolveChannelBroadcastAudience');
    const slice = src.slice(idx, idx + 800);
    expect(slice).toContain('take: 10_000');
  });

  it('caps partner dashboard referrals and transactions', () => {
    const src = readFileSync(resolve(here, '../src/services/referral-program.ts'), 'utf8');
    expect(src).toContain('take: 500');
    expect(src).toContain('take: 200');
  });
});
