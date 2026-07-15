import { describe, it, expect } from 'vitest';
import {
  PRODUCT_CODES,
  PRICING,
  PERIOD_DISCOUNTS,
  ADDON_TYPES,
  ANALYTICS_PLATFORMS,
  REFERRAL_RULE_TYPES,
  TENANT_STATUS,
  USER_ROLES,
  BOT_PROVISION_VIA,
  PRESET_GOALS,
} from '../src/index';

describe('@voxly/shared exports', () => {
  it('exports PRODUCT_CODES with expected keys', () => {
    expect(PRODUCT_CODES.CRM_BASE).toBe('crm_base');
    expect(PRODUCT_CODES.EXTRA_SEAT).toBe('extra_seat');
    expect(PRODUCT_CODES.GIFT_BOT).toBe('gift_bot');
    expect(PRODUCT_CODES.AI_TELEGRAM).toBe('ai_tg');
    expect(PRODUCT_CODES.AI_WHATSAPP).toBe('ai_wa');
  });

  it('exports PRICING constants', () => {
    expect(PRICING.CRM_BASE_MONTHLY).toBe(500);
    expect(PRICING.EXTRA_SEAT_MONTHLY).toBe(300);
    expect(PRICING.SEATS_INCLUDED).toBe(10);
    expect(PRICING.AI_MARKUP_PERCENT_DEFAULT).toBe(50);
    expect(PRICING.AI_TOPUP_MIN_RUB).toBe(500);
  });

  it('exports PERIOD_DISCOUNTS with expected tiers', () => {
    expect(PERIOD_DISCOUNTS[1]).toBe(0);
    expect(PERIOD_DISCOUNTS[12]).toBe(10);
    expect(PERIOD_DISCOUNTS[24]).toBe(15);
  });

  it('exports the canonical const arrays', () => {
    expect(ADDON_TYPES).toContain('gift_bot');
    expect(ADDON_TYPES).toContain('ai_tg');
    expect(ANALYTICS_PLATFORMS).toEqual(['metrika', 'ga4', 'facebook', 'vk']);
    expect(REFERRAL_RULE_TYPES).toContain('percent_recurring');
    expect(TENANT_STATUS).toContain('active');
    expect(USER_ROLES).toEqual(['superadmin', 'owner', 'member']);
    expect(BOT_PROVISION_VIA).toEqual(['managed', 'manual']);
    expect(PRESET_GOALS).toContain('bot_start');
  });
});
