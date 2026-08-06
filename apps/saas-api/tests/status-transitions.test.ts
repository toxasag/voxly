import { describe, expect, it } from 'vitest';
import { evaluateCrmAccess, GRACE_PERIOD_DAYS } from '@voxly/shared';

describe('evaluateCrmAccess status model', () => {
  it('allows an active paid subscription', () => {
    const ends = new Date();
    ends.setDate(ends.getDate() + 10);
    const access = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        endsAt: ends.toISOString(),
        periodMonths: 1,
      },
    });
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe('ok');
  });

  it('locks after trial ends', () => {
    const ends = new Date();
    ends.setDate(ends.getDate() - 1);
    const access = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        endsAt: ends.toISOString(),
        periodMonths: 0,
      },
    });
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('trial_ended');
  });

  it('allows paid subscription inside grace window', () => {
    const ends = new Date();
    ends.setDate(ends.getDate() - Math.max(1, GRACE_PERIOD_DAYS - 2));
    const access = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        endsAt: ends.toISOString(),
        periodMonths: 1,
      },
    });
    expect(access.allowed).toBe(true);
    expect(access.inGrace).toBe(true);
  });

  it('locks after grace ends', () => {
    const ends = new Date();
    ends.setDate(ends.getDate() - (GRACE_PERIOD_DAYS + 1));
    const access = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        endsAt: ends.toISOString(),
        periodMonths: 1,
      },
    });
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('subscription_grace_ended');
  });
});
