// Admin routes: superadmin only — tenants list, MRR, custom pricing, suspend, impersonate

import type { FastifyPluginAsync } from 'fastify';
import type { TenantStatus } from '@voxly/db';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

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
        status: t.status,
        createdAt: t.createdAt,
        owner: t.users[0]?.user
          ? { email: t.users[0].user.email, name: `${t.users[0].user.firstName || ''} ${t.users[0].user.lastName || ''}`.trim() }
          : null,
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

  // --- Suspend tenant ---
  fastify.post('/tenants/:id/suspend', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = (request as any).user;
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { status: 'suspended' },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: id,
        actorUserId: userId,
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
        actorUserId: (request as any).user.userId,
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
        actorUserId: (request as any).user.userId,
        action: 'manual_credit',
        payload: { amountRub, note },
      },
    });

    return reply.send({ message: 'Credit added', amountRub });
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
        actorUserId: (request as any).user.userId,
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
    ai_wa: 1000,
    analytics_metrika: 500,
    analytics_ga4: 500,
    analytics_facebook: 500,
    analytics_vk: 500,
  };
  return prices[productCode] || 0;
}
