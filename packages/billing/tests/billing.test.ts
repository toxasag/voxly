import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  RobokassaClient,
  calculateSubscriptionPrice,
  calculateProratedSeatPrice,
} from '../src/index';

const config = {
  merchantLogin: 'voxly',
  password1: 'pass1',
  password2: 'pass2',
  isTest: true,
};

describe('calculateSubscriptionPrice', () => {
  it('applies period discount correctly', () => {
    // 500/mo * 12 months with 10% discount = 6000 - 600 = 5400
    expect(calculateSubscriptionPrice(500, 12, 10)).toBe(5400);
  });

  it('no discount for 1 month', () => {
    expect(calculateSubscriptionPrice(500, 1, 0)).toBe(500);
  });

  it('rounds to 2 decimals', () => {
    // 500 * 6 * 0.95 = 2850
    expect(calculateSubscriptionPrice(500, 6, 5)).toBe(2850);
  });
});

describe('calculateProratedSeatPrice', () => {
  it('prorates by remaining days', () => {
    // 300 * (15/30) = 150
    expect(calculateProratedSeatPrice(300, 15, 30)).toBe(150);
  });

  it('full price when full period remains', () => {
    expect(calculateProratedSeatPrice(300, 30, 30)).toBe(300);
  });

  it('zero when no days remain', () => {
    expect(calculateProratedSeatPrice(300, 0, 30)).toBe(0);
  });
});

describe('RobokassaClient signatures', () => {
  it('generates a payment URL with a SignatureValue', () => {
    const client = new RobokassaClient(config);
    const url = client.generatePaymentUrl({
      invId: 1001,
      amount: 500,
      description: 'Test',
      items: [],
      customData: { tenant_id: 't1' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('MerchantLogin')).toBe('voxly');
    expect(parsed.searchParams.get('OutSum')).toBe('500.00');
    expect(parsed.searchParams.get('InvId')).toBe('1001');
    expect(parsed.searchParams.get('SignatureValue')).toBeTruthy();
    expect(parsed.searchParams.get('shp_tenant_id')).toBe('t1');
  });

  it('verifies a success signature generated with password1', () => {
    const client = new RobokassaClient(config);
    const url = client.generatePaymentUrl({
      invId: 1001,
      amount: 500,
      description: 'Test',
      items: [],
      customData: { tenant_id: 't1' },
    });
    const parsed = new URL(url);
    const ok = client.verifySuccessSignature({
      outSum: parsed.searchParams.get('OutSum')!,
      invId: parsed.searchParams.get('InvId')!,
      signatureValue: parsed.searchParams.get('SignatureValue')!,
      customData: { tenant_id: 't1' },
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered success signature', () => {
    const client = new RobokassaClient(config);
    const ok = client.verifySuccessSignature({
      outSum: '500.00',
      invId: '1001',
      signatureValue: 'deadbeef'.repeat(8),
      customData: { tenant_id: 't1' },
    });
    expect(ok).toBe(false);
  });

  it('verifies result signature computed with password2', () => {
    const client = new RobokassaClient(config);
    const customData = { tenant_id: 't1' };
    const stringToSign = `voxly:500.00:1001:pass2:shp_tenant_id=t1`;
    const expected = createHash('sha256').update(stringToSign).digest('hex');
    const ok = client.verifyResultSignature({
      outSum: '500.00',
      invId: '1001',
      signatureValue: expected,
      customData,
    });
    expect(ok).toBe(true);
  });

  it('rejects result signature computed with password1 (wrong password)', () => {
    const client = new RobokassaClient(config);
    const stringToSign = `voxly:500.00:1001:pass1:shp_tenant_id=t1`;
    const wrong = createHash('sha256').update(stringToSign).digest('hex');
    const ok = client.verifyResultSignature({
      outSum: '500.00',
      invId: '1001',
      signatureValue: wrong,
      customData: { tenant_id: 't1' },
    });
    expect(ok).toBe(false);
  });
});
