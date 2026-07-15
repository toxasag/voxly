// Voxly shared types and constants

export const PRODUCT_CODES = {
  CRM_BASE: 'crm_base',
  EXTRA_SEAT: 'extra_seat',
  GIFT_BOT: 'gift_bot',
  AI_TELEGRAM: 'ai_tg',
  AI_WHATSAPP: 'ai_wa',
  ANALYTICS_METRIKA: 'analytics_metrika',
  ANALYTICS_GA4: 'analytics_ga4',
  ANALYTICS_FACEBOOK: 'analytics_facebook',
  ANALYTICS_VK: 'analytics_vk',
} as const;

export type ProductCode = (typeof PRODUCT_CODES)[keyof typeof PRODUCT_CODES];

export const PRICING = {
  CRM_BASE_MONTHLY: 500,
  EXTRA_SEAT_MONTHLY: 300,
  GIFT_BOT_MONTHLY: 500,
  AI_TELEGRAM_MONTHLY: 1000,
  AI_WHATSAPP_MONTHLY: 1000,
  ANALYTICS_PLATFORM_MONTHLY: 500,
  AI_TOPUP_MIN_RUB: 500,
  AI_MARKUP_PERCENT_DEFAULT: 50,
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
export const REFERRAL_COOKIE_DAYS = 30;

export const ADDON_TYPES = [
  'gift_bot',
  'ai_tg',
  'ai_wa',
  'analytics_metrika',
  'analytics_ga4',
  'analytics_facebook',
  'analytics_vk',
] as const;

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

export const CONVERSATION_MODES = ['bot', 'human'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[keyof typeof CONVERSATION_MODES];

export const PRESET_GOALS = [
  'bot_start',
  'subscription_requested',
  'subscription_verified',
  'gift_delivered',
  'phone_submitted',
  'lead_created',
] as const;

export type PresetGoal = (typeof PRESET_GOALS)[keyof typeof PRESET_GOALS];
