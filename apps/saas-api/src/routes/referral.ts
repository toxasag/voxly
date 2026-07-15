// Referral routes: get code, stats, earnings

import type { FastifyPluginAsync } from 'fastify';

export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Get referral info for current tenant ---
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const voxlyDomain = fastify.voxlyDomain;

    const referralCode = await prisma.referralCode.findUnique({
      where: { tenantId },
    });

    if (!referralCode) {
      return reply.code(404).send({ error: 'No referral code found' });
    }

    const referrals = await prisma.referral.findMany({
      where: { referrerTenantId: tenantId },
      include: {
        referredTenant: { select: { slug: true, status: true, createdAt: true } },
        earnings: true,
      },
    });

    const totalEarnings = await prisma.referralEarning.aggregate({
      where: { tenantId },
      _sum: { amountRub: true },
    });

    const tenantBalance = await prisma.tenantBalance.findUnique({
      where: { tenantId },
    });

    return reply.send({
      code: referralCode.code,
      link: `https://${voxlyDomain}/r/${referralCode.code}`,
      isActive: referralCode.isActive,
      clicksCount: referralCode.clicksCount,
      referrals: referrals.map((r) => ({
        id: r.id,
        referredSlug: r.referredTenant.slug,
        status: r.referredTenant.status,
        attributedAt: r.attributedAt,
        firstPaymentAt: r.firstPaymentAt,
        earnings: r.earnings.map((e) => ({
          amountRub: e.amountRub.toString(),
          ruleApplied: e.ruleApplied,
          creditedAt: e.creditedAt,
        })),
      })),
      totalEarnings: totalEarnings._sum.amountRub?.toString() || '0',
      balance: tenantBalance?.balanceRub.toString() || '0',
    });
  });

  // --- Admin: list referral rules ---
  fastify.get('/rules', { preHandler: [fastify.requireSuperadmin] }, async (_request, reply) => {
    const prisma = fastify.prisma;

    const rules = await prisma.referralRule.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({ rules });
  });

  // --- Admin: create/update referral rule ---
  fastify.post('/rules', { preHandler: [fastify.requireSuperadmin] }, async (request, reply) => {
    const body = request.body as {
      type: 'fixed_first_payment' | 'percent_first_payment' | 'percent_recurring' | 'credit_discount';
      value: number;
      durationMonths?: number;
      productScope?: string;
      isDefault?: boolean;
    };
    const prisma = fastify.prisma;

    if (body.isDefault) {
      // Unset previous default
      await prisma.referralRule.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const rule = await prisma.referralRule.create({
      data: {
        type: body.type,
        value: body.value,
        durationMonths: body.durationMonths,
        productScope: body.productScope || 'all',
        isDefault: body.isDefault || false,
      },
    });

    return reply.code(201).send(rule);
  });

  // --- Track referral click (public, no auth) ---
  fastify.get('/click/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const prisma = fastify.prisma;
    const voxlyDomain = fastify.voxlyDomain;

    const referralCode = await prisma.referralCode.findUnique({
      where: { code },
    });

    if (referralCode && referralCode.isActive) {
      await prisma.referralCode.update({
        where: { id: referralCode.id },
        data: { clicksCount: { increment: 1 } },
      });
    }

    // Redirect to landing with ref param
    return reply.redirect(302, `https://${voxlyDomain}/?ref=${code}`);
  });
};
