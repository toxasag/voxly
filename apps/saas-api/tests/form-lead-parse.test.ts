import { describe, expect, it } from 'vitest';
import {
  parseCookiesBlob,
  parseFormWebhookBody,
  sanitizeRawFields,
} from '../src/services/form-lead-parse.js';

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
});
