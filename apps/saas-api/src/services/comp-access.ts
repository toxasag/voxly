/**
 * Admin "comp" grant: free product access for N months without touching AI wallet.
 * - Tenant → active
 * - CRM crm_base subscription extended/created
 * - All MONTHLY_PRICE_SKUS overrides → 0 ₽
 * - Existing addons extended (not created)
 * - Twenty CRM unlocked after commit
 */
import type { PrismaClient } from '@voxly/db';
import { PRODUCT_CODES } from '@voxly/shared';
import {
  MONTHLY_PRICE_SKUS,
  buildTenantPricingView,
  loadPlatformPrices,
  toCrmPlatformPricing,
  type TenantPricingView,
} from './platform-pricing.js';
import { loadTenantCrmPricing } from './crm-tenant-pricing.js';
import { syncTwentyCrmLock } from './crm-access.js';

export const COMP_ACCESS_MONTHS = [1, 3, 6, 12] as const;
export type CompAccessMonths = (typeof COMP_ACCESS_MONTHS)[number];

export type CompAccessResult = {
  tenantId: string;
  slug: string;
  months: CompAccessMonths;
  endsAt: string;
  pricesZeroed: string[];
  addonsExtended: Array<{ id: string; type: string; activeUntil: string }>;
  pricing: TenantPricingView;
};

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function grantCompAccess(
  prisma: PrismaClient,
  tenantId: string,
  months: CompAccessMonths,
): Promise<CompAccessResult> {
  if (!(COMP_ACCESS_MONTHS as readonly number[]).includes(months)) {
    throw Object.assign(new Error('months must be 1, 3, 6, or 12'), { statusCode: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, twentyWorkspaceId: true, status: true },
  });
  if (!tenant) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }

  const platform = await loadPlatformPrices(prisma);
  const crmPlatform = toCrmPlatformPricing(platform);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
    });

    // Expire open trials so access evaluation prefers the new paid/comp window.
    await tx.subscription.updateMany({
      where: {
        tenantId,
        status: 'active',
        periodMonths: 0,
        productCode: PRODUCT_CODES.CRM_BASE,
      },
      data: { status: 'expired' },
    });

    const priorCrm = await tx.subscription.findFirst({
      where: {
        tenantId,
        productCode: PRODUCT_CODES.CRM_BASE,
        OR: [{ status: 'active' }, { status: 'expired', periodMonths: 0 }],
      },
      orderBy: { endsAt: 'desc' },
    });

    let endsAt = addMonths(now, months);
    if (priorCrm && priorCrm.status === 'active' && priorCrm.endsAt > now) {
      endsAt = addMonths(priorCrm.endsAt, months);
    }

    const crmPricing = await loadTenantCrmPricing(
      tx as unknown as PrismaClient,
      tenantId,
      crmPlatform,
      priorCrm?.status === 'active' ? priorCrm.seatsIncluded : null,
    );

    if (priorCrm && priorCrm.status === 'active' && priorCrm.endsAt > now) {
      await tx.subscription.update({
        where: { id: priorCrm.id },
        data: {
          endsAt,
          periodMonths: months,
          status: 'active',
          seatsIncluded: crmPricing.seatsIncluded,
        },
      });
    } else {
      await tx.subscription.create({
        data: {
          tenantId,
          productCode: PRODUCT_CODES.CRM_BASE,
          periodMonths: months,
          seatsIncluded: crmPricing.seatsIncluded,
          extraSeats: priorCrm?.extraSeats ?? 0,
          startsAt: now,
          endsAt,
          status: 'active',
        },
      });
    }

    const pricesZeroed: string[] = [];
    for (const sku of MONTHLY_PRICE_SKUS) {
      await tx.pricingOverride.upsert({
        where: { tenantId_productCode: { tenantId, productCode: sku } },
        create: { tenantId, productCode: sku, customPriceRub: 0 },
        update: { customPriceRub: 0 },
      });
      pricesZeroed.push(sku);
    }

    const addons = await tx.addon.findMany({ where: { tenantId } });
    const addonsExtended: Array<{ id: string; type: string; activeUntil: string }> = [];
    for (const addon of addons) {
      const base = addon.activeUntil.getTime() > now.getTime() ? addon.activeUntil : now;
      const activeUntil = addMonths(base, months);
      const updated = await tx.addon.update({
        where: { id: addon.id },
        data: { status: 'active', activeUntil },
      });
      addonsExtended.push({
        id: updated.id,
        type: updated.type,
        activeUntil: updated.activeUntil.toISOString(),
      });
    }

    return { endsAt, pricesZeroed, addonsExtended };
  });

  await syncTwentyCrmLock(tenant.twentyWorkspaceId, false);

  const pricing = await buildTenantPricingView(prisma, tenantId, tenant.slug, platform);

  return {
    tenantId,
    slug: tenant.slug,
    months,
    endsAt: result.endsAt.toISOString(),
    pricesZeroed: result.pricesZeroed,
    addonsExtended: result.addonsExtended,
    pricing,
  };
}
