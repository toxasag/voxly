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
  clientMdToTelegramHtml,
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
  randomInt,
  pickFloodDelayMs,
  retryBackoffMs,
  warmupFactor,
  telegramStoryDailyLimit,
  dailySendLimitFor,
  dailyStoryLimitFor,
  dailyCounterKey,
  dailyStoryCounterKey,
  FLOOD_RETRY_BACKOFF_MS,
  broadcastPoolIds,
  isBotFlooded,
  pickLeastLoadedBot,
  poolPauseUntil,
  expandSpintax,
  previewSpintax,
  spintaxGroupsCount,
  crmThreadCacheKey,
  readCrmThreadCache,
  writeCrmThreadCache,
  invalidateCrmThreadCache,
  CRM_THREAD_CACHE_TTL_SEC,
  claimCrmReadDebounce,
  crmReadDebounceKey,
  CRM_READ_DEBOUNCE_SEC,
  crmUnreadCacheKey,
  readCrmUnreadCache,
  writeCrmUnreadCache,
  invalidateCrmUnreadCache,
  CRM_UNREAD_CACHE_TTL_SEC,
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
    expect(PRICING.CRM_BASE_MONTHLY).toBe(600);
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

  it('converts client MD to Telegram HTML (spoiler + code as pre)', () => {
    const out = clientMdToTelegramHtml(
      '**жирный** __курсив__ ~~зачёркнутый~~ ||скрытый|| `код`',
    );
    expect(out).toContain('<b>жирный</b>');
    expect(out).toContain('<i>курсив</i>');
    expect(out).toContain('<s>зачёркнутый</s>');
    expect(out).toContain('<spoiler>скрытый</spoiler>');
    // Inline `code` → <pre> so GramJS shows a visible grey code block (INC-118).
    expect(out).toContain('<pre>код</pre>');
    expect(out).not.toContain('<code>');
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

describe('@voxly/shared flood-guard', () => {
  it('randomInt stays within [min, max] inclusive', () => {
    for (let i = 0; i < 200; i += 1) {
      const v = randomInt(30_000, 60_000);
      expect(v).toBeGreaterThanOrEqual(30_000);
      expect(v).toBeLessThanOrEqual(60_000);
    }
    expect(randomInt(100, 100)).toBe(100);
    expect(randomInt(50, 10)).toBe(50);
  });

  it('pickFloodDelayMs uses safe defaults per action kind', () => {
    for (let i = 0; i < 100; i += 1) {
      const msg = pickFloodDelayMs('message');
      expect(msg).toBeGreaterThanOrEqual(30_000);
      expect(msg).toBeLessThanOrEqual(60_000);
      const story = pickFloodDelayMs('story');
      expect(story).toBeGreaterThanOrEqual(180_000);
      expect(story).toBeLessThanOrEqual(300_000);
    }
  });

  it('pickFloodDelayMs honors an explicit window override', () => {
    for (let i = 0; i < 100; i += 1) {
      const v = pickFloodDelayMs('message', { minMs: 1_000, maxMs: 2_000 });
      expect(v).toBeGreaterThanOrEqual(1_000);
      expect(v).toBeLessThanOrEqual(2_000);
    }
  });

  it('retryBackoffMs follows 1s → 5s → 30s with bounded jitter', () => {
    expect(retryBackoffMs(0)).toBeGreaterThanOrEqual(1_000);
    expect(retryBackoffMs(0)).toBeLessThanOrEqual(2_000);
    expect(retryBackoffMs(1)).toBeGreaterThanOrEqual(5_000);
    expect(retryBackoffMs(1)).toBeLessThanOrEqual(6_000);
    expect(retryBackoffMs(2)).toBeGreaterThanOrEqual(30_000);
    expect(retryBackoffMs(2)).toBeLessThanOrEqual(31_000);
    expect(retryBackoffMs(5)).toBeLessThanOrEqual(31_000);
    expect(FLOOD_RETRY_BACKOFF_MS).toEqual([1_000, 5_000, 30_000]);
  });

  it('warmupFactor ramps 10% → 30% → 60% → 100%', () => {
    expect(warmupFactor(0)).toBe(0.1);
    expect(warmupFactor(1)).toBe(0.3);
    expect(warmupFactor(3)).toBe(0.3);
    expect(warmupFactor(4)).toBe(0.6);
    expect(warmupFactor(7)).toBe(0.6);
    expect(warmupFactor(8)).toBe(1);
    expect(warmupFactor(365)).toBe(1);
  });

  it('telegramStoryDailyLimit depends on premium status', () => {
    expect(telegramStoryDailyLimit(false)).toBe(1);
    expect(telegramStoryDailyLimit(true)).toBe(100);
    expect(telegramStoryDailyLimit(true, 50)).toBe(50);
  });

  it('dailySendLimitFor uses override or per-channel default', () => {
    expect(dailySendLimitFor('gift', null)).toBe(100);
    expect(dailySendLimitFor('ai_wa', null)).toBe(300);
    expect(dailySendLimitFor('unknown_channel', null)).toBe(200);
    expect(dailySendLimitFor('gift', 50)).toBe(50);
    expect(dailySendLimitFor('gift', 0)).toBe(100);
  });

  it('dailySendLimitFor applies warmup curve by warmupSince age (Job 1C.2)', () => {
    const now = new Date('2026-08-11T12:00:00Z');
    expect(dailySendLimitFor('gift', null, new Date('2026-08-11T00:00:00Z'), now)).toBe(10);
    expect(dailySendLimitFor('gift', null, new Date('2026-08-09T00:00:00Z'), now)).toBe(30);
    expect(dailySendLimitFor('gift', null, new Date('2026-08-05T00:00:00Z'), now)).toBe(60);
    expect(dailySendLimitFor('gift', null, new Date('2026-08-03T00:00:00Z'), now)).toBe(100);
    expect(dailySendLimitFor('gift', null, new Date(), now)).toBe(10);
    expect(dailySendLimitFor('gift', 500, new Date('2026-08-11T00:00:00Z'), now)).toBe(500);
  });

  it('dailyStoryLimitFor: gramjs by premium, wa 20, others 0', () => {
    expect(dailyStoryLimitFor('ai_gramjs', false, null)).toBe(1);
    expect(dailyStoryLimitFor('ai_gramjs', true, null)).toBe(100);
    expect(dailyStoryLimitFor('ai_wa', null, null)).toBe(20);
    expect(dailyStoryLimitFor('gift', null, null)).toBe(0);
    expect(dailyStoryLimitFor('ai_wa', null, 5)).toBe(5);
  });

  it('dailyCounterKey is stable per bot per UTC day', () => {
    const d = new Date('2026-08-10T12:00:00Z');
    expect(dailyCounterKey('bot_1', d)).toBe('tg:day:bot_1:2026-08-10:sent');
    expect(dailyCounterKey('bot_1')).toBe(dailyCounterKey('bot_1', new Date()));
    expect(dailyCounterKey('bot_1', d)).not.toBe(dailyCounterKey('bot_2', d));
  });

  it('dailyStoryCounterKey uses a distinct stories suffix', () => {
    const d = new Date('2026-08-10T12:00:00Z');
    expect(dailyStoryCounterKey('bot_1', d)).toBe('tg:day:bot_1:2026-08-10:stories');
    expect(dailyStoryCounterKey('bot_1', d)).not.toBe(dailyCounterKey('bot_1', d));
  });

  it('broadcastPoolIds falls back to botId when botIds is absent', () => {
    expect(broadcastPoolIds({ botId: 'a' })).toEqual(['a']);
    expect(broadcastPoolIds({ botId: 'a', botIds: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(broadcastPoolIds({ botId: 'a', botIds: ['b', 'c'] })).toEqual(['b', 'c', 'a']);
    expect(broadcastPoolIds(null)).toEqual([]);
    expect(broadcastPoolIds({})).toEqual([]);
  });

  it('pickLeastLoadedBot picks the least used available account', () => {
    const candidates = [
      { id: 'a', used: 10, limit: 100 },
      { id: 'b', used: 3, limit: 100 },
      { id: 'c', used: 7, limit: 100 },
    ];
    expect(pickLeastLoadedBot(candidates)?.id).toBe('b');
  });

  it('pickLeastLoadedBot skips accounts at their daily limit', () => {
    const candidates = [
      { id: 'a', used: 100, limit: 100 },
      { id: 'b', used: 90, limit: 100 },
    ];
    expect(pickLeastLoadedBot(candidates)?.id).toBe('b');
  });

  it('pickLeastLoadedBot skips flooded accounts and returns null when exhausted', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const later = new Date('2026-08-10T13:00:00Z');
    expect(
      pickLeastLoadedBot([{ id: 'a', used: 5, limit: 100, floodedUntil: later }], now),
    ).toBeNull();
    expect(pickLeastLoadedBot([{ id: 'a', used: 100, limit: 100 }], now)).toBeNull();
  });

  it('pickLeastLoadedBot allows accounts whose floodedUntil already passed', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const past = new Date('2026-08-10T11:00:00Z');
    expect(
      pickLeastLoadedBot([{ id: 'a', used: 5, limit: 100, floodedUntil: past }], now)?.id,
    ).toBe('a');
  });

  it('isBotFlooded handles Date and ISO string', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const later = '2026-08-10T13:00:00Z';
    const past = '2026-08-10T11:00:00Z';
    expect(isBotFlooded({ id: 'a', used: 0, limit: 10, floodedUntil: later }, now)).toBe(true);
    expect(isBotFlooded({ id: 'a', used: 0, limit: 10, floodedUntil: past }, now)).toBe(false);
    expect(isBotFlooded({ id: 'a', used: 0, limit: 10, floodedUntil: null }, now)).toBe(false);
  });

  it('poolPauseUntil returns null while the pool has available accounts', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const later = new Date('2026-08-10T13:00:00Z');
    expect(
      poolPauseUntil(
        [
          { id: 'a', used: 5, limit: 100 },
          { id: 'b', used: 50, limit: 100, floodedUntil: later },
        ],
        now,
      ),
    ).toBeNull();
  });

  it('poolPauseUntil returns the nearest floodedUntil when all accounts are flooded', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const soon = new Date('2026-08-10T13:00:00Z');
    const later = new Date('2026-08-10T15:00:00Z');
    expect(
      poolPauseUntil(
        [
          { id: 'a', used: 5, limit: 100, floodedUntil: later },
          { id: 'b', used: 3, limit: 100, floodedUntil: soon },
        ],
        now,
      ),
    ).toBe(soon.getTime());
  });

  it('poolPauseUntil returns null when the whole pool is at the daily limit', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    expect(poolPauseUntil([{ id: 'a', used: 100, limit: 100 }], now)).toBeNull();
    expect(
      poolPauseUntil(
        [
          { id: 'a', used: 100, limit: 100 },
          { id: 'b', used: 100, limit: 100 },
        ],
        now,
      ),
    ).toBeNull();
  });

  it('poolPauseUntil ignores floodedUntil already in the past', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const past = new Date('2026-08-10T11:00:00Z');
    expect(
      poolPauseUntil([{ id: 'a', used: 100, limit: 100, floodedUntil: past }], now),
    ).toBeNull();
  });

  it('spintaxGroupsCount counts innermost groups only', () => {
    expect(spintaxGroupsCount('Привет!')).toBe(0);
    expect(spintaxGroupsCount('{Привет|Здравствуйте}, {друг|друг!}')).toBe(2);
    expect(spintaxGroupsCount('{A|{B|C}}')).toBe(1);
  });

  it('expandSpintax picks a variant per group (deterministic rng)', () => {
    expect(expandSpintax('{a|b|c}', () => 0)).toBe('a');
    expect(expandSpintax('{a|b|c}', () => 0.99)).toBe('c');
    expect(expandSpintax('{a|b} {c|d}', () => 0)).toBe('a c');
    expect(expandSpintax('plain text', () => 0)).toBe('plain text');
  });

  it('expandSpintax supports nesting (innermost first)', () => {
    expect(expandSpintax('{A|{B|C}}', () => 0.99)).toBe('C');
    expect(expandSpintax('{A|{B|C}}', () => 0)).toBe('A');
  });

  it('expandSpintax unescapes \\{ \\| \\}', () => {
    expect(expandSpintax('\\{x\\|y\\}', () => 0)).toBe('{x|y}');
    expect(expandSpintax('{a\\|b|c}', () => 0)).toBe('a|b');
  });

  it('previewSpintax returns the requested number of samples', () => {
    expect(previewSpintax('{a|b}', 3)).toHaveLength(3);
    expect(previewSpintax('plain', 3)).toEqual(['plain', 'plain', 'plain']);
  });
});

describe('@voxly/shared crm-thread-cache', () => {
  function makeRedis() {
    const store = new Map<string, string>();
    const calls: { set: unknown[][]; del: unknown[][] } = { set: [], del: [] };
    return {
      store,
      calls,
      async get(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      async set(key: string, value: string, _mode: 'EX', ttl: number) {
        calls.set.push([key, value, ttl]);
        store.set(key, value);
      },
      async del(...keys: string[]) {
        calls.del.push(keys);
        for (const k of keys) store.delete(k);
      },
    };
  }

  it('crmThreadCacheKey is tenant + record scoped', () => {
    expect(crmThreadCacheKey('t1', 'r1')).toBe('crm:threads:t1:r1');
    expect(crmThreadCacheKey('t1', 'r1')).not.toBe(crmThreadCacheKey('t2', 'r1'));
  });

  it('write then read round-trips the value with the shared TTL', async () => {
    const redis = makeRedis();
    const value = [{ conversationId: 'c1' }];
    await writeCrmThreadCache(redis, 't1', 'r1', value);
    expect(redis.calls.set[0][2]).toBe(CRM_THREAD_CACHE_TTL_SEC);
    const read = await readCrmThreadCache<typeof value>(redis, 't1', 'r1');
    expect(read).toEqual(value);
  });

  it('read returns null on miss and on malformed JSON', async () => {
    const redis = makeRedis();
    expect(await readCrmThreadCache(redis, 't1', 'missing')).toBeNull();
    redis.store.set(crmThreadCacheKey('t1', 'bad'), '{not json');
    expect(await readCrmThreadCache(redis, 't1', 'bad')).toBeNull();
  });

  it('invalidate deletes keys for all non-empty ids, deduped', async () => {
    const redis = makeRedis();
    await writeCrmThreadCache(redis, 't1', 'person1', [1]);
    await writeCrmThreadCache(redis, 't1', 'opp1', [2]);
    await invalidateCrmThreadCache(redis, 't1', ['person1', 'opp1', null, undefined, 'person1']);
    expect(redis.calls.del[0]).toEqual([
      crmThreadCacheKey('t1', 'person1'),
      crmThreadCacheKey('t1', 'opp1'),
    ]);
    expect(redis.store.has(crmThreadCacheKey('t1', 'person1'))).toBe(false);
    expect(redis.store.has(crmThreadCacheKey('t1', 'opp1'))).toBe(false);
  });

  it('invalidate is a no-op when no valid ids are given', async () => {
    const redis = makeRedis();
    await invalidateCrmThreadCache(redis, 't1', [null, undefined, '']);
    expect(redis.calls.del).toHaveLength(0);
  });

  it('claimCrmReadDebounce fires once then suppresses within the window', async () => {
    const redis = makeRedis();
    expect(await claimCrmReadDebounce(redis, 't1', 'c1')).toBe(true);
    expect(redis.calls.set[0][0]).toBe(crmReadDebounceKey('t1', 'c1'));
    expect(redis.calls.set[0][2]).toBe(CRM_READ_DEBOUNCE_SEC);
    expect(await claimCrmReadDebounce(redis, 't1', 'c1')).toBe(false);
    // Different conversation is independent.
    expect(await claimCrmReadDebounce(redis, 't1', 'c2')).toBe(true);
  });
});

describe('@voxly/shared crm-unread-cache', () => {
  function makeRedis() {
    const store = new Map<string, string>();
    const calls: { set: unknown[][]; del: unknown[][] } = { set: [], del: [] };
    return {
      store,
      calls,
      async get(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      async set(key: string, value: string, _mode: 'EX', ttl: number) {
        calls.set.push([key, value, ttl]);
        store.set(key, value);
      },
      async del(...keys: string[]) {
        calls.del.push(keys);
        for (const k of keys) store.delete(k);
      },
    };
  }

  it('crmUnreadCacheKey is tenant scoped', () => {
    expect(crmUnreadCacheKey('t1')).toBe('crm:unread:t1');
    expect(crmUnreadCacheKey('t1')).not.toBe(crmUnreadCacheKey('t2'));
  });

  it('write then read round-trips with the shared TTL', async () => {
    const redis = makeRedis();
    const value = { opportunities: [{ id: 'o1', count: 3 }], persons: [], serverTime: 'x' };
    await writeCrmUnreadCache(redis, 't1', value);
    expect(redis.calls.set[0][2]).toBe(CRM_UNREAD_CACHE_TTL_SEC);
    expect(await readCrmUnreadCache(redis, 't1')).toEqual(value);
  });

  it('read returns null on miss and malformed JSON', async () => {
    const redis = makeRedis();
    expect(await readCrmUnreadCache(redis, 'missing')).toBeNull();
    redis.store.set(crmUnreadCacheKey('t1'), 'not json');
    expect(await readCrmUnreadCache(redis, 't1')).toBeNull();
  });

  it('invalidate deletes the tenant key', async () => {
    const redis = makeRedis();
    await writeCrmUnreadCache(redis, 't1', { opportunities: [], persons: [], serverTime: 'x' });
    await invalidateCrmUnreadCache(redis, 't1');
    expect(redis.calls.del[0]).toEqual([crmUnreadCacheKey('t1')]);
    expect(redis.store.has(crmUnreadCacheKey('t1'))).toBe(false);
  });
});
