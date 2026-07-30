import type { PrismaClient } from '@voxly/db';
import { PRICING } from '@voxly/shared';

export const CRM_PRICE_KEYS = {
  baseMonthly: 'crm_base_monthly',
  extraSeatMonthly: 'extra_seat_monthly',
} as const;

export type CrmPlatformPricing = {
  baseMonthly: number;
  extraSeatMonthly: number;
  seatsIncluded: number;
};

function parsePositiveRub(raw: string | null | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

/** Global CRM list prices (admin-editable via PlatformSetting). */
export async function loadCrmPlatformPricing(
  prisma: PrismaClient,
): Promise<CrmPlatformPricing> {
  const rows = await prisma.platformSetting.findMany({
    where: {
      key: { in: [CRM_PRICE_KEYS.baseMonthly, CRM_PRICE_KEYS.extraSeatMonthly] },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    baseMonthly: parsePositiveRub(map.get(CRM_PRICE_KEYS.baseMonthly), PRICING.CRM_BASE_MONTHLY),
    extraSeatMonthly: parsePositiveRub(
      map.get(CRM_PRICE_KEYS.extraSeatMonthly),
      PRICING.EXTRA_SEAT_MONTHLY,
    ),
    seatsIncluded: PRICING.SEATS_INCLUDED,
  };
}

export async function saveCrmPlatformPricing(
  prisma: PrismaClient,
  input: { baseMonthly: number; extraSeatMonthly: number },
): Promise<CrmPlatformPricing> {
  const baseMonthly = Math.round(Number(input.baseMonthly));
  const extraSeatMonthly = Math.round(Number(input.extraSeatMonthly));
  if (!Number.isFinite(baseMonthly) || baseMonthly < 0) {
    throw Object.assign(new Error('baseMonthly must be ≥ 0'), { statusCode: 400 });
  }
  if (!Number.isFinite(extraSeatMonthly) || extraSeatMonthly < 0) {
    throw Object.assign(new Error('extraSeatMonthly must be ≥ 0'), { statusCode: 400 });
  }

  await prisma.$transaction([
    prisma.platformSetting.upsert({
      where: { key: CRM_PRICE_KEYS.baseMonthly },
      create: {
        key: CRM_PRICE_KEYS.baseMonthly,
        value: String(baseMonthly),
        description: 'CRM base tariff ₽/month (platform default)',
      },
      update: { value: String(baseMonthly) },
    }),
    prisma.platformSetting.upsert({
      where: { key: CRM_PRICE_KEYS.extraSeatMonthly },
      create: {
        key: CRM_PRICE_KEYS.extraSeatMonthly,
        value: String(extraSeatMonthly),
        description: 'CRM extra seat ₽/month (platform default)',
      },
      update: { value: String(extraSeatMonthly) },
    }),
  ]);

  return {
    baseMonthly,
    extraSeatMonthly,
    seatsIncluded: PRICING.SEATS_INCLUDED,
  };
}
