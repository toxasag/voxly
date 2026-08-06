// Voxly shared types and constants

export const PRODUCT_CODES = {
  CRM_BASE: 'crm_base',
  EXTRA_SEAT: 'extra_seat',
  GIFT_BOT: 'gift_bot',
  /** MAX gift bot (official Bot API); separate product from Telegram gift_bot */
  GIFT_BOT_MAX: 'gift_bot_max',
  AI_TELEGRAM: 'ai_tg',
  /** +1 Business account slot beyond included 10 (200₽/mo) */
  AI_TG_EXTRA_CONN: 'ai_tg_extra_conn',
  /** Personal Telegram account via GramJS (500₽/mo + AI wallet) */
  AI_GRAMJS: 'ai_gramjs',
  /** Personal MAX account via PyMax bridge (500₽/mo + AI wallet) */
  AI_MAX: 'ai_max',
  AI_WHATSAPP: 'ai_wa',
  /** One AI agent seat (500₽/mo); config.agentSlots on ai_agent addon */
  AI_AGENT: 'ai_agent',
  /** One-shot AI wallet top-up (not a subscription; excluded from referral) */
  AI_TOPUP: 'ai_topup',
  /** Gift-bot mailing (500₽/mo) */
  MAILING_BOT: 'mailing_bot',
  /** GramJS + WhatsApp mailing together (500₽/mo) */
  MAILING_ACCOUNTS: 'mailing_accounts',
  /** Stories posting all channels (1000₽/mo) */
  MAILING_STORIES: 'mailing_stories',
  ANALYTICS_METRIKA: 'analytics_metrika',
  ANALYTICS_GA4: 'analytics_ga4',
  ANALYTICS_FACEBOOK: 'analytics_facebook',
  ANALYTICS_VK: 'analytics_vk',
} as const;

export type ProductCode = (typeof PRODUCT_CODES)[keyof typeof PRODUCT_CODES];

/** Products that never earn referral commission */
export const REFERRAL_EXCLUDED_PRODUCTS = new Set<string>([PRODUCT_CODES.AI_TOPUP]);

/**
 * Monthly SKUs that can carry a per-partner commission override (`ReferralServiceRate`).
 * Same catalogue as platform pricing; `ai_topup` is excluded (never commissionable).
 */
export const REFERRAL_COMMISSION_SKUS = [
  PRODUCT_CODES.CRM_BASE,
  PRODUCT_CODES.EXTRA_SEAT,
  PRODUCT_CODES.GIFT_BOT,
  PRODUCT_CODES.GIFT_BOT_MAX,
  PRODUCT_CODES.AI_TELEGRAM,
  PRODUCT_CODES.AI_TG_EXTRA_CONN,
  PRODUCT_CODES.AI_GRAMJS,
  PRODUCT_CODES.AI_MAX,
  PRODUCT_CODES.AI_WHATSAPP,
  PRODUCT_CODES.AI_AGENT,
  PRODUCT_CODES.MAILING_BOT,
  PRODUCT_CODES.MAILING_ACCOUNTS,
  PRODUCT_CODES.MAILING_STORIES,
] as const;

export type ReferralCommissionSku = (typeof REFERRAL_COMMISSION_SKUS)[number];

export const REFERRAL_COMMISSION_SKU_SET = new Set<string>(REFERRAL_COMMISSION_SKUS);

export const REFERRAL_COMMISSION_SKU_LABELS: Record<ReferralCommissionSku, string> = {
  crm_base: 'CRM база',
  extra_seat: 'CRM доп. место',
  gift_bot: 'Бот подарков Telegram',
  gift_bot_max: 'Бот подарков MAX',
  ai_tg: 'Телеграм Секретарь',
  ai_tg_extra_conn: 'Секретарь: доп. аккаунт',
  ai_gramjs: 'Telegram (GramJS)',
  ai_max: 'MAX (личный)',
  ai_wa: 'WhatsApp',
  ai_agent: 'AI-агент (слот)',
  mailing_bot: 'Рассылка ботом',
  mailing_accounts: 'Рассылка с аккаунтов',
  mailing_stories: 'Постинг сторис',
};

export function isReferralCommissionSku(code: string): code is ReferralCommissionSku {
  return REFERRAL_COMMISSION_SKU_SET.has(code);
}

/**
 * Which payments a `ReferralRule` earns on. `REFERRAL_EXCLUDED_PRODUCTS` is applied first and
 * wins over every scope, so `all` means "everything except the AI wallet top-up".
 * There is deliberately no `subscriptions` value: every SKU except `ai_topup` creates a
 * `Subscription`, so it would be indistinguishable from `all` on the current catalogue.
 */
export const REFERRAL_PRODUCT_SCOPES = {
  ALL: 'all',
  CRM: 'crm',
} as const;

export type ReferralProductScope =
  (typeof REFERRAL_PRODUCT_SCOPES)[keyof typeof REFERRAL_PRODUCT_SCOPES];

export const REFERRAL_PRODUCT_SCOPE_VALUES = [
  REFERRAL_PRODUCT_SCOPES.ALL,
  REFERRAL_PRODUCT_SCOPES.CRM,
] as const satisfies readonly ReferralProductScope[];

const REFERRAL_CRM_PRODUCTS = new Set<string>([PRODUCT_CODES.CRM_BASE, PRODUCT_CODES.EXTRA_SEAT]);

/** Legacy values (e.g. seeded `subscriptions`) mean "everything except the AI top-up" → `all`. */
export function normalizeReferralProductScope(
  scope: string | null | undefined,
): ReferralProductScope {
  return scope === REFERRAL_PRODUCT_SCOPES.CRM
    ? REFERRAL_PRODUCT_SCOPES.CRM
    : REFERRAL_PRODUCT_SCOPES.ALL;
}

/** Apply only after `REFERRAL_EXCLUDED_PRODUCTS`: AI top-ups never earn, whatever the scope. */
export function isProductInReferralScope(
  productCode: string,
  scope: string | null | undefined,
): boolean {
  return normalizeReferralProductScope(scope) === REFERRAL_PRODUCT_SCOPES.CRM
    ? REFERRAL_CRM_PRODUCTS.has(productCode)
    : true;
}

/**
 * `durationMonths` («первые N мес.») for percent_recurring: window starts at the client's
 * first payment, not at attribution. No first payment yet → still inside the window.
 */
export function isAfterReferralPayoutWindow(
  firstPaymentAt: Date | string | null | undefined,
  durationMonths: number,
  now: Date = new Date(),
): boolean {
  if (!firstPaymentAt || !durationMonths) return false;
  const windowEnd = new Date(firstPaymentAt);
  windowEnd.setMonth(windowEnd.getMonth() + durationMonths);
  return now.getTime() >= windowEnd.getTime();
}

/**
 * Where an AI charge came from. Values mirror the SKU codes of the products that own each
 * channel (`ai_tg` / `ai_gramjs` / `ai_max` / `ai_wa` / `gift_bot`) so a channel key can be read against
 * the catalogue without a translation table. `system` covers billed work that is not a
 * messaging channel at all (RAG embeddings for knowledge base and sales examples).
 * Orthogonal to `AiAgent` (ADR-014): one agent can serve several channels.
 * Existing rows predate the column and stay `null` — treat that as "unknown", not a value here.
 */
export const AI_USAGE_CHANNELS = {
  TELEGRAM_BUSINESS: 'ai_tg',
  TELEGRAM_PERSONAL: 'ai_gramjs',
  MAX_PERSONAL: 'ai_max',
  WHATSAPP: 'ai_wa',
  GIFT_BOT: 'gift_bot',
  GIFT_BOT_MAX: 'gift_bot_max',
  SYSTEM: 'system',
} as const;

export type AiUsageChannel = (typeof AI_USAGE_CHANNELS)[keyof typeof AI_USAGE_CHANNELS];

export const AI_USAGE_CHANNEL_VALUES = [
  AI_USAGE_CHANNELS.TELEGRAM_BUSINESS,
  AI_USAGE_CHANNELS.TELEGRAM_PERSONAL,
  AI_USAGE_CHANNELS.MAX_PERSONAL,
  AI_USAGE_CHANNELS.WHATSAPP,
  AI_USAGE_CHANNELS.GIFT_BOT,
  AI_USAGE_CHANNELS.GIFT_BOT_MAX,
  AI_USAGE_CHANNELS.SYSTEM,
] as const satisfies readonly AiUsageChannel[];

export const AI_USAGE_CHANNEL_LABELS: Record<AiUsageChannel, string> = {
  [AI_USAGE_CHANNELS.TELEGRAM_BUSINESS]: 'Телеграм Секретарь',
  [AI_USAGE_CHANNELS.TELEGRAM_PERSONAL]: 'Telegram',
  [AI_USAGE_CHANNELS.MAX_PERSONAL]: 'MAX',
  [AI_USAGE_CHANNELS.WHATSAPP]: 'WhatsApp',
  [AI_USAGE_CHANNELS.GIFT_BOT]: 'Бот подарков Telegram',
  [AI_USAGE_CHANNELS.GIFT_BOT_MAX]: 'Бот подарков MAX',
  [AI_USAGE_CHANNELS.SYSTEM]: 'База знаний и обучение',
};

/** Label for a stored channel value; `null` (legacy rows) and unknown codes → «Не определён». */
export function aiUsageChannelLabel(channel: string | null | undefined): string {
  if (!channel) return 'Не определён';
  return AI_USAGE_CHANNEL_LABELS[channel as AiUsageChannel] || channel;
}

export const PRICING = {
  CRM_BASE_MONTHLY: 500,
  EXTRA_SEAT_MONTHLY: 300,
  GIFT_BOT_MONTHLY: 500,
  GIFT_BOT_MAX_MONTHLY: 500,
  AI_TELEGRAM_MONTHLY: 1000,
  /** Up to 10 Telegram Business accounts included in AI_TELEGRAM */
  AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS: 10,
  /** Each active Business account beyond included 10 */
  AI_TG_EXTRA_CONN_MONTHLY: 200,
  /** Personal TG account (GramJS) fixed fee */
  AI_GRAMJS_MONTHLY: 500,
  /** Personal MAX account (PyMax) fixed fee */
  AI_MAX_MONTHLY: 500,
  /** WhatsApp account (Evolution) fixed fee */
  AI_WHATSAPP_MONTHLY: 500,
  /** One AI agent seat per month */
  AI_AGENT_MONTHLY: 500,
  MAILING_BOT_MONTHLY: 500,
  MAILING_ACCOUNTS_MONTHLY: 500,
  MAILING_STORIES_MONTHLY: 1000,
  ANALYTICS_PLATFORM_MONTHLY: 500,
  AI_TOPUP_MIN_RUB: 500,
  AI_MARKUP_PERCENT_DEFAULT: 50,
  /** Default USD→RUB for OpenRouter cost (env USD_RUB_RATE / platformSetting usd_rub_rate win) */
  USD_RUB_RATE_DEFAULT: 90,
  /** Default referral % of paid subscriptions/addons (not AI top-up) */
  REFERRAL_PERCENT_DEFAULT: 20,
  SEATS_INCLUDED: 10,
} as const;

export const PERIOD_DISCOUNTS: Record<number, number> = {
  1: 0,
  3: 0,
  6: 5,
  12: 10,
  24: 15,
};

/** Минимальная сумма заявки партнёра на вывод партнёрского баланса */
export const REFERRAL_WITHDRAWAL_MIN_RUB = 1000;

export const GRACE_PERIOD_DAYS = 7;
export const TRIAL_PERIOD_DAYS = 7;
export const REFERRAL_COOKIE_DAYS = 30;

/** Why CRM SSO / chat / invite is blocked (or ok). */
export type CrmAccessReason =
  | 'ok'
  | 'tenant_suspended'
  | 'tenant_cancelled'
  | 'no_crm_subscription'
  | 'trial_ended'
  | 'subscription_grace_ended';

export type CrmAccessEvaluation = {
  allowed: boolean;
  locked: boolean;
  reason: CrmAccessReason;
  /** 402 = pay / renew; 403 = suspended / cancelled */
  code: 402 | 403 | null;
  error: string | null;
  inGrace: boolean;
  graceEndsAt: string | null;
  endsAt: string | null;
  isTrial: boolean;
  /** Active crm_base with endsAt >= now */
  isPaidCoveringNow: boolean;
};

export type CrmSubscriptionSnapshot = {
  status: string;
  endsAt: Date | string;
  periodMonths: number;
};

/**
 * Hard CRM access gate — aligned with subscription scheduler:
 * - trial (periodMonths=0): lock immediately when endsAt < now
 * - paid: GRACE_PERIOD_DAYS after endsAt, then lock
 * - tenant suspended/cancelled: lock (overrides in-grace)
 */
export function evaluateCrmAccess(opts: {
  tenantStatus: string;
  crmSubscription: CrmSubscriptionSnapshot | null | undefined;
  now?: Date;
  gracePeriodDays?: number;
}): CrmAccessEvaluation {
  const now = opts.now ?? new Date();
  const graceDays = opts.gracePeriodDays ?? GRACE_PERIOD_DAYS;
  const sub = opts.crmSubscription ?? null;
  const endsAt = sub ? new Date(sub.endsAt) : null;
  const endsAtIso = endsAt && Number.isFinite(endsAt.getTime()) ? endsAt.toISOString() : null;
  const isTrial = Boolean(sub && sub.periodMonths === 0);
  const coveringNow = Boolean(
    sub &&
      sub.status === 'active' &&
      endsAt &&
      Number.isFinite(endsAt.getTime()) &&
      endsAt.getTime() >= now.getTime(),
  );

  const base = {
    inGrace: false,
    graceEndsAt: null as string | null,
    endsAt: endsAtIso,
    isTrial,
    isPaidCoveringNow: coveringNow && !isTrial,
  };

  if (opts.tenantStatus === 'cancelled') {
    return {
      ...base,
      allowed: false,
      locked: true,
      reason: 'tenant_cancelled',
      code: 403,
      error: 'Аккаунт отменён. CRM недоступна.',
    };
  }

  if (opts.tenantStatus === 'suspended') {
    return {
      ...base,
      allowed: false,
      locked: true,
      reason: 'tenant_suspended',
      code: 403,
      error: 'Подписка на CRM закончилась. Оформите оплату, чтобы снова открыть CRM.',
    };
  }

  if (coveringNow) {
    return {
      ...base,
      allowed: true,
      locked: false,
      reason: 'ok',
      code: null,
      error: null,
    };
  }

  if (sub && sub.status === 'active' && endsAt && Number.isFinite(endsAt.getTime())) {
    if (sub.periodMonths === 0) {
      return {
        ...base,
        allowed: false,
        locked: true,
        reason: 'trial_ended',
        code: 402,
        error: 'Пробный период CRM закончился. Оформите оплату, чтобы открыть CRM.',
      };
    }

    const graceEnds = new Date(endsAt);
    graceEnds.setDate(graceEnds.getDate() + graceDays);
    if (now.getTime() < graceEnds.getTime()) {
      return {
        ...base,
        allowed: true,
        locked: false,
        reason: 'ok',
        code: null,
        error: null,
        inGrace: true,
        graceEndsAt: graceEnds.toISOString(),
        isPaidCoveringNow: false,
      };
    }

    return {
      ...base,
      allowed: false,
      locked: true,
      reason: 'subscription_grace_ended',
      code: 402,
      error: 'Подписка на CRM закончилась. Оформите оплату, чтобы снова открыть CRM.',
      graceEndsAt: graceEnds.toISOString(),
    };
  }

  return {
    ...base,
    allowed: false,
    locked: true,
    reason: 'no_crm_subscription',
    code: 402,
    error: 'Нет активной подписки на CRM. Оформите оплату, чтобы открыть CRM.',
    isTrial: opts.tenantStatus === 'trial',
  };
}
/** Inbound within this window after mailing/story counts as attributed reply */
export const MAILING_ATTRIBUTION_WINDOW_HOURS = 48;

export function isWithinMailingAttributionWindow(
  at: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!at) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= MAILING_ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000;
}

export function mailingAttributionNote(opts: {
  broadcastId: string;
  kind?: 'broadcast' | 'story';
}): string {
  const kind = opts.kind === 'story' ? 'сторис' : 'рассылки';
  return `Взаимодействие после ${kind} (${opts.broadcastId})`;
}

export const ADDON_TYPES = [
  'gift_bot',
  'gift_bot_max',
  'ai_tg',
  'ai_gramjs',
  'ai_max',
  'ai_wa',
  'ai_agent',
  'mailing_bot',
  'mailing_accounts',
  'mailing_stories',
  'analytics_metrika',
  'analytics_ga4',
  'analytics_facebook',
  'analytics_vk',
] as const;

/** Read purchased extra Business slots from ai_tg addon.config */
export function getAiTgExtraSlots(config: unknown): number {
  if (!config || typeof config !== 'object') return 0;
  const n = Number((config as { extraSlots?: unknown }).extraSlots);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function getAiTgBusinessCapacity(config: unknown): number {
  return PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS + getAiTgExtraSlots(config);
}

/** Paid AI-agent seats from ai_agent addon.config */
export function getAiAgentSlots(config: unknown): number {
  if (!config || typeof config !== 'object') return 0;
  const n = Number((config as { agentSlots?: unknown }).agentSlots);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Paid gift seats from gift_bot / gift_bot_max addon.config
 * (one slot = one BotInstance of that product).
 */
export function getGiftBotSlots(config: unknown): number {
  if (!config || typeof config !== 'object') return 0;
  const n = Number((config as { botSlots?: unknown }).botSlots);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Stable primary tenant membership for JWT login.
 * Prefer owner role; break ties by earliest createdAt so multi-membership users
 * do not jump tenants across logins when DB order is undefined.
 */
export function pickPrimaryMembership<T extends { role: string; createdAt?: Date | string | null }>(
  members: T[],
): T | undefined {
  if (members.length === 0) return undefined;
  const owners = members.filter((m) => m.role === 'owner');
  const pool = owners.length > 0 ? owners : members;
  return [...pool].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  })[0];
}

export type AddonType = (typeof ADDON_TYPES)[number];

export const ANALYTICS_PLATFORMS = ['metrika', 'ga4', 'facebook', 'vk'] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

export const REFERRAL_RULE_TYPES = [
  'fixed_first_payment',
  'percent_first_payment',
  'percent_recurring',
  'credit_discount',
] as const;

export type ReferralRuleType = (typeof REFERRAL_RULE_TYPES)[number];

export const TENANT_STATUS = ['trial', 'active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUS)[number];

export const USER_ROLES = ['superadmin', 'owner', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const BOT_PROVISION_VIA = ['managed', 'manual'] as const;
export type BotProvisionVia = (typeof BOT_PROVISION_VIA)[keyof typeof BOT_PROVISION_VIA];

/** Preferred: ai | human. `bot` is a legacy alias for ai (gift / older portal). */
export const CONVERSATION_MODES = ['ai', 'human', 'bot'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** True when AI should be considered the active conversation mode (ai or legacy bot). */
export function isAiConversationMode(mode: string | null | undefined): boolean {
  return mode === 'ai' || mode === 'bot' || !mode;
}

/** Default auto/manual pause duration for AI handoff (1 hour). */
export const AI_HANDOFF_PAUSE_MS = 60 * 60 * 1000;

export const AI_CHANNELS = [
  'telegram_business',
  'telegram_private',
  'telegram_gramjs',
  'whatsapp',
] as const;
export type AiChannel = (typeof AI_CHANNELS)[number];

/** OpenRouter model defaults (TZ v0.3.1) */
export const AI_MODEL_DEFAULTS = {
  chat: 'google/gemini-2.5-flash',
  chatEconomy: 'openai/gpt-4o-mini',
  chatEconomyAlt: 'google/gemini-2.5-flash-lite',
  chatPremium: 'openai/gpt-4o',
  embedding: 'openai/text-embedding-3-small',
  asr: 'openai/whisper-1',
} as const;

export const PRESET_GOALS = [
  'bot_start',
  'promo_click',
  'subscription_requested',
  'subscription_verified',
  'gift_delivered',
  'phone_submitted',
  'lead_created',
] as const;

export type PresetGoal = (typeof PRESET_GOALS)[keyof typeof PRESET_GOALS];

/** Optional inline URL buttons under a gift-bot post (Telegram reply_markup) */
export interface GiftExtraButton {
  text: string;
  url: string;
}

/** Linear gift-bot funnel stored in GiftCampaignConfig.funnelJson */
export interface GiftFunnelMessage {
  delayMinutes: number;
  text: string;
  /** @deprecated prefer telegramFileId — kept for older drafts */
  imageUrl?: string;
  /** Telegram Bot API file_id from portal upload */
  telegramFileId?: string;
  mediaType?: GiftPromoMediaType;
  /** Extra https URL buttons under the message (default none) */
  extraButtons?: GiftExtraButton[];
}

export interface GiftFunnelConfig {
  start: {
    text: string;
    imageUrl?: string;
    telegramFileId?: string;
    mediaType?: GiftPromoMediaType;
    /** Extra https URL buttons under the /start post (default none) */
    extraButtons?: GiftExtraButton[];
  };
  notSubscribed: GiftFunnelMessage[];
  gift: {
    type: 'file' | 'link' | 'video';
    /** HTTPS URL for links (and legacy file/video URLs) */
    url: string;
    /** Telegram file_id when gift is uploaded via portal */
    telegramFileId?: string;
    /** photo when an image was uploaded as “file” — drives sendPhoto vs sendDocument */
    mediaType?: GiftPromoMediaType;
    caption?: string;
    /** Extra https URL buttons under the gift delivery post (default none) */
    extraButtons?: GiftExtraButton[];
  };
  afterGift: GiftFunnelMessage[];
  notGifted: GiftFunnelMessage[];
  subscribeButton?: { confirmLabel?: string };
}

export const GIFT_PROMO_MEDIA_TYPES = [
  'photo',
  'video',
  'document',
  'voice',
  'video_note',
  'audio',
] as const;
export type GiftPromoMediaType = (typeof GIFT_PROMO_MEDIA_TYPES)[number];

/** `<input accept>` for gift bot / broadcast media pickers */
export const GIFT_MEDIA_FILE_ACCEPT =
  'image/*,image/png,image/jpeg,image/webp,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.ogg,.opus,.oga,.mp3,.m4a,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/*';

/** Promo post published to the Telegram channel (gift lead magnet) */
export interface GiftPromoPost {
  text: string;
  /** photo | video | document | voice | video_note | audio; defaults to photo when omitted */
  mediaType?: GiftPromoMediaType;
  /** Telegram Bot API file_id (preferred — from portal file upload) */
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  /** Public HTTPS URL fallback for older drafts */
  mediaUrl?: string;
  /** @deprecated use mediaUrl / telegramFileId — kept for older drafts */
  imageUrl?: string;
  buttonText: string;
  clickCount: number;
  /** When false, channel button shows only buttonText (no « · N»). Default true. */
  showClickCounter?: boolean;
  telegramMessageId?: number;
  telegramChatId?: string;
  publishedAt?: string;
}

export const DEFAULT_GIFT_PROMO: GiftPromoPost = {
  text: '🎁 Забери подарок бесплатно!\n\nПодпишись на канал и нажми кнопку ниже — бот сразу отправит материал.',
  mediaType: 'photo',
  buttonText: 'Получить подарок',
  clickCount: 0,
  showClickCounter: true,
};

/** Prefer file_id, then mediaUrl / legacy imageUrl (for sendPhoto/sendVideo). */
export function resolveTelegramMedia(
  m: Pick<GiftPromoPost, 'telegramFileId' | 'mediaUrl' | 'imageUrl'>,
): string | undefined {
  return m.telegramFileId || m.mediaUrl || m.imageUrl || undefined;
}

/** @deprecated use resolveTelegramMedia */
export function promoMediaUrl(promo: Pick<GiftPromoPost, 'mediaUrl' | 'imageUrl' | 'telegramFileId'>): string | undefined {
  return resolveTelegramMedia(promo);
}

export function normalizeGiftMediaType(
  raw?: string | null,
): GiftPromoMediaType | undefined {
  if (
    raw === 'video' ||
    raw === 'photo' ||
    raw === 'document' ||
    raw === 'voice' ||
    raw === 'video_note' ||
    raw === 'audio'
  ) {
    return raw;
  }
  return undefined;
}

/** Bot API document file_id prefixes (incl. quality-preserved photo/video staging). */
export function isTelegramDocumentFileId(fileId: string): boolean {
  const id = String(fileId || '').trim();
  return id.startsWith('BQAC') || id.startsWith('BQAD');
}

/**
 * Infer Telegram send method from file_id prefix + optional stored mediaType.
 * Known file_id prefixes are authoritative (stored mediaType can lag / be wrong,
 * e.g. gift type=file defaulting to document while file_id is AgAC photo).
 *
 * Exception: BQAC/BQAD + stored photo|video — intentional quality-preserving
 * staging (original bytes as document; deliver via download→sendPhoto/Video).
 */
export function detectStoredMediaKind(
  fileId: string,
  mediaType?: GiftPromoMediaType | null,
): GiftPromoMediaType {
  const id = String(fileId || '').trim();
  if (id.startsWith('DQAC')) return 'video_note';
  if (id.startsWith('AwAC')) return 'voice';
  if (id.startsWith('CQAC')) return 'audio';
  if (id.startsWith('BAAC')) return 'video';
  if (isTelegramDocumentFileId(id)) {
    const stored = normalizeGiftMediaType(mediaType);
    // Quality-preserving staging: photo/video bytes kept as document file_id
    if (stored === 'photo' || stored === 'video') return stored;
    return 'document';
  }
  if (id.startsWith('AgAC')) return 'photo';
  // Unknown / empty prefix — trust stored mediaType
  const stored = normalizeGiftMediaType(mediaType);
  if (stored) return stored;
  // Unknown file_id → document is safer than sendPhoto
  if (id) return 'document';
  return 'photo';
}

/**
 * Choose Telegram staging/send kind from MIME + filename (+ optional video-note flag).
 * PDF/DOC/XLS → document; OGG/Opus → voice; MP3/M4A → audio; circle/note name → video_note.
 */
export function detectUploadMediaKind(
  mimeType: string,
  filename: string,
  opts?: { asVideoNote?: boolean },
): GiftPromoMediaType {
  const name = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  const looksVideo = mime.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(name);
  if (opts?.asVideoNote && looksVideo) return 'video_note';
  if (looksVideo && /(?:^|[_\-.])(circle|videonote|video[_-]?note|круг)/i.test(name)) {
    return 'video_note';
  }
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(name)) return 'photo';
  if (
    mime === 'audio/ogg' ||
    mime === 'audio/opus' ||
    mime === 'application/ogg' ||
    /\.(ogg|opus|oga)$/i.test(name)
  ) {
    return 'voice';
  }
  if (mime.startsWith('audio/') || /\.(mp3|m4a|aac|wav)$/i.test(name)) return 'audio';
  if (looksVideo) return 'video';
  return 'document';
}

export function promoMediaType(promo: Pick<GiftPromoPost, 'mediaType' | 'telegramFileId'>): GiftPromoMediaType {
  if (promo.telegramFileId) {
    return detectStoredMediaKind(promo.telegramFileId, promo.mediaType);
  }
  return normalizeGiftMediaType(promo.mediaType) || 'photo';
}

/** Deep-link start payload for promo button → gift bot */
export function giftPromoStartPayload(campaignId: string): string {
  return `g_${campaignId}`;
}

export function formatPromoButtonLabel(
  buttonText: string,
  clickCount: number,
  showClickCounter = true,
): string {
  const base = buttonText.trim() || 'Получить подарок';
  if (!showClickCounter) return base;
  return `${base} · ${clickCount}`;
}

/** Existing drafts without the field keep the counter on (backward compatible). */
export function promoShowClickCounter(
  promo: Pick<GiftPromoPost, 'showClickCounter'> | null | undefined,
): boolean {
  return promo?.showClickCounter !== false;
}

/**
 * Suggested Telegram bot username for Managed Bots provision.
 * Pattern: voxly_{nickname}_{01}_bot (5–32 chars, a-z0-9_, must end with "bot").
 */
export function buildVoxlyBotUsername(nickname: string, sequence: number): string {
  const nick =
    nickname
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16) || 'client';
  const n = Number.isFinite(sequence) ? Math.floor(sequence) : 1;
  const num = String(Math.min(99, Math.max(1, n))).padStart(2, '0');
  const suffix = `_${num}_bot`;
  const prefix = 'voxly_';
  const maxNick = Math.max(1, 32 - prefix.length - suffix.length);
  const nickTrim = nick.slice(0, maxNick);
  return `${prefix}${nickTrim}${suffix}`;
}

export {
  TELEGRAM_CLIENT_MD_HINT,
  TELEGRAM_CLIENT_MD_RMB_HINT,
  parseTelegramClientMd,
  clientMdToMarkdownV2,
  wrapSelection,
  type TgMdNode,
} from './telegram-md.js';

export const DEFAULT_GIFT_FUNNEL: GiftFunnelConfig = {
  start: {
    text: '**После /start**\nЭто сообщение клиент видит после того как запустил бота. То есть тут мы выдаем подарок, но предварительно проверяем подписку.',
  },
  notSubscribed: [
    {
      delayMinutes: 1,
      text: '**Если не подписан**\nТы нажал «Я подписался», но подписки на канал ещё нет. Подпишись и нажми кнопку снова.',
    },
    {
      delayMinutes: 20,
      text: '**Если не подписан**\nВсё ещё не вижу подписку. Зайди в канал и нажми «Я подписался».',
    },
  ],
  gift: {
    type: 'file',
    url: '',
    caption: '**Подарок** Вот твой подарок 🎁',
  },
  afterGift: [
    {
      delayMinutes: 1,
      text: '**После выдачи подарка**\nКак тебе материал? Если нужна помощь — напиши нам.',
    },
  ],
  notGifted: [
    {
      delayMinutes: 3,
      text: '**Если подарок не забрали**\nПодарок всё ещё ждёт тебя. Подпишись на канал и нажми «Я подписался».',
    },
    {
      delayMinutes: 10,
      text: '**Если подарок не забрали**\nНе забудь забрать подарок — подпишись на канал и нажми кнопку в боте.',
    },
  ],
  subscribeButton: { confirmLabel: 'Я подписался ✅' },
};
