/**
 * Platform + per-tenant list prices for monthly SKUs.
 * Resolution: PricingOverride (tenant) → PlatformSetting → PRICING constants.
 * Affects next checkout only (pending invoices keep Payment.amount).
 */
import type { PrismaClient } from '@voxly/db';
import { PRICING, PRODUCT_CODES } from '@voxly/shared';
import {
  CRM_SEATS_INCLUDED_CODE,
  loadTenantCrmPricing,
  type CrmTenantPricing,
} from './crm-tenant-pricing.js';

/** Editable monthly unit prices (₽/mo). Not ai_topup / analytics. */
export const MONTHLY_PRICE_SKUS = [
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

export type MonthlyPriceSku = (typeof MONTHLY_PRICE_SKUS)[number];

export const MONTHLY_PRICE_SKU_SET = new Set<string>(MONTHLY_PRICE_SKUS);

export const SKU_LABELS: Record<MonthlyPriceSku, string> = {
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

const FALLBACK_BY_SKU: Record<MonthlyPriceSku, number> = {
  crm_base: PRICING.CRM_BASE_MONTHLY,
  extra_seat: PRICING.EXTRA_SEAT_MONTHLY,
  gift_bot: PRICING.GIFT_BOT_MONTHLY,
  gift_bot_max: PRICING.GIFT_BOT_MAX_MONTHLY,
  ai_tg: PRICING.AI_TELEGRAM_MONTHLY,
  ai_tg_extra_conn: PRICING.AI_TG_EXTRA_CONN_MONTHLY,
  ai_gramjs: PRICING.AI_GRAMJS_MONTHLY,
  ai_max: PRICING.AI_MAX_MONTHLY,
  ai_wa: PRICING.AI_WHATSAPP_MONTHLY,
  ai_agent: PRICING.AI_AGENT_MONTHLY,
  mailing_bot: PRICING.MAILING_BOT_MONTHLY,
  mailing_accounts: PRICING.MAILING_ACCOUNTS_MONTHLY,
  mailing_stories: PRICING.MAILING_STORIES_MONTHLY,
};

/** PlatformSetting key for a monthly SKU. CRM keeps legacy key names. */
export function platformSettingKey(sku: MonthlyPriceSku): string {
  if (sku === PRODUCT_CODES.CRM_BASE) return 'crm_base_monthly';
  if (sku === PRODUCT_CODES.EXTRA_SEAT) return 'extra_seat_monthly';
  return `${sku}_monthly`;
}

/** Tenant overrides may be 0 ₽ (comp / free client). Platform defaults stay ≥ 1. */
export const PRICE_MIN_RUB = 0;
export const PLATFORM_PRICE_MIN_RUB = 1;
export const PRICE_MAX_RUB = 1_000_000;

export type PlatformPrices = Record<MonthlyPriceSku, number> & {
  seatsIncluded: number;
};

export type TenantPriceRow = {
  productCode: MonthlyPriceSku;
  label: string;
  platform: number;
  override: number | null;
  effective: number;
  custom: boolean;
};

export type TenantPricingView = {
  tenantId: string;
  slug: string;
  seatsIncluded: number;
  customSeatsIncluded: boolean;
  prices: TenantPriceRow[];
  hasAnyCustom: boolean;
};

function parseRub(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function assertValidPriceRub(
  value: number,
  field = 'price',
  minRub: number = PRICE_MIN_RUB,
): number {
  const rub = Math.round(Number(value));
  if (!Number.isFinite(rub) || rub < minRub || rub > PRICE_MAX_RUB) {
    throw Object.assign(
      new Error(`${field} must be ${minRub}…${PRICE_MAX_RUB} ₽`),
      { statusCode: 400 },
    );
  }
  return rub;
}

export function defaultPlatformPrices(): PlatformPrices {
  const prices = {} as PlatformPrices;
  for (const sku of MONTHLY_PRICE_SKUS) {
    prices[sku] = FALLBACK_BY_SKU[sku];
  }
  prices.seatsIncluded = PRICING.SEATS_INCLUDED;
  return prices;
}

export async function loadPlatformPrices(prisma: PrismaClient): Promise<PlatformPrices> {
  const keys = [
    ...MONTHLY_PRICE_SKUS.map(platformSettingKey),
    'subscription_seats_included',
  ];
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const prices = defaultPlatformPrices();
  for (const sku of MONTHLY_PRICE_SKUS) {
    prices[sku] = parseRub(map.get(platformSettingKey(sku)), FALLBACK_BY_SKU[sku]);
  }
  const seatsParsed = Number(map.get('subscription_seats_included'));
  prices.seatsIncluded =
    Number.isFinite(seatsParsed) && seatsParsed >= 1
      ? Math.round(seatsParsed)
      : PRICING.SEATS_INCLUDED;
  return prices;
}

export async function savePlatformPrices(
  prisma: PrismaClient,
  input: Partial<Record<MonthlyPriceSku, number>>,
): Promise<PlatformPrices> {
  const ops = [];
  for (const sku of MONTHLY_PRICE_SKUS) {
    if (input[sku] === undefined) continue;
    const rub = assertValidPriceRub(input[sku] as number, sku, PLATFORM_PRICE_MIN_RUB);
    const key = platformSettingKey(sku);
    ops.push(
      prisma.platformSetting.upsert({
        where: { key },
        create: {
          key,
          value: String(rub),
          description: `${SKU_LABELS[sku]} ₽/month (platform default)`,
        },
        update: { value: String(rub) },
      }),
    );
  }
  if (ops.length) await prisma.$transaction(ops);
  return loadPlatformPrices(prisma);
}

/** Unit list price for checkout / UI. Analytics fall back to PRICING constant. */
export async function resolveUnitPrice(
  prisma: PrismaClient,
  tenantId: string | null | undefined,
  productCode: string,
  platform?: PlatformPrices,
): Promise<number> {
  const plat = platform ?? (await loadPlatformPrices(prisma));

  if (MONTHLY_PRICE_SKU_SET.has(productCode)) {
    const sku = productCode as MonthlyPriceSku;
    if (tenantId) {
      const row = await prisma.pricingOverride.findUnique({
        where: { tenantId_productCode: { tenantId, productCode: sku } },
        select: { customPriceRub: true },
      });
      if (row?.customPriceRub != null) {
        return parseRub(row.customPriceRub, plat[sku]);
      }
    }
    return plat[sku];
  }

  // Analytics / unknown — compile-time defaults (not admin-editable in v1).
  const analytics: Record<string, number> = {
    analytics_metrika: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_ga4: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_facebook: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_vk: PRICING.ANALYTICS_PLATFORM_MONTHLY,
  };
  return analytics[productCode] ?? 0;
}

/** Sync resolve when platform + override map already loaded (MRR / bulk). */
export function resolveUnitPriceSync(
  productCode: string,
  platform: PlatformPrices,
  tenantOverrides?: Map<string, number>,
): number {
  if (MONTHLY_PRICE_SKU_SET.has(productCode)) {
    const sku = productCode as MonthlyPriceSku;
    const ov = tenantOverrides?.get(sku);
    if (ov != null) return ov;
    return platform[sku];
  }
  const analytics: Record<string, number> = {
    analytics_metrika: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_ga4: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_facebook: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_vk: PRICING.ANALYTICS_PLATFORM_MONTHLY,
  };
  return analytics[productCode] ?? 0;
}

export async function loadTenantOverrideMap(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.pricingOverride.findMany({
    where: {
      tenantId,
      productCode: { in: [...MONTHLY_PRICE_SKUS] },
      customPriceRub: { not: null },
    },
    select: { productCode: true, customPriceRub: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.customPriceRub != null) map.set(r.productCode, parseRub(r.customPriceRub, 0));
  }
  return map;
}

export async function buildTenantPricingView(
  prisma: PrismaClient,
  tenantId: string,
  slug: string,
  platform?: PlatformPrices,
): Promise<TenantPricingView> {
  const plat = platform ?? (await loadPlatformPrices(prisma));
  const overrides = await loadTenantOverrideMap(prisma, tenantId);

  const activeSub = await prisma.subscription.findFirst({
    where: { tenantId, status: 'active', productCode: 'crm_base' },
    select: { seatsIncluded: true },
  });
  const crm = await loadTenantCrmPricing(
    prisma,
    tenantId,
    {
      baseMonthly: plat.crm_base,
      extraSeatMonthly: plat.extra_seat,
      seatsIncluded: plat.seatsIncluded,
    },
    activeSub?.seatsIncluded,
  );

  const prices: TenantPriceRow[] = MONTHLY_PRICE_SKUS.map((sku) => {
    const platformPrice = plat[sku];
    const has = overrides.has(sku);
    const override = has ? overrides.get(sku)! : null;
    const effective = has ? override! : platformPrice;
    return {
      productCode: sku,
      label: SKU_LABELS[sku],
      platform: platformPrice,
      override,
      effective,
      custom: has,
    };
  });

  return {
    tenantId,
    slug,
    seatsIncluded: crm.seatsIncluded,
    customSeatsIncluded: crm.customSeatsIncluded,
    prices,
    hasAnyCustom: prices.some((p) => p.custom) || crm.customSeatsIncluded,
  };
}

export async function saveTenantPrices(
  prisma: PrismaClient,
  tenantId: string,
  input: Partial<Record<MonthlyPriceSku, number | null>> & {
    seatsIncluded?: number | null;
  },
  platform?: PlatformPrices,
): Promise<TenantPricingView> {
  const plat = platform ?? (await loadPlatformPrices(prisma));
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }

  for (const sku of MONTHLY_PRICE_SKUS) {
    if (input[sku] === undefined) continue;
    const value = input[sku];
    if (value === null || Math.round(Number(value)) === plat[sku]) {
      await prisma.pricingOverride.deleteMany({ where: { tenantId, productCode: sku } });
      continue;
    }
    const rub = assertValidPriceRub(value as number, sku);
    await prisma.pricingOverride.upsert({
      where: { tenantId_productCode: { tenantId, productCode: sku } },
      create: { tenantId, productCode: sku, customPriceRub: rub },
      update: { customPriceRub: rub },
    });
  }

  if (input.seatsIncluded !== undefined) {
    const { saveTenantCrmPricing } = await import('./crm-tenant-pricing.js');
    await saveTenantCrmPricing(
      prisma,
      tenantId,
      { seatsIncluded: input.seatsIncluded },
      {
        baseMonthly: plat.crm_base,
        extraSeatMonthly: plat.extra_seat,
        seatsIncluded: plat.seatsIncluded,
      },
    );
  }

  return buildTenantPricingView(prisma, tenantId, tenant.slug, plat);
}

/** CRM-shaped view for existing /admin/crm consumers. */
export function toCrmPlatformPricing(plat: PlatformPrices) {
  return {
    baseMonthly: plat.crm_base,
    extraSeatMonthly: plat.extra_seat,
    seatsIncluded: plat.seatsIncluded,
  };
}

export async function loadCrmPricingCompat(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ platform: ReturnType<typeof toCrmPlatformPricing>; tenant: CrmTenantPricing }> {
  const plat = await loadPlatformPrices(prisma);
  const platform = toCrmPlatformPricing(plat);
  const activeSub = await prisma.subscription.findFirst({
    where: { tenantId, status: 'active', productCode: 'crm_base' },
    select: { seatsIncluded: true },
  });
  const tenant = await loadTenantCrmPricing(
    prisma,
    tenantId,
    platform,
    activeSub?.seatsIncluded,
  );
  return { platform, tenant };
}

export { CRM_SEATS_INCLUDED_CODE };
