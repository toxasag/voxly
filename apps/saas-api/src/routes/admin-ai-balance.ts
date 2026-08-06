/**
 * Superadmin AI wallet markup settings + usage/top-up statistics.
 * Markup applies to usage charging (providerCost → chargedRub), not to top-up ₽→wallet 1:1.
 */
import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@voxly/db';
import { PRICING } from '@voxly/shared';
import { z } from 'zod';

const MARKUP_KEY = 'ai_markup_percent';
const MARKUP_MIN = 0;
const MARKUP_MAX = 500;

function actorUserId(request: { user?: { sub?: string; userId?: string } }): string {
  return request.user?.sub || request.user?.userId || 'unknown';
}

function parsePeriod(query: { from?: string; to?: string }): {
  from: Date;
  to: Date;
  error?: string;
} {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { from, to, error: 'from/to must be ISO dates' };
  }
  if (from > to) {
    return { from, to, error: 'from must be ≤ to' };
  }
  return { from, to };
}

function dec(n: Prisma.Decimal | null | undefined): number {
  return n != null ? Number(n) : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function loadGlobalMarkup(prisma: {
  platformSetting: {
    findUnique: (args: {
      where: { key: string };
    }) => Promise<{ value: string } | null>;
  };
}): Promise<number> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: MARKUP_KEY },
  });
  if (!row?.value) return PRICING.AI_MARKUP_PERCENT_DEFAULT;
  const n = parseInt(String(row.value), 10);
  return Number.isFinite(n) ? n : PRICING.AI_MARKUP_PERCENT_DEFAULT;
}

export const adminAiBalanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  /** Overview: global markup + period stats + wallet totals */
  fastify.get('/ai-balance', async (request, reply) => {
    const q = (request.query || {}) as { from?: string; to?: string };
    const period = parsePeriod(q);
    if (period.error) {
      return reply.code(400).send({ error: period.error });
    }

    const prisma = fastify.prisma;
    const wherePeriod: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: period.from, lte: period.to },
    };

    const [
      globalMarkupPercent,
      usageAgg,
      uncollectedAgg,
      byChannel,
      walletAgg,
      topupAgg,
      topupCount,
      tenantsWithOverride,
    ] = await Promise.all([
      loadGlobalMarkup(prisma),
      prisma.aiUsageLog.aggregate({
        where: wherePeriod,
        _sum: { providerCostRub: true, chargedRub: true },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.aggregate({
        where: wherePeriod,
        _sum: { uncollectedRub: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['channel'],
        where: wherePeriod,
        _sum: { providerCostRub: true, chargedRub: true },
        _count: { _all: true },
        orderBy: { _sum: { chargedRub: 'desc' } },
      }),
      prisma.aiWallet.aggregate({
        _sum: { balanceRub: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: {
          status: 'paid',
          productCode: 'ai_topup',
          paidAt: { gte: period.from, lte: period.to },
        },
        _sum: { amount: true },
      }),
      prisma.payment.count({
        where: {
          status: 'paid',
          productCode: 'ai_topup',
          paidAt: { gte: period.from, lte: period.to },
        },
      }),
      prisma.tenant.count({ where: { aiMarkupPercent: { not: null } } }),
    ]);

    const providerCostRub = dec(usageAgg._sum.providerCostRub);
    const chargedRub = dec(usageAgg._sum.chargedRub);
    const uncollectedRub = dec(uncollectedAgg._sum.uncollectedRub);
    const marginRub = round4(chargedRub - providerCostRub);
    const topupPaidRub = dec(topupAgg._sum.amount);

    return reply.send({
      markup: {
        globalPercent: globalMarkupPercent,
        defaultPercent: PRICING.AI_MARKUP_PERCENT_DEFAULT,
        tenantsWithOverride,
        note:
          'Наценка применяется при списании с AI-кошелька (себестоимость провайдера → chargedRub). Пополнение 1₽ → 1₽ на баланс.',
      },
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      stats: {
        usageEvents: usageAgg._count._all,
        providerCostRub,
        chargedRub,
        marginRub,
        uncollectedRub,
        topupPaidRub,
        topupPayments: topupCount,
        walletsTotalRub: dec(walletAgg._sum.balanceRub),
        walletsCount: walletAgg._count._all,
        byChannel: byChannel.map((row) => ({
          channel: row.channel || 'unknown',
          events: row._count._all,
          providerCostRub: dec(row._sum.providerCostRub),
          chargedRub: dec(row._sum.chargedRub),
          marginRub: round4(dec(row._sum.chargedRub) - dec(row._sum.providerCostRub)),
        })),
      },
    });
  });

  /** Per-tenant markup + wallet + period usage */
  fastify.get('/ai-balance/tenants', async (request, reply) => {
    const q = (request.query || {}) as { search?: string; from?: string; to?: string };
    const period = parsePeriod(q);
    if (period.error) {
      return reply.code(400).send({ error: period.error });
    }
    const search = (q.search || '').trim().toLowerCase();
    const prisma = fastify.prisma;
    const globalMarkupPercent = await loadGlobalMarkup(prisma);

    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        slug: true,
        status: true,
        aiMarkupPercent: true,
        aiWallet: { select: { balanceRub: true } },
        users: {
          where: { role: 'owner' },
          take: 1,
          include: { user: { select: { email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const filtered = search
      ? tenants.filter(
          (t) =>
            t.slug.toLowerCase().includes(search) ||
            (t.users[0]?.user.email || '').toLowerCase().includes(search),
        )
      : tenants;

    const tenantIds = filtered.map((t) => t.id);
    const usageByTenant =
      tenantIds.length === 0
        ? []
        : await prisma.aiUsageLog.groupBy({
            by: ['tenantId'],
            where: {
              tenantId: { in: tenantIds },
              createdAt: { gte: period.from, lte: period.to },
            },
            _sum: { providerCostRub: true, chargedRub: true, uncollectedRub: true },
            _count: { _all: true },
          });

    const usageMap = new Map(
      usageByTenant.map((u) => [
        u.tenantId,
        {
          events: u._count._all,
          providerCostRub: dec(u._sum.providerCostRub),
          chargedRub: dec(u._sum.chargedRub),
          uncollectedRub: dec(u._sum.uncollectedRub),
          marginRub: round4(dec(u._sum.chargedRub) - dec(u._sum.providerCostRub)),
        },
      ]),
    );

    return reply.send({
      globalMarkupPercent,
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      tenants: filtered.map((t) => {
        const override = t.aiMarkupPercent;
        const effective =
          override !== null && override !== undefined ? override : globalMarkupPercent;
        const usage = usageMap.get(t.id) || {
          events: 0,
          providerCostRub: 0,
          chargedRub: 0,
          uncollectedRub: 0,
          marginRub: 0,
        };
        return {
          tenantId: t.id,
          slug: t.slug,
          status: t.status,
          ownerEmail: t.users[0]?.user.email || null,
          balanceRub: t.aiWallet ? Number(t.aiWallet.balanceRub) : 0,
          markupOverridePercent: override,
          effectiveMarkupPercent: effective,
          custom: override !== null && override !== undefined,
          usage,
        };
      }),
    });
  });

  /** Set global markup % */
  fastify.put('/ai-balance/markup', async (request, reply) => {
    const body = z
      .object({
        percent: z.number().int().min(MARKUP_MIN).max(MARKUP_MAX),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: `percent must be an integer ${MARKUP_MIN}…${MARKUP_MAX}`,
      });
    }

    const prisma = fastify.prisma;
    const before = await loadGlobalMarkup(prisma);
    const value = String(body.data.percent);

    await prisma.platformSetting.upsert({
      where: { key: MARKUP_KEY },
      create: {
        key: MARKUP_KEY,
        value,
        description: 'AI token markup percentage (default 50%)',
      },
      update: { value },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actorUserId(request as any),
        action: 'ai_markup_global_update',
        payload: { before, after: body.data.percent },
      },
    });

    return reply.send({
      globalMarkupPercent: body.data.percent,
      before,
    });
  });

  /** Set or clear per-tenant markup override (null = use global) */
  fastify.put('/ai-balance/tenants/:id/markup', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        percent: z.number().int().min(MARKUP_MIN).max(MARKUP_MAX).nullable(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: `percent must be null (сброс) or integer ${MARKUP_MIN}…${MARKUP_MAX}`,
      });
    }

    const prisma = fastify.prisma;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true, aiMarkupPercent: true },
    });
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: { aiMarkupPercent: body.data.percent },
      select: { id: true, slug: true, aiMarkupPercent: true },
    });

    const globalMarkupPercent = await loadGlobalMarkup(prisma);
    const effective =
      updated.aiMarkupPercent !== null && updated.aiMarkupPercent !== undefined
        ? updated.aiMarkupPercent
        : globalMarkupPercent;

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorUserId(request as any),
        action: 'ai_markup_tenant_update',
        payload: {
          before: tenant.aiMarkupPercent,
          after: body.data.percent,
          slug: tenant.slug,
        },
      },
    });

    return reply.send({
      tenantId: updated.id,
      slug: updated.slug,
      markupOverridePercent: updated.aiMarkupPercent,
      effectiveMarkupPercent: effective,
      globalMarkupPercent,
    });
  });
};
