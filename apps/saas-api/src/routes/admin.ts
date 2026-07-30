// Admin routes: superadmin only — tenants list, MRR, custom pricing, suspend, impersonate

import type { FastifyPluginAsync } from 'fastify';
import type { TenantStatus } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { ensureOpportunityRuDefaults } from '../services/twenty-opportunity-ru-defaults.js';
import { collectPlatformHealth } from '../services/admin-health.js';
import {
  purgeTenantFully,
  refreshCrmChatAppForTenant,
} from '../services/purge-tenant.js';
import { syncTwentyCrmLock } from '../services/crm-access.js';
import { z } from 'zod';

/** JWT from auth/login uses `sub` (user id); never `userId`. */
function actorUserId(request: { user?: { sub?: string; userId?: string } }): string {
  const id = request.user?.sub || request.user?.userId;
  if (!id) {
    throw Object.assign(new Error('Missing JWT subject'), { statusCode: 401 });
  }
  return id;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  // --- Live system health (predictive ops) ---
  fastify.get('/health', async (_request, reply) => {
    const report = await collectPlatformHealth(fastify.prisma);
    return reply.send(report);
  });

  // --- Dashboard stats ---
  fastify.get('/stats', async (_request, reply) => {
    const prisma = fastify.prisma;

    const [totalTenants, activeTenants, suspendedTenants, totalPayments, aiUsage] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: 'active' } }),
      prisma.tenant.count({ where: { status: 'suspended' } }),
      prisma.payment.aggregate({
        where: { status: 'paid' },
        _sum: { amount: true },
      }),
      prisma.aiUsageLog.aggregate({
        _sum: { providerCostRub: true, chargedRub: true },
      }),
    ]);

    // MRR by product
    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'active' },
      select: { productCode: true, periodMonths: true },
    });

    const mrrByProduct: Record<string, number> = {};
    for (const sub of activeSubs) {
      const monthlyPrice = getMonthlyPriceForProduct(sub.productCode);
      const monthly = (monthlyPrice * sub.periodMonths) / sub.periodMonths;
      mrrByProduct[sub.productCode] = (mrrByProduct[sub.productCode] || 0) + monthly;
    }

    const aiMarkup = await prisma.platformSetting.findUnique({
      where: { key: 'ai_markup_percent' },
    });

    return reply.send({
      tenants: { total: totalTenants, active: activeTenants, suspended: suspendedTenants },
      totalRevenue: totalPayments._sum.amount?.toString() || '0',
      mrrByProduct,
      ai: {
        totalProviderCost: aiUsage._sum.providerCostRub?.toString() || '0',
        totalCharged: aiUsage._sum.chargedRub?.toString() || '0',
        margin: (Number(aiUsage._sum.chargedRub || 0) - Number(aiUsage._sum.providerCostRub || 0)).toString(),
        currentMarkup: aiMarkup?.value || '50',
      },
    });
  });

  // --- List all tenants ---
  fastify.get('/tenants', async (request, reply) => {
    const prisma = fastify.prisma;
    const query = request.query as { page?: string; limit?: string; status?: string };

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    const where = query.status ? { status: query.status as TenantStatus } : {};

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        include: {
          users: { include: { user: true }, take: 1 },
          subscriptions: { where: { status: 'active' }, take: 1 },
          referralReceived: true,
          aiWallet: { select: { balanceRub: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.count({ where }),
    ]);

    return reply.send({
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        portalHost: t.portalHost,
        crmSubdomain: t.crmSubdomain,
        twentyWorkspaceId: t.twentyWorkspaceId,
        twentyWorkspaceSlug: t.twentyWorkspaceSlug,
        status: t.status,
        createdAt: t.createdAt,
        owner: t.users[0]?.user
          ? { email: t.users[0].user.email, name: `${t.users[0].user.firstName || ''} ${t.users[0].user.lastName || ''}`.trim() }
          : null,
        aiBalanceRub: t.aiWallet ? Number(t.aiWallet.balanceRub) : 0,
        activeSubscription: t.subscriptions[0]
          ? { productCode: t.subscriptions[0].productCode, endsAt: t.subscriptions[0].endsAt }
          : null,
        referrer: t.referralReceived
          ? { referrerTenantId: t.referralReceived.referrerTenantId }
          : null,
      })),
      pagination: { page, limit, total },
    });
  });

  // --- Get single tenant detail ---
  fastify.get('/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: { include: { user: true } },
        subscriptions: { orderBy: { createdAt: 'desc' } },
        addons: { orderBy: { activeUntil: 'desc' } },
        payments: { where: { status: 'paid' }, orderBy: { paidAt: 'desc' }, take: 20 },
        botInstances: true,
        aiWallet: true,
        tenantBalance: true,
        auditLogs: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    return reply.send(tenant);
  });

  // --- Re-apply Voxly CRM defaults (ru-RU, 24h, Сделки) ---
  fastify.post('/tenants/:id/reapply-crm-defaults', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'owner' },
          include: { user: true },
          take: 1,
        },
      },
    });

    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }
    if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
      return reply.code(409).send({ error: 'CRM workspace is not provisioned yet' });
    }

    const owner = tenant.users[0]?.user;
    if (!owner) {
      return reply.code(404).send({ error: 'Tenant owner not found' });
    }

    try {
      const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
      await fastify.twenty.applyWorkspaceDefaultsWithCredentials(
        owner.email,
        password,
        tenant.twentyWorkspaceId,
      );
      await ensureOpportunityRuDefaults(tenant.twentyWorkspaceId);
      try {
        await refreshCrmChatAppForTenant({ tenantId: id, db: fastify.prisma });
      } catch (err) {
        fastify.log.warn({ err, tenantId: id }, 'CRM chat refresh after defaults failed');
      }
      return reply.send({ ok: true, slug: tenant.slug });
    } catch (error) {
      fastify.log.error({ err: error, tenantId: id }, 'Failed to reapply CRM defaults');
      return reply.code(502).send({ error: 'Could not apply CRM defaults' });
    }
  });

  // --- Force-refresh Voxly CRM Chat app (AI buttons, etc.) ---
  fastify.post('/tenants/:id/refresh-crm-chat', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await refreshCrmChatAppForTenant({
        tenantId: id,
        db: fastify.prisma,
      });
      return reply.send(result);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode || 502;
      return reply
        .code(status)
        .send({ error: error instanceof Error ? error.message : 'refresh failed' });
    }
  });

  // --- Irreversible full tenant wipe (portal + CRM + bots + chats) ---
  fastify.delete('/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ confirmSlug: z.string().min(1) })
      .safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Body must include confirmSlug matching the tenant slug' });
    }
    try {
      const result = await purgeTenantFully({
        tenantId: id,
        confirmSlug: body.data.confirmSlug,
        actorUserId: actorUserId(request as any),
        db: fastify.prisma,
      });
      return reply.send(result);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode || 500;
      fastify.log.error({ err: error, tenantId: id }, 'purge tenant failed');
      return reply
        .code(status)
        .send({ error: error instanceof Error ? error.message : 'purge failed' });
    }
  });

  // --- Suspend tenant ---
  fastify.post('/tenants/:id/suspend', async (request, reply) => {
    const { id } = request.params as { id: string };
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { status: 'suspended' },
    });

    await syncTwentyCrmLock(tenant.twentyWorkspaceId, true);

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorUserId(request as any),
        action: 'suspend',
        payload: { tenantId: id },
      },
    });

    return reply.send({ message: 'Tenant suspended', tenant });
  });

  // --- Set custom pricing ---
  fastify.post('/tenants/:id/pricing', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      productCode: string;
      customPriceRub?: number;
      freeUntil?: string;
      aiMarkupPercent?: number;
      note?: string;
    };
    const prisma = fastify.prisma;

    const override = await prisma.pricingOverride.upsert({
      where: {
        tenantId_productCode: { tenantId: id, productCode: body.productCode },
      },
      create: {
        tenantId: id,
        productCode: body.productCode,
        customPriceRub: body.customPriceRub,
        freeUntil: body.freeUntil ? new Date(body.freeUntil) : null,
        aiMarkupPercent: body.aiMarkupPercent,
        note: body.note,
      },
      update: {
        customPriceRub: body.customPriceRub,
        freeUntil: body.freeUntil ? new Date(body.freeUntil) : null,
        aiMarkupPercent: body.aiMarkupPercent,
        note: body.note,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorUserId(request as any),
        action: 'pricing_override',
        payload: { overrideId: override.id, productCode: body.productCode },
      },
    });

    return reply.send(override);
  });

  // --- Manual balance credit ---
  fastify.post('/tenants/:id/credit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { amountRub, note } = request.body as { amountRub: number; note?: string };
    const prisma = fastify.prisma;

    await prisma.tenantBalance.upsert({
      where: { tenantId: id },
      create: { tenantId: id, balanceRub: amountRub },
      update: { balanceRub: { increment: amountRub } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorUserId(request as any),
        action: 'manual_credit',
        payload: { amountRub, note },
      },
    });

    return reply.send({ message: 'Credit added', amountRub });
  });

  // --- Manual AI wallet top-up ---
  fastify.post('/tenants/:id/ai-credit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { amountRub?: number; note?: string };
    const amountRub = Number(body.amountRub);

    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return reply.code(400).send({ error: 'amountRub must be a positive number' });
    }
    if (amountRub > 1_000_000) {
      return reply.code(400).send({ error: 'amountRub too large' });
    }

    const prisma = fastify.prisma;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    const wallet = await prisma.aiWallet.upsert({
      where: { tenantId: id },
      create: { tenantId: id, balanceRub: amountRub },
      update: { balanceRub: { increment: amountRub } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorUserId(request as any),
        action: 'manual_ai_credit',
        payload: { amountRub, note: body.note || null, balanceRub: Number(wallet.balanceRub) },
      },
    });

    return reply.send({
      message: 'AI credit added',
      amountRub,
      balanceRub: Number(wallet.balanceRub),
      slug: tenant.slug,
    });
  });

  // --- Gift funnel effectiveness across all tenants ---
  fastify.get('/funnels', async (_request, reply) => {
    const prisma = fastify.prisma;

    const campaigns = await prisma.giftCampaignConfig.findMany({
      include: {
        tenant: { select: { id: true, slug: true, status: true } },
        botInstance: { select: { id: true, botUsername: true, status: true, botType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const campaignIds = campaigns.map((c) => c.id);
    if (campaignIds.length === 0) {
      return reply.send({ campaigns: [], totals: emptyFunnelTotals() });
    }

    const [startsAgg, subscribedAgg, giftedAgg, phaseAgg, goalAgg] = await Promise.all([
      prisma.giftSubscriber.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      }),
      prisma.giftSubscriber.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds }, subscribed: true },
        _count: { _all: true },
      }),
      prisma.giftSubscriber.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds }, giftDelivered: true },
        _count: { _all: true },
      }),
      prisma.giftSubscriber.groupBy({
        by: ['campaignId', 'funnelPhase'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      }),
      prisma.conversionEvent.groupBy({
        by: ['campaignId', 'goalName'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      }),
    ]);

    const startsMap = toCountMap(startsAgg);
    const subscribedMap = toCountMap(subscribedAgg);
    const giftedMap = toCountMap(giftedAgg);

    const phaseMap = new Map<string, Record<string, number>>();
    for (const row of phaseAgg) {
      const phases = phaseMap.get(row.campaignId) || {};
      phases[row.funnelPhase] = row._count._all;
      phaseMap.set(row.campaignId, phases);
    }

    const goalsMap = new Map<string, Record<string, number>>();
    for (const row of goalAgg) {
      if (!row.campaignId) continue;
      const goals = goalsMap.get(row.campaignId) || {};
      goals[row.goalName] = row._count._all;
      goalsMap.set(row.campaignId, goals);
    }

    const rows = campaigns.map((campaign) => {
      const starts = startsMap.get(campaign.id) || 0;
      const subscribed = subscribedMap.get(campaign.id) || 0;
      const gifted = giftedMap.get(campaign.id) || 0;
      const goals = goalsMap.get(campaign.id) || {};
      const promoClicks = Math.max(
        readPromoClickCount(campaign.promoPost),
        goals.promo_click || 0,
      );
      const subscriptionRequested = goals.subscription_requested || 0;

      return {
        tenantId: campaign.tenant.id,
        tenantSlug: campaign.tenant.slug,
        tenantStatus: campaign.tenant.status,
        botId: campaign.botInstance.id,
        botUsername: campaign.botInstance.botUsername,
        botStatus: campaign.botInstance.status,
        campaignId: campaign.id,
        channelUsername: campaign.channelUsername,
        isActive: campaign.isActive,
        metrics: {
          promoClicks,
          starts,
          subscriptionRequested,
          subscribed,
          gifted,
          phases: phaseMap.get(campaign.id) || {},
          goals,
          rates: {
            promoToStart: pct(starts, promoClicks),
            startToSubscribed: pct(subscribed, starts),
            startToGift: pct(gifted, starts),
            subscribedToGift: pct(gifted, subscribed),
          },
        },
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.promoClicks += row.metrics.promoClicks;
        acc.starts += row.metrics.starts;
        acc.subscriptionRequested += row.metrics.subscriptionRequested;
        acc.subscribed += row.metrics.subscribed;
        acc.gifted += row.metrics.gifted;
        return acc;
      },
      emptyFunnelTotals(),
    );
    totals.rates = {
      promoToStart: pct(totals.starts, totals.promoClicks),
      startToSubscribed: pct(totals.subscribed, totals.starts),
      startToGift: pct(totals.gifted, totals.starts),
      subscribedToGift: pct(totals.gifted, totals.subscribed),
    };

    return reply.send({ campaigns: rows, totals });
  });

  // --- CRM admin: platform pricing + connected workspaces ---
  fastify.get('/crm', async (_request, reply) => {
    const prisma = fastify.prisma;
    const { loadCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
    const { loadTenantsCrmPricingMap } = await import('../services/crm-tenant-pricing.js');
    const pricing = await loadCrmPlatformPricing(prisma);

    const tenants = await prisma.tenant.findMany({
      where: { twentyWorkspaceId: { not: null } },
      include: {
        users: {
          where: { role: 'owner' },
          include: { user: true },
          take: 1,
        },
        subscriptions: {
          where: { status: 'active', productCode: 'crm_base' },
          orderBy: { endsAt: 'desc' },
          take: 1,
        },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const subSeatsMap = new Map(
      tenants.map((t) => [t.id, t.subscriptions[0]?.seatsIncluded ?? pricing.seatsIncluded]),
    );
    const tenantPricingMap = await loadTenantsCrmPricingMap(
      prisma,
      tenants.map((t) => t.id),
      pricing,
      subSeatsMap,
    );

    const voxlyDomain = process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru';
    const now = new Date();

    return reply.send({
      pricing,
      tenants: tenants.map((t) => {
        const sub = t.subscriptions[0];
        const tp = tenantPricingMap.get(t.id)!;
        const crmHost = `${t.crmSubdomain || `${t.slug}-crm`}.${voxlyDomain}`;
        const isTrial =
          sub && sub.periodMonths > 0
            ? false
            : !sub
              ? t.status === 'trial'
              : sub.periodMonths === 0;
        const isPaid =
          t.status !== 'suspended' &&
          t.status !== 'cancelled' &&
          Boolean(sub && sub.periodMonths > 0 && sub.endsAt >= now);

        return {
          id: t.id,
          slug: t.slug,
          status: t.status,
          portalHost: t.portalHost,
          crmSubdomain: t.crmSubdomain,
          crmHost,
          crmUrl: `https://${crmHost}`,
          twentyWorkspaceId: t.twentyWorkspaceId,
          twentyWorkspaceSlug: t.twentyWorkspaceSlug,
          seatsUsed: t._count.users,
          seatsIncluded: tp.seatsIncluded + (sub?.extraSeats ?? 0),
          pricing: {
            baseMonthly: tp.baseMonthly,
            extraSeatMonthly: tp.extraSeatMonthly,
            seatsIncluded: tp.seatsIncluded,
            customBase: tp.customBase,
            customExtraSeat: tp.customExtraSeat,
            customSeatsIncluded: tp.customSeatsIncluded,
          },
          isTrial,
          isPaid,
          subscription: sub
            ? {
                productCode: sub.productCode,
                endsAt: sub.endsAt.toISOString(),
                periodMonths: sub.periodMonths,
                seatsIncluded: sub.seatsIncluded,
                extraSeats: sub.extraSeats,
              }
            : null,
          owner: t.users[0]?.user
            ? {
                email: t.users[0].user.email,
                name: `${t.users[0].user.firstName || ''} ${t.users[0].user.lastName || ''}`.trim(),
              }
            : null,
          createdAt: t.createdAt.toISOString(),
        };
      }),
    });
  });

  fastify.get('/crm/report', async (request, reply) => {
    const q = request.query as { from?: string; to?: string };
    const { buildCrmAdminReport } = await import('../services/crm-admin-report.js');
    try {
      const report = await buildCrmAdminReport(fastify.prisma, q);
      return reply.send(report);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Report failed',
      });
    }
  });

  fastify.get('/crm/resources', async (_request, reply) => {
    const { collectTenantResourceUsage } = await import('../services/tenant-resource-usage.js');
    try {
      const resources = await collectTenantResourceUsage(fastify.prisma);
      return reply.send(resources);
    } catch (err) {
      fastify.log.error({ err }, 'crm resources collection failed');
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Resource collection failed',
      });
    }
  });

  fastify.put('/crm/tenants/:id/pricing', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        baseMonthly: z.number().min(0).max(1_000_000).nullable().optional(),
        extraSeatMonthly: z.number().min(0).max(1_000_000).nullable().optional(),
        seatsIncluded: z.number().int().min(1).max(500).nullable().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid pricing payload' });
    }

    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const { loadCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
    const { saveTenantCrmPricing } = await import('../services/crm-tenant-pricing.js');
    const platform = await loadCrmPlatformPricing(fastify.prisma);

    try {
      const pricing = await saveTenantCrmPricing(fastify.prisma, id, body.data, platform);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: id,
          actorUserId: actorUserId(request as any),
          action: 'crm_tenant_pricing_update',
          payload: { ...body.data, slug: tenant.slug },
        },
      });
      return reply.send({ pricing });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed to save tenant pricing',
      });
    }
  });

  fastify.put('/crm/pricing', async (request, reply) => {
    const body = z
      .object({
        baseMonthly: z.number().min(0).max(1_000_000),
        extraSeatMonthly: z.number().min(0).max(1_000_000),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'baseMonthly and extraSeatMonthly required (≥ 0)' });
    }
    const { saveCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
    try {
      const pricing = await saveCrmPlatformPricing(fastify.prisma, body.data);
      await fastify.prisma.auditLog.create({
        data: {
          actorUserId: actorUserId(request as any),
          action: 'crm_platform_pricing_update',
          payload: body.data,
        },
      });
      return reply.send({ pricing });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed to save pricing',
      });
    }
  });

  /** Impersonate tenant owner in portal (JWT for /dashboard). */
  fastify.post('/tenants/:id/impersonate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actorId = actorUserId(request as any);
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'owner' },
          include: { user: true },
          take: 1,
        },
      },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    const owner = tenant.users[0]?.user;
    if (!owner) return reply.code(404).send({ error: 'Owner not found' });

    const token = fastify.jwt.sign({
      sub: owner.id,
      email: owner.email,
      role: owner.role,
      tenantRole: 'owner',
      tenantId: tenant.id,
      impersonatedBy: actorId,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: actorId,
        action: 'impersonate',
        payload: { ownerUserId: owner.id, ownerEmail: owner.email },
      },
    });

    return reply.send({
      token,
      redirectUrl: '/dashboard/crm',
      owner: { email: owner.email, name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim() },
      tenant: { id: tenant.id, slug: tenant.slug },
    });
  });

  /** Open tenant CRM as workspace owner (SSO URL). */
  fastify.post('/tenants/:id/crm-login', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actorId = actorUserId(request as any);
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'owner' },
          include: { user: true },
          take: 1,
        },
      },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
      return reply.code(409).send({ error: 'CRM workspace is not ready' });
    }
    const owner = tenant.users[0]?.user;
    if (!owner) return reply.code(404).send({ error: 'Owner not found' });

    try {
      const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
      const url = await fastify.twenty.createWorkspaceLoginUrl(
        owner.email,
        password,
        tenant.twentyWorkspaceId,
      );
      await prisma.auditLog.create({
        data: {
          tenantId: id,
          actorUserId: actorId,
          action: 'admin_crm_login',
          payload: { ownerEmail: owner.email },
        },
      });
      return reply.send({ url, crmUrl: url, ownerEmail: owner.email });
    } catch (err) {
      fastify.log.error({ err, tenantId: id }, 'admin CRM login failed');
      return reply.code(502).send({ error: 'Не удалось открыть CRM клиента' });
    }
  });

  // --- Update platform settings ---
  fastify.patch('/settings', async (request, reply) => {
    const body = request.body as { key: string; value: string };
    const prisma = fastify.prisma;

    const setting = await prisma.platformSetting.upsert({
      where: { key: body.key },
      create: { key: body.key, value: body.value },
      update: { value: body.value },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actorUserId(request as any),
        action: 'platform_setting_update',
        payload: { key: body.key, value: body.value },
      },
    });

    return reply.send(setting);
  });
};

function getMonthlyPriceForProduct(productCode: string): number {
  const prices: Record<string, number> = {
    crm_base: 500,
    extra_seat: 300,
    gift_bot: 500,
    ai_tg: 1000,
    ai_wa: 500,
    analytics_metrika: 500,
    analytics_ga4: 500,
    analytics_facebook: 500,
    analytics_vk: 500,
  };
  return prices[productCode] || 0;
}

function emptyFunnelTotals() {
  return {
    promoClicks: 0,
    starts: 0,
    subscriptionRequested: 0,
    subscribed: 0,
    gifted: 0,
    rates: {
      promoToStart: null as number | null,
      startToSubscribed: null as number | null,
      startToGift: null as number | null,
      subscribedToGift: null as number | null,
    },
  };
}

function toCountMap(rows: { campaignId: string; _count: { _all: number } }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.campaignId, row._count._all);
  }
  return map;
}

function readPromoClickCount(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const count = (raw as { clickCount?: unknown }).clickCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

/** Percent with one decimal; null when denominator is 0 */
function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
