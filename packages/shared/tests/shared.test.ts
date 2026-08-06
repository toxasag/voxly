import { describe, it, expect } from 'vitest';
import {
  PRODUCT_CODES,
  PRICING,
  TRIAL_PERIOD_DAYS,
  GRACE_PERIOD_DAYS,
  PERIOD_DISCOUNTS,
  ADDON_TYPES,
  ANALYTICS_PLATFORMS,
  REFERRAL_RULE_TYPES,
  REFERRAL_EXCLUDED_PRODUCTS,
  TENANT_STATUS,
  USER_ROLES,
  BOT_PROVISION_VIA,
  PRESET_GOALS,
  getAiTgExtraSlots,
  getAiTgBusinessCapacity,
  getGiftBotSlots,
  clientMdToMarkdownV2,
  parseTelegramClientMd,
  buildVoxlyBotUsername,
  evaluateCrmAccess,
  pickPrimaryMembership,
  isProductInReferralScope,
  isAfterReferralPayoutWindow,
  normalizeReferralProductScope,
  isReferralCommissionSku,
  REFERRAL_PRODUCT_SCOPES,
  REFERRAL_COMMISSION_SKU_LABELS,
  detectUploadMediaKind,
  detectStoredMediaKind,
  normalizeGiftMediaType,
} from '../src/index';

describe('@voxly/shared exports', () => {
  it('exports PRODUCT_CODES with expected keys', () => {
    expect(PRODUCT_CODES.CRM_BASE).toBe('crm_base');
    expect(PRODUCT_CODES.EXTRA_SEAT).toBe('extra_seat');
    expect(PRODUCT_CODES.GIFT_BOT).toBe('gift_bot');
    expect(PRODUCT_CODES.AI_TELEGRAM).toBe('ai_tg');
    expect(PRODUCT_CODES.AI_TG_EXTRA_CONN).toBe('ai_tg_extra_conn');
    expect(PRODUCT_CODES.AI_GRAMJS).toBe('ai_gramjs');
    expect(PRODUCT_CODES.AI_MAX).toBe('ai_max');
    expect(PRODUCT_CODES.AI_WHATSAPP).toBe('ai_wa');
    expect(PRODUCT_CODES.AI_AGENT).toBe('ai_agent');
    expect(PRODUCT_CODES.AI_TOPUP).toBe('ai_topup');
  });

  it('exports PRICING constants', () => {
    expect(PRICING.CRM_BASE_MONTHLY).toBe(500);
    expect(PRICING.EXTRA_SEAT_MONTHLY).toBe(300);
    expect(PRICING.SEATS_INCLUDED).toBe(10);
    expect(PRICING.AI_MARKUP_PERCENT_DEFAULT).toBe(50);
    expect(PRICING.USD_RUB_RATE_DEFAULT).toBe(90);
    expect(PRICING.AI_TOPUP_MIN_RUB).toBe(500);
    expect(PRICING.AI_GRAMJS_MONTHLY).toBe(500);
    expect(PRICING.AI_MAX_MONTHLY).toBe(500);
    expect(PRICING.AI_AGENT_MONTHLY).toBe(500);
    expect(PRICING.AI_TG_EXTRA_CONN_MONTHLY).toBe(200);
    expect(PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS).toBe(10);
    expect(PRICING.REFERRAL_PERCENT_DEFAULT).toBe(20);
    expect(TRIAL_PERIOD_DAYS).toBe(7);
  });

  it('locks CRM access after trial/paid grace (evaluateCrmAccess)', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');

    const activePaid = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        periodMonths: 1,
        endsAt: '2026-08-06T12:00:00.000Z',
      },
      now,
    });
    expect(activePaid.allowed).toBe(true);
    expect(activePaid.locked).toBe(false);

    const trialEnded = evaluateCrmAccess({
      tenantStatus: 'trial',
      crmSubscription: {
        status: 'active',
        periodMonths: 0,
        endsAt: '2026-07-29T12:00:00.000Z',
      },
      now,
    });
    expect(trialEnded.locked).toBe(true);
    expect(trialEnded.reason).toBe('trial_ended');
    expect(trialEnded.code).toBe(402);

    const inGrace = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        periodMonths: 1,
        endsAt: '2026-07-28T12:00:00.000Z',
      },
      now,
      gracePeriodDays: GRACE_PERIOD_DAYS,
    });
    expect(inGrace.allowed).toBe(true);
    expect(inGrace.inGrace).toBe(true);

    const graceEnded = evaluateCrmAccess({
      tenantStatus: 'active',
      crmSubscription: {
        status: 'active',
        periodMonths: 1,
        endsAt: '2026-07-20T12:00:00.000Z',
      },
      now,
    });
    expect(graceEnded.locked).toBe(true);
    expect(graceEnded.reason).toBe('subscription_grace_ended');

    const suspended = evaluateCrmAccess({
      tenantStatus: 'suspended',
      crmSubscription: {
        status: 'active',
        periodMonths: 1,
        endsAt: '2026-08-06T12:00:00.000Z',
      },
      now,
    });
    expect(suspended.locked).toBe(true);
    expect(suspended.reason).toBe('tenant_suspended');
    expect(suspended.code).toBe(403);
  });

  it('computes Business capacity from addon config', () => {
    expect(getAiTgExtraSlots(null)).toBe(0);
    expect(getAiTgExtraSlots({ extraSlots: 3 })).toBe(3);
    expect(getAiTgBusinessCapacity({ extraSlots: 2 })).toBe(12);
    expect(REFERRAL_EXCLUDED_PRODUCTS.has(PRODUCT_CODES.AI_TOPUP)).toBe(true);
  });

  it('reads gift bot slots from addon config', () => {
    expect(getGiftBotSlots(null)).toBe(0);
    expect(getGiftBotSlots({})).toBe(0);
    expect(getGiftBotSlots({ botSlots: 2 })).toBe(2);
    expect(getGiftBotSlots({ botSlots: 1.9 })).toBe(1);
  });

  it('exports PERIOD_DISCOUNTS with expected tiers', () => {
    expect(PERIOD_DISCOUNTS[1]).toBe(0);
    expect(PERIOD_DISCOUNTS[12]).toBe(10);
    expect(PERIOD_DISCOUNTS[24]).toBe(15);
  });

  it('exports the canonical const arrays', () => {
    expect(ADDON_TYPES).toContain('gift_bot');
    expect(ADDON_TYPES).toContain('ai_tg');
    expect(ADDON_TYPES).toContain('ai_gramjs');
    expect(ADDON_TYPES).toContain('ai_max');
    expect(ANALYTICS_PLATFORMS).toEqual(['metrika', 'ga4', 'facebook', 'vk']);
    expect(REFERRAL_RULE_TYPES).toContain('percent_recurring');
    expect(TENANT_STATUS).toContain('active');
    expect(USER_ROLES).toEqual(['superadmin', 'owner', 'member']);
    expect(BOT_PROVISION_VIA).toEqual(['managed', 'manual']);
    expect(PRESET_GOALS).toContain('bot_start');
    expect(PRESET_GOALS).toContain('promo_click');
  });

  it('builds voxly_{nick}_{nn}_bot usernames within Telegram limits', () => {
    expect(buildVoxlyBotUsername('test2', 1)).toBe('voxly_test2_01_bot');
    expect(buildVoxlyBotUsername('Test-Client!', 2)).toBe('voxly_testclient_02_bot');
    expect(buildVoxlyBotUsername('a', 99).endsWith('_99_bot')).toBe(true);
    expect(buildVoxlyBotUsername('x'.repeat(40), 1).length).toBeLessThanOrEqual(32);
    expect(buildVoxlyBotUsername('x'.repeat(40), 1).endsWith('_01_bot')).toBe(true);
  });
});

describe('Telegram client Markdown → MarkdownV2', () => {
  it('converts bold, italic, strike, spoiler, code', () => {
    const out = clientMdToMarkdownV2(
      '**жирный** __курсив__ ~~зачёркнутый~~ ||скрытый|| `код`',
    );
    expect(out).toContain('*жирный*');
    expect(out).toContain('_курсив_');
    expect(out).toContain('~зачёркнутый~');
    expect(out).toContain('||скрытый||');
    expect(out).toContain('`код`');
  });

  it('converts fenced code blocks', () => {
    const out = clientMdToMarkdownV2('до\n```\nline1\nline2\n```\nпосле');
    expect(out).toContain('```\nline1\nline2\n```');
  });

  it('escapes MarkdownV2 special characters in plain text', () => {
    expect(clientMdToMarkdownV2('цена 10.5!')).toBe('цена 10\\.5\\!');
  });

  it('parses nested markers into an AST', () => {
    const nodes = parseTelegramClientMd('**a __b__**');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('bold');
    if (nodes[0].type === 'bold') {
      expect(nodes[0].children.some((c) => c.type === 'italic')).toBe(true);
    }
  });
});

describe('referral productScope', () => {
  it('excludes ai_topup via REFERRAL_EXCLUDED_PRODUCTS before scope', () => {
    expect(REFERRAL_EXCLUDED_PRODUCTS.has(PRODUCT_CODES.AI_TOPUP)).toBe(true);
  });

  it('crm scope allows only CRM SKUs', () => {
    expect(isProductInReferralScope(PRODUCT_CODES.CRM_BASE, 'crm')).toBe(true);
    expect(isProductInReferralScope(PRODUCT_CODES.EXTRA_SEAT, 'crm')).toBe(true);
    expect(isProductInReferralScope(PRODUCT_CODES.AI_TELEGRAM, 'crm')).toBe(false);
    expect(isProductInReferralScope(PRODUCT_CODES.GIFT_BOT, REFERRAL_PRODUCT_SCOPES.CRM)).toBe(false);
  });

  it('all scope allows non-CRM SKUs (caller still applies AI top-up exclusion)', () => {
    expect(isProductInReferralScope(PRODUCT_CODES.AI_TELEGRAM, 'all')).toBe(true);
    expect(normalizeReferralProductScope('subscriptions')).toBe(REFERRAL_PRODUCT_SCOPES.ALL);
  });

  it('commission SKU catalogue excludes ai_topup', () => {
    expect(isReferralCommissionSku(PRODUCT_CODES.CRM_BASE)).toBe(true);
    expect(isReferralCommissionSku(PRODUCT_CODES.AI_TELEGRAM)).toBe(true);
    expect(isReferralCommissionSku(PRODUCT_CODES.AI_TOPUP)).toBe(false);
    expect(REFERRAL_COMMISSION_SKU_LABELS.crm_base).toMatch(/CRM/);
  });

  it('durationMonths window starts at firstPaymentAt', () => {
    const first = new Date('2025-01-01T00:00:00.000Z');
    expect(isAfterReferralPayoutWindow(null, 3, new Date('2025-06-01T00:00:00.000Z'))).toBe(false);
    expect(isAfterReferralPayoutWindow(first, 3, new Date('2025-03-15T00:00:00.000Z'))).toBe(false);
    expect(isAfterReferralPayoutWindow(first, 3, new Date('2025-05-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('pickPrimaryMembership', () => {
  it('prefers owner over earlier member', () => {
    const primary = pickPrimaryMembership([
      { role: 'member', createdAt: '2020-01-01T00:00:00.000Z', tenantId: 'a' },
      { role: 'owner', createdAt: '2024-01-01T00:00:00.000Z', tenantId: 'b' },
    ]);
    expect(primary?.tenantId).toBe('b');
  });

  it('breaks ties by earliest createdAt', () => {
    const primary = pickPrimaryMembership([
      { role: 'owner', createdAt: '2024-06-01T00:00:00.000Z', tenantId: 'new' },
      { role: 'owner', createdAt: '2023-01-01T00:00:00.000Z', tenantId: 'old' },
    ]);
    expect(primary?.tenantId).toBe('old');
  });

  it('returns undefined for empty list', () => {
    expect(pickPrimaryMembership([])).toBeUndefined();
  });
});

describe('gift media kind detection', () => {
  it('maps office/docs to document', () => {
    expect(detectUploadMediaKind('application/pdf', 'offer.pdf')).toBe('document');
    expect(detectUploadMediaKind('application/msword', 'brief.doc')).toBe('document');
    expect(
      detectUploadMediaKind(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'prices.xlsx',
      ),
    ).toBe('document');
    expect(detectUploadMediaKind('application/vnd.ms-excel', 'legacy.xls')).toBe('document');
  });

  it('maps photo / video / voice / audio / video_note', () => {
    expect(detectUploadMediaKind('image/jpeg', 'a.jpg')).toBe('photo');
    expect(detectUploadMediaKind('video/mp4', 'clip.mp4')).toBe('video');
    expect(detectUploadMediaKind('audio/ogg', 'note.ogg')).toBe('voice');
    expect(detectUploadMediaKind('audio/mpeg', 'track.mp3')).toBe('audio');
    expect(detectUploadMediaKind('video/mp4', 'promo_circle.mp4')).toBe('video_note');
    expect(detectUploadMediaKind('video/mp4', 'clip.mp4', { asVideoNote: true })).toBe('video_note');
  });

  it('normalizes and detects stored kinds', () => {
    expect(normalizeGiftMediaType('document')).toBe('document');
    expect(normalizeGiftMediaType('voice')).toBe('voice');
    // True documents stay documents; photo/video hint = quality-preserving staging
    expect(detectStoredMediaKind('BQACAgIAAxkBAAI', 'document')).toBe('document');
    expect(detectStoredMediaKind('BQACAgIAAxkBAAI', null)).toBe('document');
    expect(detectStoredMediaKind('BQACAgIAAxkBAAI', 'photo')).toBe('photo');
    expect(detectStoredMediaKind('BQADAgIAAxkBAAI', 'video')).toBe('video');
    expect(detectStoredMediaKind('AwACAgIAAxkBAAI', null)).toBe('voice');
    expect(detectStoredMediaKind('DQACAgIAAxkBAAI', null)).toBe('video_note');
    expect(detectStoredMediaKind('CQACAgIAAxkBAAI', null)).toBe('audio');
    // Prefix beats wrong/legacy mediaType (gift type=file → document hint)
    expect(detectStoredMediaKind('AgACAgIAAxkBAAI', 'document')).toBe('photo');
    expect(detectStoredMediaKind('BAACAgIAAxkBAAI', 'document')).toBe('video');
    expect(detectStoredMediaKind('', 'photo')).toBe('photo');
  });
});
