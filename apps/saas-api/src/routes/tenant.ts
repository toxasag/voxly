// Tenant routes: get tenant info, list members, update settings

import type { FastifyPluginAsync } from 'fastify';
import { decrypt } from '@voxly/crypto';
import { getAiTgExtraSlots, PRICING } from '@voxly/shared';

/**
 * Twenty multiworkspace SSO URL → browser host.
 * Local: `http://{slug}.localhost:3007/verify?...` (RFC 6761).
 * Prod: Twenty returns `{slug}.app.getvoxly.ru` (no DNS under single-label wildcard);
 * rewrite to `{slug}-crm.getvoxly.ru` via tenant.crmSubdomain + VOXLY_DOMAIN.
 */
function toBrowserCrmUrl(ssoUrl: string, crmSubdomain?: string | null): string {
  try {
    const u = new URL(ssoUrl);
    const publicBase = process.env.TWENTY_SERVER_URL?.trim() || 'http://localhost:3007';
    const base = new URL(publicBase);
    const voxlyDomain = process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru';
    const isLocal = /^(localhost|127\.0\.0\.1|.*\.localhost|.*\.lvh\.me)$/i.test(base.hostname);

    if (u.hostname === 'twenty-server' || u.hostname.endsWith('.twenty-server')) {
      const sub = u.hostname.replace(/\.?twenty-server$/, '');
      u.protocol = base.protocol;
      u.hostname = sub && sub !== 'twenty-server' ? `${sub}.${base.hostname}` : base.hostname;
      u.port = base.port;
      return u.toString();
    }

    // Prod CRM host: antontest-crm.getvoxly.ru (not antontest.app.getvoxly.ru)
    if (!isLocal && crmSubdomain) {
      u.protocol = 'https:';
      u.hostname = `${crmSubdomain}.${voxlyDomain}`;
      u.port = '';
      return u.toString();
    }
  } catch {
    /* keep original */
  }
  return ssoUrl;
}

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Create a short-lived SSO link to this tenant's Twenty workspace ---
  fastify.get('/crm-login', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, sub: userId } = (request as any).user;
    const [tenant, user] = await Promise.all([
      fastify.prisma.tenant.findUnique({ where: { id: tenantId } }),
      fastify.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!tenant || !user) {
      return reply.code(404).send({ error: 'Tenant or user not found' });
    }
    if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
      return reply.code(409).send({
        error: 'CRM workspace is still being provisioned',
        status: tenant.status,
      });
    }

    try {
      const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
      const rawUrl = await fastify.twenty.createWorkspaceLoginUrl(
        user.email,
        password,
        tenant.twentyWorkspaceId,
      );
      const url = toBrowserCrmUrl(rawUrl, tenant.crmSubdomain);
      // Token for deal-card chat inject inside Twenty (same claims as portal JWT)
      const member = await fastify.prisma.tenantMember.findFirst({
        where: { tenantId, userId },
      });
      const chatToken = fastify.jwt.sign({
        sub: userId,
        email: user.email,
        role: user.role,
        tenantRole: member?.role || 'member',
        tenantId,
        purpose: 'crm-chat',
      });
      return reply.send({ url, chatToken });
    } catch (error) {
      fastify.log.error({ err: error, tenantId }, 'Failed to create Twenty SSO URL');
      return reply.code(502).send({ error: 'Could not open CRM workspace' });
    }
  });

  // --- Dashboard overview (stats for /dashboard) ---
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const now = new Date();
    const since7 = new Date(now);
    since7.setDate(since7.getDate() - 7);
    const since30 = new Date(now);
    since30.setDate(since30.getDate() - 30);

    const [
      tenant,
      subscriptions,
      addons,
      bots,
      aiWallet,
      tenantBalance,
      giftSubscribers,
      giftByPhase,
      conversationsOpen,
      conversationsTotal,
      messages7d,
      messages30d,
      inbound7d,
      aiSpend30,
      businessOpen,
      businessLimited,
      agentsActive,
      referralCode,
      referralEarnings,
    ] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          slug: true,
          status: true,
          twentyWorkspaceId: true,
        },
      }),
      prisma.subscription.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { endsAt: 'desc' },
      }),
      prisma.addon.findMany({ where: { tenantId } }),
      prisma.botInstance.findMany({
        where: { tenantId },
        select: {
          id: true,
          botType: true,
          botUsername: true,
          displayName: true,
          status: true,
        },
      }),
      prisma.aiWallet.findUnique({ where: { tenantId } }),
      prisma.tenantBalance.findUnique({ where: { tenantId } }),
      prisma.giftSubscriber.count({ where: { tenantId } }),
      prisma.giftSubscriber.groupBy({
        by: ['funnelPhase'],
        where: { tenantId },
        _count: true,
      }),
      prisma.conversation.count({
        where: {
          tenantId,
          status: { in: ['open', 'waiting_for_human'] },
          channel: { not: 'telegram_business_account' },
        },
      }),
      prisma.conversation.count({
        where: {
          tenantId,
          channel: { not: 'telegram_business_account' },
        },
      }),
      prisma.chatMessage.count({
        where: {
          sentAt: { gte: since7 },
          conversation: { tenantId },
        },
      }),
      prisma.chatMessage.count({
        where: {
          sentAt: { gte: since30 },
          conversation: { tenantId },
        },
      }),
      prisma.chatMessage.count({
        where: {
          role: 'user',
          sentAt: { gte: since7 },
          conversation: { tenantId },
        },
      }),
      prisma.aiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: since30 } },
        _sum: { chargedRub: true, providerCostRub: true, tokens: true },
        _count: true,
      }),
      prisma.conversation.count({
        where: {
          tenantId,
          channel: 'telegram_business_account',
          status: { not: 'closed' },
        },
      }),
      prisma.conversation.count({
        where: {
          tenantId,
          channel: 'telegram_business_account',
          status: 'limited',
        },
      }),
      prisma.aiAgent.count({ where: { tenantId, status: 'active' } }),
      prisma.referralCode.findUnique({ where: { tenantId } }),
      prisma.referralEarning.aggregate({
        where: { tenantId },
        _sum: { amountRub: true },
      }),
    ]);

    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const addonActive = (type: string) => {
      const a = addons.find((x) => x.type === type);
      if (!a) {
        return {
          isActive: false,
          isTrial: false,
          trialAvailable: true,
          activeUntil: null as string | null,
        };
      }
      const cfg = (a.config as { trial?: boolean; trialConsumed?: boolean } | null) || {};
      const isActive = a.status === 'active' && a.activeUntil >= now;
      return {
        isActive,
        isTrial: Boolean(cfg.trial) && isActive,
        trialAvailable: !isActive && !cfg.trialConsumed,
        activeUntil: a.activeUntil.toISOString(),
        extraSlots: type === 'ai_tg' ? getAiTgExtraSlots(a.config) : undefined,
      };
    };

    const crmSub = subscriptions.find((s) => s.productCode === 'crm_base') || subscriptions[0] || null;
    const byType = (t: string) => bots.filter((b) => b.botType === t && b.status !== 'deleted');

    const giftPhases = Object.fromEntries(
      giftByPhase.map((r) => [r.funnelPhase, r._count]),
    ) as Record<string, number>;

    const opportunitiesLinked = await prisma.conversation.count({
      where: {
        tenantId,
        twentyOpportunityId: { not: null },
        channel: { not: 'telegram_business_account' },
      },
    });
    const giftOpportunities = await prisma.giftSubscriber.count({
      where: { tenantId, twentyOpportunityId: { not: null } },
    });

    return reply.send({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.slug,
        status: tenant.status,
        crmReady: Boolean(tenant.twentyWorkspaceId),
      },
      subscription: crmSub
        ? {
            productCode: crmSub.productCode,
            status: crmSub.status,
            isTrial: false,
            startsAt: crmSub.startsAt,
            endsAt: crmSub.endsAt,
            seatsIncluded: crmSub.seatsIncluded,
            extraSeats: crmSub.extraSeats,
          }
        : null,
      products: {
        crm: {
          isActive: Boolean(crmSub && crmSub.endsAt >= now),
          activeUntil: crmSub?.endsAt?.toISOString() ?? null,
        },
        gift: addonActive('gift_bot'),
        aiBusiness: {
          ...addonActive('ai_tg'),
          includedSlots: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
          activeAccounts: businessOpen,
          limitedAccounts: businessLimited,
        },
        gramjs: addonActive('ai_gramjs'),
        whatsapp: addonActive('ai_wa'),
        mailingBot: addonActive('mailing_bot'),
        mailingAccounts: addonActive('mailing_accounts'),
        mailingStories: addonActive('mailing_stories'),
      },
      accounts: {
        giftBots: byType('gift').length,
        aiBusinessBots: byType('ai_tg').length,
        gramjs: byType('ai_gramjs').length,
        whatsapp: byType('ai_wa').length,
        agents: agentsActive,
      },
      traffic: {
        messages7d,
        messages30d,
        inbound7d,
        conversationsOpen,
        conversationsTotal,
        giftSubscribers,
        giftPhases,
        opportunitiesApprox: opportunitiesLinked + giftOpportunities,
      },
      money: {
        aiWalletRub: aiWallet ? Number(aiWallet.balanceRub) : 0,
        aiSpent30dRub: Number(aiSpend30._sum.chargedRub || 0),
        aiProviderCost30dRub: Number(aiSpend30._sum.providerCostRub || 0),
        aiTokens30d: Number(aiSpend30._sum.tokens || 0),
        aiRequests30d: aiSpend30._count,
        referralBalanceRub: tenantBalance ? Number(tenantBalance.balanceRub) : 0,
        referralEarnedRub: Number(referralEarnings._sum.amountRub || 0),
        referralCode: referralCode?.code ?? null,
      },
      bots: bots.map((b) => ({
        id: b.id,
        botType: b.botType,
        botUsername: b.botUsername,
        displayName: b.displayName,
        status: b.status,
      })),
    });
  });

  // --- Get tenant info ---
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: { include: { user: true } },
        subscriptions: { where: { status: 'active' }, orderBy: { endsAt: 'desc' } },
        addons: { where: { status: 'active' } },
        botInstances: true,
        analyticsIntegr: true,
        referralCode: true,
      },
    });

    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    return reply.send({
      id: tenant.id,
      slug: tenant.slug,
      portalHost: tenant.portalHost,
      crmSubdomain: tenant.crmSubdomain,
      status: tenant.status,
      createdAt: tenant.createdAt,
      members: tenant.users.map((m) => ({
        id: m.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
        telegramUserId: m.user.telegramUserId?.toString(),
      })),
      activeSubscriptions: tenant.subscriptions.length,
      activeAddons: tenant.addons.map((a) => a.type),
      bots: tenant.botInstances.map((b) => ({
        id: b.id,
        botUsername: b.botUsername,
        botType: b.botType,
        status: b.status,
      })),
      analytics: tenant.analyticsIntegr.map((a) => ({
        platform: a.platform,
        isActive: a.isActive,
      })),
      referralCode: tenant.referralCode?.code,
    });
  });

  // --- List members ---
  fastify.get('/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const members = await prisma.tenantMember.findMany({
      where: { tenantId },
      include: { user: true },
    });

    return reply.send({
      members: members.map((m) => ({
        id: m.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
      })),
    });
  });

  // --- Remove member ---
  fastify.delete('/members/:memberId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, role: userRole, tenantRole } = (request as any).user;
    const { memberId } = request.params as { memberId: string };
    const prisma = fastify.prisma;

    if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
      return reply.code(403).send({ error: 'Only owners can remove members' });
    }

    await prisma.tenantMember.deleteMany({
      where: { id: memberId, tenantId },
    });

    return reply.send({ message: 'Member removed' });
  });

  // --- Update tenant settings ---
  fastify.patch('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, role: userRole, tenantRole } = (request as any).user;
    const prisma = fastify.prisma;

    if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
      return reply.code(403).send({ error: 'Only owners can update settings' });
    }

    const body = request.body as { aiMarkupPercent?: number };
    const updateData: any = {};
    if (body.aiMarkupPercent !== undefined) {
      updateData.aiMarkupPercent = body.aiMarkupPercent;
    }

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
    });

    return reply.send(tenant);
  });
};
