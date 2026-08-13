import { describe, expect, it } from 'vitest';
import {
  parseCookiesBlob,
  parseFormWebhookBody,
  sanitizeRawFields,
  buildDedupeFingerprint,
  parseClientTs,
} from '../src/services/form-lead-parse.js';
import { phoneFingerprint } from '@voxly/twenty-client';

describe('form-lead-parse', () => {
  it('handles Tilda test=test probe', () => {
    const n = parseFormWebhookBody({ test: 'test' });
    expect(n.isTestProbe).toBe(true);
  });

  it('parses Tilda Name/Phone/Email + tranid', () => {
    const n = parseFormWebhookBody({
      Name: 'Ivan',
      Phone: '%2B79001234567',
      Email: 'test%40email.com',
      Comments: 'hello',
      tranid: '467251%3A8442970',
      formid: 'form48844953',
    });
    expect(n.isTestProbe).toBe(false);
    expect(n.source).toBe('tilda');
    expect(n.name).toBe('Ivan');
    expect(n.phone).toBe('+79001234567');
    expect(n.email).toBe('test@email.com');
    expect(n.externalId).toBe('467251:8442970');
    expect(n.formId).toBe('form48844953');
  });

  it('parses COOKIES _ym_uid and TILDAUTM', () => {
    const { attribution } = parseCookiesBlob(
      '_ga%3DGA1.2.1861016115.1519204131%3B+_ym_uid%3D2021810468765220932%3B+TILDAUTM%3Dutm_source%253Dyandex%257C%257C%257Cutm_medium%253Dcpc',
    );
    expect(attribution.ymUid).toBe('2021810468765220932');
    expect(attribution.gaClientId).toBe('1861016115.1519204131');
    expect(attribution.utmSource).toBe('yandex');
    expect(attribution.utmMedium).toBe('cpc');
  });

  it('parses generic JSON / WordPress-style body', () => {
    const n = parseFormWebhookBody({
      name: 'Мария',
      phone: '89001112233',
      email: 'm@example.com',
      entry_id: '99',
      utm_source: 'vk',
      _ym_uid: 'uid1',
    });
    expect(n.source).toBe('wordpress');
    expect(n.externalId).toBe('99');
    expect(n.attribution.utmSource).toBe('vk');
    expect(n.attribution.ymUid).toBe('uid1');
  });

  it('strips secrets from raw fields', () => {
    const clean = sanitizeRawFields({
      Name: 'A',
      api_key: 'secret',
      Phone: '1',
    });
    expect(clean.Name).toBe('A');
    expect(clean.api_key).toBeUndefined();
  });

  it('parses msclkid from flat fields and TILDAUTM', () => {
    const flat = parseFormWebhookBody({
      Name: 'X',
      phone: '79001234567',
      msclkid: 'abc123',
    });
    expect(flat.attribution.msclkid).toBe('abc123');
    const { attribution } = parseCookiesBlob(
      'TILDAUTM%3Dutm_source%253Dbing%257C%257C%257Cmsclkid%253Dxyz789',
    );
    expect(attribution.msclkid).toBe('xyz789');
  });

  it('extracts client submit timestamp', () => {
    const n = parseFormWebhookBody({
      Name: 'X',
      phone: '79001234567',
      client_ts: '1700000000',
    });
    expect(n.clientTs).toBe('1700000000');
  });
});

describe('parseClientTs', () => {
  it('parses epoch seconds', () => {
    expect(parseClientTs('1700000000')?.getTime()).toBe(1700000000 * 1000);
  });
  it('parses epoch millis', () => {
    expect(parseClientTs('1700000000000')?.getTime()).toBe(1700000000000);
  });
  it('parses ISO strings', () => {
    expect(parseClientTs('2026-08-14T00:00:00Z')?.toISOString()).toBe(
      '2026-08-14T00:00:00.000Z',
    );
  });
  it('returns undefined for junk / empty', () => {
    expect(parseClientTs('not-a-date')).toBeUndefined();
    expect(parseClientTs('')).toBeUndefined();
    expect(parseClientTs(undefined)).toBeUndefined();
  });
});

describe('buildDedupeFingerprint', () => {
  it('is stable for the same endpoint + phone + email + formId', () => {
    const a = buildDedupeFingerprint({
      endpointId: 'ep1',
      phone: '+7 900 123-45-67',
      email: 'A@Example.com',
      formId: 'f1',
    });
    const b = buildDedupeFingerprint({
      endpointId: 'ep1',
      phone: '79001234567',
      email: 'a@example.com',
      formId: 'f1',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs per endpoint', () => {
    const a = buildDedupeFingerprint({ endpointId: 'ep1', phone: '79001234567' });
    const b = buildDedupeFingerprint({ endpointId: 'ep2', phone: '79001234567' });
    expect(a).not.toBe(b);
  });

  it('returns undefined without phone or email', () => {
    expect(buildDedupeFingerprint({ endpointId: 'ep1', formId: 'f1' })).toBeUndefined();
  });
});

describe('phoneFingerprint', () => {
  it('collapses +7 / 8 / bare forms to the same key', () => {
    const canonical = phoneFingerprint('+79001234567');
    expect(phoneFingerprint('89001234567')).toBe(canonical);
    expect(phoneFingerprint('8 (900) 123-45-67')).toBe(canonical);
    expect(phoneFingerprint('9001234567')).toBe(canonical);
    expect(canonical).toBe('9001234567');
  });
  it('returns undefined for empty', () => {
    expect(phoneFingerprint('')).toBeUndefined();
    expect(phoneFingerprint(null)).toBeUndefined();
  });
});
