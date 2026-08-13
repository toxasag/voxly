import { describe, it, expect } from 'vitest';
import { buildUsageChargeKey } from '../src/ai-usage-queue';

describe('buildUsageChargeKey', () => {
  it('builds a deterministic key from a stable external id', () => {
    const key = buildUsageChargeKey({
      channel: 'ai_tg',
      tenantId: 't1',
      requestType: 'transcribe',
      externalId: 'msg-42',
    });
    expect(key).toBe('ai_tg:t1:transcribe:msg-42');
  });

  it('is stable across repeated calls with the same external id (idempotency)', () => {
    const params = {
      channel: 'ai_wa',
      tenantId: 't2',
      requestType: 'vision',
      externalId: 'wamid.abc',
    };
    expect(buildUsageChargeKey(params)).toBe(buildUsageChargeKey(params));
  });

  it('falls back to a random suffix when no external id is available', () => {
    const a = buildUsageChargeKey({ channel: 'ai_tg', tenantId: 't3', requestType: 'vision' });
    const b = buildUsageChargeKey({ channel: 'ai_tg', tenantId: 't3', requestType: 'vision' });
    expect(a).not.toBe(b);
    expect(a.startsWith('ai_tg:t3:vision:')).toBe(true);
  });
});
