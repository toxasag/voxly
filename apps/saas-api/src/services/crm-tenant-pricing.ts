import type { PrismaClient } from '@voxly/db';
import { PRICING } from '@voxly/shared';
import type { CrmPlatformPricing } from './crm-pricing-settings.js';

/** Per-tenant seat limit stored in PricingOverride (customPriceRub holds count). */
export const CRM_SEATS_INCLUDED_CODE = 'crm_seats_included';

export type CrmTenantPricing = {
  baseMonthly: number;
  extraSeatMonthly: number;
  seatsIncluded: number;
  /** True when value differs from platform default (override row exists). */
  customBase: boolean;
  customExtraSeat: boolean;
  customSeatsIncluded: boolean;
};

function parseRub(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

function parseSeats(raw: unknown, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > 500) return fallback;
  return n;
}

export async function loadTenantCrmPricing(
  prisma: PrismaClient,
  tenantId: string,
  platform: CrmPlatformPricing,
  subscriptionSeatsIncluded?: number | null,
): Promise<CrmTenantPricing> {
  const overrides = await prisma.pricingOverride.findMany({
    where: {
      tenantId,
      productCode: { in: ['crm_base', 'extra_seat', CRM_SEATS_INCLUDED_CODE] },
    },
  });
  const map = new Map(overrides.map((o) => [o.productCode, o]));

  const baseRow = map.get('crm_base');
  const extraRow = map.get('extra_seat');
  const seatsRow = map.get(CRM_SEATS_INCLUDED_CODE);

  const seatsFallback =
    subscriptionSeatsIncluded != null && subscriptionSeatsIncluded > 0
      ? subscriptionSeatsIncluded
      : platform.seatsIncluded;

  return {
    baseMonthly: baseRow?.customPriceRub != null
      ? parseRub(baseRow.customPriceRub, platform.baseMonthly)
      : platform.baseMonthly,
    extraSeatMonthly: extraRow?.customPriceRub != null
      ? parseRub(extraRow.customPriceRub, platform.extraSeatMonthly)
      : platform.extraSeatMonthly,
    seatsIncluded: seatsRow?.customPriceRub != null
      ? parseSeats(seatsRow.customPriceRub, seatsFallback)
      : seatsFallback,
    customBase: baseRow?.customPriceRub != null,
    customExtraSeat: extraRow?.customPriceRub != null,
    customSeatsIncluded: seatsRow?.customPriceRub != null,
  };
}

export async function loadTenantsCrmPricingMap(
  prisma: PrismaClient,
  tenantIds: string[],
  platform: CrmPlatformPricing,
  subscriptionSeatsByTenant: Map<string, number>,
): Promise<Map<string, CrmTenantPricing>> {
  if (tenantIds.length === 0) return new Map();

  const overrides = await prisma.pricingOverride.findMany({
    where: {
      tenantId: { in: tenantIds },
      productCode: { in: ['crm_base', 'extra_seat', CRM_SEATS_INCLUDED_CODE] },
    },
  });

  const byTenant = new Map<string, Map<string, (typeof overrides)[0]>>();
  for (const o of overrides) {
    if (!o.tenantId) continue;
    if (!byTenant.has(o.tenantId)) byTenant.set(o.tenantId, new Map());
    byTenant.get(o.tenantId)!.set(o.productCode, o);
  }

  const result = new Map<string, CrmTenantPricing>();
  for (const tenantId of tenantIds) {
    const map = byTenant.get(tenantId) ?? new Map();
    const subSeats = subscriptionSeatsByTenant.get(tenantId);
    const seatsFallback =
      subSeats != null && subSeats > 0 ? subSeats : platform.seatsIncluded;

    const baseRow = map.get('crm_base');
    const extraRow = map.get('extra_seat');
    const seatsRow = map.get(CRM_SEATS_INCLUDED_CODE);

    result.set(tenantId, {
      baseMonthly: baseRow?.customPriceRub != null
        ? parseRub(baseRow.customPriceRub, platform.baseMonthly)
        : platform.baseMonthly,
      extraSeatMonthly: extraRow?.customPriceRub != null
        ? parseRub(extraRow.customPriceRub, platform.extraSeatMonthly)
        : platform.extraSeatMonthly,
      seatsIncluded: seatsRow?.customPriceRub != null
        ? parseSeats(seatsRow.customPriceRub, seatsFallback)
        : seatsFallback,
      customBase: baseRow?.customPriceRub != null,
      customExtraSeat: extraRow?.customPriceRub != null,
      customSeatsIncluded: seatsRow?.customPriceRub != null,
    });
  }
  return result;
}

export async function saveTenantCrmPricing(
  prisma: PrismaClient,
  tenantId: string,
  input: {
    baseMonthly?: number | null;
    extraSeatMonthly?: number | null;
    seatsIncluded?: number | null;
  },
  platform: CrmPlatformPricing,
): Promise<CrmTenantPricing> {
  const upsertPrice = async (
    productCode: string,
    value: number | null | undefined,
    platformDefault: number,
  ) => {
    if (value === undefined) return;
    if (value === null || Math.round(Number(value)) === platformDefault) {
      await prisma.pricingOverride.deleteMany({ where: { tenantId, productCode } });
      return;
    }
    const rub = Math.round(Number(value));
    if (!Number.isFinite(rub) || rub < 0) {
      throw Object.assign(new Error(`${productCode}: price must be ≥ 0`), { statusCode: 400 });
    }
    await prisma.pricingOverride.upsert({
      where: { tenantId_productCode: { tenantId, productCode } },
      create: { tenantId, productCode, customPriceRub: rub },
      update: { customPriceRub: rub },
    });
  };

  const upsertSeats = async (value: number | null | undefined) => {
    if (value === undefined) return;

    const isPlatformDefault =
      value === null || Math.round(Number(value)) === platform.seatsIncluded;

    if (isPlatformDefault) {
      await prisma.pricingOverride.deleteMany({
        where: { tenantId, productCode: CRM_SEATS_INCLUDED_CODE },
      });
    } else {
      const seats = parseSeats(value, platform.seatsIncluded);
      await prisma.pricingOverride.upsert({
        where: { tenantId_productCode: { tenantId, productCode: CRM_SEATS_INCLUDED_CODE } },
        create: { tenantId, productCode: CRM_SEATS_INCLUDED_CODE, customPriceRub: seats },
        update: { customPriceRub: seats },
      });
    }

    // Always sync active crm_base subscription — including reset to platform default.
    const seatsToSync = isPlatformDefault
      ? platform.seatsIncluded
      : parseSeats(value, platform.seatsIncluded);

    await prisma.subscription.updateMany({
      where: { tenantId, status: 'active', productCode: 'crm_base' },
      data: { seatsIncluded: seatsToSync },
    });
  };

  await upsertPrice('crm_base', input.baseMonthly, platform.baseMonthly);
  await upsertPrice('extra_seat', input.extraSeatMonthly, platform.extraSeatMonthly);
  await upsertSeats(input.seatsIncluded);

  const activeSub = await prisma.subscription.findFirst({
    where: { tenantId, status: 'active', productCode: 'crm_base' },
    select: { seatsIncluded: true },
  });

  return loadTenantCrmPricing(
    prisma,
    tenantId,
    platform,
    activeSub?.seatsIncluded ?? PRICING.SEATS_INCLUDED,
  );
}
