// Voxly shared types and constants

export const PRODUCT_CODES = {
  CRM_BASE: 'crm_base',
  EXTRA_SEAT: 'extra_seat',
  GIFT_BOT: 'gift_bot',
  AI_TELEGRAM: 'ai_tg',
  /** +1 Business account slot beyond included 10 (200₽/mo) */
  AI_TG_EXTRA_CONN: 'ai_tg_extra_conn',
  /** Personal Telegram account via GramJS (500₽/mo + AI wallet) */
  AI_GRAMJS: 'ai_gramjs',
  AI_WHATSAPP: 'ai_wa',
  /** One-shot AI wallet top-up (not a subscription; excluded from referral) */
  AI_TOPUP: 'ai_topup',
  ANALYTICS_METRIKA: 'analytics_metrika',
  ANALYTICS_GA4: 'analytics_ga4',
  ANALYTICS_FACEBOOK: 'analytics_facebook',
  ANALYTICS_VK: 'analytics_vk',
} as const;

export type ProductCode = (typeof PRODUCT_CODES)[keyof typeof PRODUCT_CODES];

/** Products that never earn referral commission */
export const REFERRAL_EXCLUDED_PRODUCTS = new Set<string>([PRODUCT_CODES.AI_TOPUP]);

export const PRICING = {
  CRM_BASE_MONTHLY: 500,
  EXTRA_SEAT_MONTHLY: 300,
  GIFT_BOT_MONTHLY: 500,
  AI_TELEGRAM_MONTHLY: 1000,
  /** Up to 10 Telegram Business accounts included in AI_TELEGRAM */
  AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS: 10,
  /** Each active Business account beyond included 10 */
  AI_TG_EXTRA_CONN_MONTHLY: 200,
  /** Personal TG account (GramJS) fixed fee */
  AI_GRAMJS_MONTHLY: 500,
  /** WhatsApp account (Evolution) fixed fee */
  AI_WHATSAPP_MONTHLY: 500,
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

export const GRACE_PERIOD_DAYS = 7;
export const TRIAL_PERIOD_DAYS = 14;
export const REFERRAL_COOKIE_DAYS = 30;

export const ADDON_TYPES = [
  'gift_bot',
  'ai_tg',
  'ai_gramjs',
  'ai_wa',
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

/** Linear gift-bot funnel stored in GiftCampaignConfig.funnelJson */
export interface GiftFunnelMessage {
  delayMinutes: number;
  text: string;
  /** @deprecated prefer telegramFileId — kept for older drafts */
  imageUrl?: string;
  /** Telegram Bot API file_id from portal upload */
  telegramFileId?: string;
  mediaType?: GiftPromoMediaType;
}

export interface GiftFunnelConfig {
  start: {
    text: string;
    imageUrl?: string;
    telegramFileId?: string;
    mediaType?: GiftPromoMediaType;
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
  };
  afterGift: GiftFunnelMessage[];
  notGifted: GiftFunnelMessage[];
  subscribeButton?: { confirmLabel?: string };
}

export const GIFT_PROMO_MEDIA_TYPES = ['photo', 'video'] as const;
export type GiftPromoMediaType = (typeof GIFT_PROMO_MEDIA_TYPES)[number];

/** Promo post published to the Telegram channel (gift lead magnet) */
export interface GiftPromoPost {
  text: string;
  /** photo | video; defaults to photo when omitted */
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
  telegramMessageId?: number;
  telegramChatId?: string;
  publishedAt?: string;
}

export const DEFAULT_GIFT_PROMO: GiftPromoPost = {
  text: '🎁 Забери подарок бесплатно!\n\nПодпишись на канал и нажми кнопку ниже — бот сразу отправит материал.',
  mediaType: 'photo',
  buttonText: 'Получить подарок',
  clickCount: 0,
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

export function promoMediaType(promo: Pick<GiftPromoPost, 'mediaType'>): GiftPromoMediaType {
  return promo.mediaType === 'video' ? 'video' : 'photo';
}

/** Deep-link start payload for promo button → gift bot */
export function giftPromoStartPayload(campaignId: string): string {
  return `g_${campaignId}`;
}

export function formatPromoButtonLabel(buttonText: string, clickCount: number): string {
  const base = buttonText.trim() || 'Получить подарок';
  return `${base} · ${clickCount}`;
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
  parseTelegramClientMd,
  clientMdToMarkdownV2,
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
