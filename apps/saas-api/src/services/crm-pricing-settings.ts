import type { PrismaClient } from '@voxly/db';
import {
  loadPlatformPrices,
  savePlatformPrices,
  toCrmPlatformPricing,
  type PlatformPrices,
} from './platform-pricing.js';

export const CRM_PRICE_KEYS = {
  baseMonthly: 'crm_base_monthly',
  extraSeatMonthly: 'extra_seat_monthly',
} as const;

export type CrmPlatformPricing = {
  baseMonthly: number;
  extraSeatMonthly: number;
  seatsIncluded: number;
};

/** Global CRM list prices (admin-editable via PlatformSetting). */
export async function loadCrmPlatformPricing(
  prisma: PrismaClient,
): Promise<CrmPlatformPricing> {
  const plat = await loadPlatformPrices(prisma);
  return toCrmPlatformPricing(plat);
}

export async function saveCrmPlatformPricing(
  prisma: PrismaClient,
  input: { baseMonthly: number; extraSeatMonthly: number },
): Promise<CrmPlatformPricing> {
  const plat = await savePlatformPrices(prisma, {
    crm_base: input.baseMonthly,
    extra_seat: input.extraSeatMonthly,
  });
  return toCrmPlatformPricing(plat);
}

export type { PlatformPrices };
