/**
 * Normalize inbound web form payloads (Tilda form-urlencoded, WordPress/generic JSON).
 */

export type FormLeadSource = 'tilda' | 'wordpress' | 'generic';

export interface FormAttribution {
  ymUid?: string;
  gaClientId?: string;
  yclid?: string;
  gclid?: string;
  fbp?: string;
  fbc?: string;
  rbClickid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface NormalizedFormLead {
  source: FormLeadSource;
  externalId?: string;
  formId?: string;
  name?: string;
  phone?: string;
  email?: string;
  comment?: string;
  pageUrl?: string;
  referer?: string;
  cookiesRaw?: string;
  attribution: FormAttribution;
  rawFields: Record<string, unknown>;
  /** Tilda connection probe: body has only test=test */
  isTestProbe: boolean;
}

const SERVICE_KEYS = new Set([
  'test',
  'tranid',
  'formid',
  'cookies',
  'tildautm',
  'api_key',
  'apikey',
  'secret',
  'token',
  'voxly_secret',
  'voxly-webhook-secret',
]);

function decodeMaybe(value: unknown): string {
  if (value == null) return '';
  let s = Array.isArray(value) ? String(value[0] ?? '') : String(value);
  s = s.replace(/\+/g, ' ').trim();
  if (!s) return '';
  // Tilda often double-encodes; decode until stable (max 3).
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s.trim();
}

function pickField(
  fields: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(fields)) {
    lowerMap.set(k.toLowerCase(), v);
  }
  for (const key of candidates) {
    const hit = lowerMap.get(key.toLowerCase());
    if (hit != null && String(hit).trim() !== '') {
      return decodeMaybe(hit);
    }
  }
  return undefined;
}

/** Parse COOKIES string from Tilda: `_ga=...; _ym_uid=...; TILDAUTM=utm_source%3D...` */
export function parseCookiesBlob(raw: string | undefined): {
  cookies: Record<string, string>;
  attribution: FormAttribution;
} {
  const cookies: Record<string, string> = {};
  const attribution: FormAttribution = {};
  if (!raw) return { cookies, attribution };

  const decoded = decodeMaybe(raw);
  for (const part of decoded.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!key) continue;
    cookies[key] = decodeMaybe(val);
  }

  if (cookies._ym_uid) attribution.ymUid = cookies._ym_uid;
  // GA client id is usually the last two segments of _ga=GA1.2.XXXX.YYYY
  if (cookies._ga) {
    const parts = cookies._ga.split('.');
    if (parts.length >= 4) {
      attribution.gaClientId = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    } else {
      attribution.gaClientId = cookies._ga;
    }
  }
  if (cookies._fbp) attribution.fbp = cookies._fbp;
  if (cookies._fbc) attribution.fbc = cookies._fbc;
  if (cookies.yclid) attribution.yclid = cookies.yclid;
  if (cookies.gclid) attribution.gclid = cookies.gclid;
  if (cookies.rb_clickid || cookies.rbClickid) {
    attribution.rbClickid = cookies.rb_clickid || cookies.rbClickid;
  }

  // TILDAUTM=utm_source=yandex|||utm_medium=cpc|||...
  const tildaUtm = cookies.TILDAUTM || cookies.tildautm;
  if (tildaUtm) {
    const utmDecoded = decodeMaybe(tildaUtm);
    for (const chunk of utmDecoded.split(/\|\|\|/)) {
      const eq = chunk.indexOf('=');
      if (eq <= 0) continue;
      const k = chunk.slice(0, eq).trim().toLowerCase();
      const v = decodeMaybe(chunk.slice(eq + 1));
      if (!v) continue;
      if (k === 'utm_source') attribution.utmSource = v;
      else if (k === 'utm_medium') attribution.utmMedium = v;
      else if (k === 'utm_campaign') attribution.utmCampaign = v;
      else if (k === 'utm_content') attribution.utmContent = v;
      else if (k === 'utm_term') attribution.utmTerm = v;
      else if (k === 'yclid') attribution.yclid = v;
      else if (k === 'gclid') attribution.gclid = v;
    }
  }

  return { cookies, attribution };
}

function mergeAttribution(
  base: FormAttribution,
  extra: FormAttribution,
): FormAttribution {
  return {
    ymUid: extra.ymUid || base.ymUid,
    gaClientId: extra.gaClientId || base.gaClientId,
    yclid: extra.yclid || base.yclid,
    gclid: extra.gclid || base.gclid,
    fbp: extra.fbp || base.fbp,
    fbc: extra.fbc || base.fbc,
    rbClickid: extra.rbClickid || base.rbClickid,
    utmSource: extra.utmSource || base.utmSource,
    utmMedium: extra.utmMedium || base.utmMedium,
    utmCampaign: extra.utmCampaign || base.utmCampaign,
    utmContent: extra.utmContent || base.utmContent,
    utmTerm: extra.utmTerm || base.utmTerm,
  };
}

function attributionFromFlat(fields: Record<string, unknown>): FormAttribution {
  const a: FormAttribution = {};
  const get = (keys: string[]) => pickField(fields, keys);
  a.ymUid = get(['ymUid', 'ym_uid', '_ym_uid', 'ClientID']);
  a.gaClientId = get(['gaClientId', 'ga_client_id', 'cid', '_ga']);
  a.yclid = get(['yclid']);
  a.gclid = get(['gclid']);
  a.fbp = get(['fbp', '_fbp']);
  a.fbc = get(['fbc', '_fbc', 'fbclid']);
  a.rbClickid = get(['rbClickid', 'rb_clickid']);
  a.utmSource = get(['utm_source', 'utmSource']);
  a.utmMedium = get(['utm_medium', 'utmMedium']);
  a.utmCampaign = get(['utm_campaign', 'utmCampaign']);
  a.utmContent = get(['utm_content', 'utmContent']);
  a.utmTerm = get(['utm_term', 'utmTerm']);
  return a;
}

function flattenBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  if (Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      if (k === 'attribution' || k === 'utm') {
        for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
          out[nk] = nv;
        }
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

function detectSource(
  fields: Record<string, unknown>,
  hint?: string,
): FormLeadSource {
  if (hint === 'tilda' || hint === 'wordpress' || hint === 'generic') return hint;
  const keys = Object.keys(fields).map((k) => k.toLowerCase());
  if (keys.includes('tranid') || keys.includes('formid') || keys.includes('cookies')) {
    return 'tilda';
  }
  if (
    keys.includes('entry_id') ||
    keys.includes('form_id') ||
    keys.includes('_wpcf7') ||
    keys.includes('gravityform')
  ) {
    return 'wordpress';
  }
  return 'generic';
}

/**
 * Parse public webhook body (JSON object or form-urlencoded map).
 */
export function parseFormWebhookBody(
  body: unknown,
  opts?: { sourceHint?: string; referer?: string; pageUrl?: string },
): NormalizedFormLead {
  const fields = flattenBody(body);
  const keys = Object.keys(fields);

  const isTestProbe =
    keys.length === 1 &&
    keys[0].toLowerCase() === 'test' &&
    decodeMaybe(fields[keys[0]]).toLowerCase() === 'test';

  if (isTestProbe) {
    return {
      source: 'tilda',
      attribution: {},
      rawFields: fields,
      isTestProbe: true,
      referer: opts?.referer,
      pageUrl: opts?.pageUrl,
    };
  }

  const source = detectSource(fields, opts?.sourceHint);
  const cookiesRaw =
    pickField(fields, ['COOKIES', 'cookies', 'Cookies']) || undefined;
  const { attribution: fromCookies } = parseCookiesBlob(cookiesRaw);
  const attribution = mergeAttribution(fromCookies, attributionFromFlat(fields));

  const name = pickField(fields, [
    'Name',
    'name',
    'full_name',
    'fullName',
    'your-name',
    'fio',
    'ФИО',
    'Имя',
  ]);
  const phone = pickField(fields, [
    'Phone',
    'phone',
    'tel',
    'telephone',
    'your-phone',
    'mobile',
    'Телефон',
  ]);
  const email = pickField(fields, [
    'Email',
    'email',
    'mail',
    'your-email',
    'E-mail',
    'Почта',
  ]);
  const comment = pickField(fields, [
    'Comments',
    'Comment',
    'comment',
    'message',
    'Message',
    'text',
    'your-message',
    'Комментарий',
    'Сообщение',
  ]);

  const externalId = pickField(fields, [
    'tranid',
    'tranId',
    'externalId',
    'external_id',
    'entry_id',
    'entryId',
    'lead_id',
    'leadId',
  ]);
  const formId = pickField(fields, [
    'formid',
    'formId',
    'form_id',
    'block_id',
    'form',
  ]);

  const pageUrl =
    opts?.pageUrl ||
    pickField(fields, ['pageUrl', 'page_url', 'Url', 'url', 'page', 'website']);
  const referer =
    opts?.referer ||
    pickField(fields, ['referer', 'referrer', 'http_referer']);

  return {
    source,
    externalId: externalId || undefined,
    formId: formId || undefined,
    name: name || undefined,
    phone: phone || undefined,
    email: email || undefined,
    comment: comment || undefined,
    pageUrl: pageUrl || undefined,
    referer: referer || undefined,
    cookiesRaw,
    attribution,
    rawFields: fields,
    isTestProbe: false,
  };
}

/** Strip secrets from raw fields before persisting / CRM notes. */
export function sanitizeRawFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SERVICE_KEYS.has(k.toLowerCase())) continue;
    if (/secret|password|token|api[_-]?key/i.test(k)) continue;
    out[k] = typeof v === 'string' ? decodeMaybe(v) : v;
  }
  return out;
}
