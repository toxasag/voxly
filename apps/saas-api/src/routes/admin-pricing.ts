/**
 * Superadmin platform + per-tenant list prices for monthly SKUs.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  MONTHLY_PRICE_SKUS,
  MONTHLY_PRICE_SKU_SET,
  PRICE_MAX_RUB,
  PRICE_MIN_RUB,
  PLATFORM_PRICE_MIN_RUB,
  SKU_LABELS,
  buildTenantPricingView,
  loadPlatformPrices,
  savePlatformPrices,
  saveTenantPrices,
  type MonthlyPriceSku,
} from '../services/platform-pricing.js';
import {
  COMP_ACCESS_MONTHS,
  grantCompAccess,
} from '../services/comp-access.js';

function actorUserId(request: { user?: { sub?: string; userId?: string } }): string {
  return request.user?.sub || request.user?.userId || 'unknown';
}

const platformPriceField = z.number().min(PLATFORM_PRICE_MIN_RUB).max(PRICE_MAX_RUB);
/** Per-tenant overrides may be 0 ₽ (free / comp). Empty/null = inherit platform. */
const nullablePrice = z.number().min(PRICE_MIN_RUB).max(PRICE_MAX_RUB).nullable().optional();

export const adminPricingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  fastify.get('/pricing', async (_request, reply) => {
    const platform = await loadPlatformPrices(fastify.prisma);
    const skus = MONTHLY_PRICE_SKUS.map((code) => ({
      productCode: code,
      label: SKU_LABELS[code],
      priceMonthly: platform[code],
    }));
    return reply.send({
      policy: 'next_checkout_only',
      seatsIncludedDefault: platform.seatsIncluded,
      skus,
      prices: Object.fromEntries(
        MONTHLY_PRICE_SKUS.map((c) => [c, platform[c]]),
      ) as Record<MonthlyPriceSku, number>,
    });
  });

  fastify.put('/pricing', async (request, reply) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const sku of MONTHLY_PRICE_SKUS) {
      shape[sku] = platformPriceField.optional();
    }
    const body = z.object(shape).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: `Each SKU price must be ${PLATFORM_PRICE_MIN_RUB}…${PRICE_MAX_RUB} ₽`,
      });
    }

    const before = await loadPlatformPrices(fastify.prisma);
    const patch: Partial<Record<MonthlyPriceSku, number>> = {};
    for (const sku of MONTHLY_PRICE_SKUS) {
      const v = (body.data as Record<string, number | undefined>)[sku];
      if (v !== undefined) patch[sku] = v;
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'No prices to update' });
    }

    try {
      const platform = await savePlatformPrices(fastify.prisma, patch);
      await fastify.prisma.auditLog.create({
        data: {
          actorUserId: actorUserId(request as any),
          action: 'pricing_platform_update',
          payload: { before: pickSkuPrices(before), after: pickSkuPrices(platform), patch },
        },
      });
      return reply.send({
        policy: 'next_checkout_only',
        prices: pickSkuPrices(platform),
        seatsIncludedDefault: platform.seatsIncluded,
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed to save pricing',
      });
    }
  });

  fastify.get('/pricing/tenants', async (request, reply) => {
    const q = (request.query || {}) as { search?: string };
    const search = (q.search || '').trim().toLowerCase();

    const tenants = await fastify.prisma.tenant.findMany({
      select: {
        id: true,
        slug: true,
        status: true,
        users: {
          where: { role: 'owner' },
          take: 1,
          include: { user: { select: { email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const platform = await loadPlatformPrices(fastify.prisma);
    const filtered = search
      ? tenants.filter(
          (t) =>
            t.slug.toLowerCase().includes(search) ||
            (t.users[0]?.user.email || '').toLowerCase().includes(search),
        )
      : tenants;

    const views = await Promise.all(
      filtered.map((t) => buildTenantPricingView(fastify.prisma, t.id, t.slug, platform)),
    );

    return reply.send({
      policy: 'next_checkout_only',
      platform: pickSkuPrices(platform),
      seatsIncludedDefault: platform.seatsIncluded,
      tenants: views.map((v, i) => ({
        ...v,
        status: filtered[i].status,
        ownerEmail: filtered[i].users[0]?.user.email || null,
      })),
    });
  });

  fastify.get('/pricing/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    const view = await buildTenantPricingView(fastify.prisma, tenant.id, tenant.slug);
    return reply.send({ policy: 'next_checkout_only', ...view });
  });

  fastify.put('/pricing/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const shape: Record<string, z.ZodTypeAny> = {
      seatsIncluded: z.number().int().min(1).max(500).nullable().optional(),
    };
    for (const sku of MONTHLY_PRICE_SKUS) {
      shape[sku] = nullablePrice;
    }
    const body = z.object(shape).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid tenant pricing payload' });
    }

    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const before = await buildTenantPricingView(fastify.prisma, id, tenant.slug);
    try {
      const view = await saveTenantPrices(fastify.prisma, id, body.data as any);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: id,
          actorUserId: actorUserId(request as any),
          action: 'pricing_tenant_update',
          payload: {
            slug: view.slug,
            patch: body.data,
            before: before
              ? {
                  prices: before.prices.map((p) => ({
                    code: p.productCode,
                    effective: p.effective,
                    custom: p.custom,
                  })),
                  seatsIncluded: before.seatsIncluded,
                }
              : null,
            after: {
              prices: view.prices.map((p) => ({
                code: p.productCode,
                effective: p.effective,
                custom: p.custom,
              })),
              seatsIncluded: view.seatsIncluded,
            },
          },
        },
      });
      return reply.send({ policy: 'next_checkout_only', ...view });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed to save tenant pricing',
      });
    }
  });

  /** Grant free product access for N months (CRM + prices 0 + existing addons). AI wallet untouched. */
  fastify.post('/pricing/tenants/:id/comp-access', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        months: z.union([
          z.literal(1),
          z.literal(3),
          z.literal(6),
          z.literal(12),
        ]),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: `months must be one of: ${COMP_ACCESS_MONTHS.join(', ')}`,
      });
    }

    try {
      const result = await grantCompAccess(fastify.prisma, id, body.data.months);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: id,
          actorUserId: actorUserId(request as any),
          action: 'comp_access_grant',
          payload: {
            slug: result.slug,
            months: result.months,
            endsAt: result.endsAt,
            pricesZeroed: result.pricesZeroed,
            addonsExtended: result.addonsExtended,
          },
        },
      });
      return reply.send({
        policy: 'comp_access',
        ...result,
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed to grant free access',
      });
    }
  });
};

function pickSkuPrices(platform: Record<MonthlyPriceSku, number> & { seatsIncluded: number }) {
  return Object.fromEntries(MONTHLY_PRICE_SKUS.map((c) => [c, platform[c]])) as Record<
    MonthlyPriceSku,
    number
  >;
}

/** Legacy alias helper — only monthly catalogue SKUs. */
export function isMonthlyPriceSku(code: string): code is MonthlyPriceSku {
  return MONTHLY_PRICE_SKU_SET.has(code);
}
