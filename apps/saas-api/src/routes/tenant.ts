// Tenant routes: get tenant info, list members, update settings

import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { evaluateCrmAccess, getAiTgExtraSlots, PRICING, PRODUCT_CODES } from '@voxly/shared';
import { decrypt, encrypt } from '@voxly/crypto';
import { resolveTwentyPasswordForMember, provisionTwentyMemberForTenant } from '../services/twenty-member-provision.js';
import { assertCrmAccessAllowed, loadCrmAccessForTenant } from '../services/crm-access.js';
import { z } from 'zod';

function crmIsTrial(tenantStatus: string, crmSub: { periodMonths: number } | null): boolean {
  // Paid CRM sub (periodMonths > 0) is never trial — ignore stale tenant.status.
  if (crmSub && crmSub.periodMonths > 0) return false;
  if (!crmSub) return tenantStatus === 'trial';
  return crmSub.periodMonths === 0;
}


function buildCrmPublicUrl(crmSubdomain: string | null | undefined, slug: string): string {
  const voxlyDomain = process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru';
  const host = crmSubdomain ? `${crmSubdomain}.${voxlyDomain}` : `${slug}-crm.${voxlyDomain}`;
  return `https://${host}`;
}

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
    const [tenant, user, denied] = await Promise.all([
      fastify.prisma.tenant.findUnique({ where: { id: tenantId } }),
      fastify.prisma.user.findUnique({ where: { id: userId } }),
      assertCrmAccessAllowed(fastify.prisma, tenantId),
    ]);

    if (!tenant || !user) {
      return reply.code(404).send({ error: 'Tenant or user not found' });
    }
    if (denied) {
      return reply.code(denied.code || 403).send({
        error: denied.error,
        reason: denied.reason,
        crmAccessLocked: true,
      });
    }
    if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
      return reply.code(409).send({
        error: 'CRM workspace is still being provisioned',
        status: tenant.status,
      });
    }

    try {
      const member = await fastify.prisma.tenantMember.findFirst({
        where: { tenantId, userId },
      });
      const password = resolveTwentyPasswordForMember(tenant, member);
      if (!password) {
        return reply.code(409).send({
          error: 'CRM access is not provisioned for this user yet',
        });
      }
      const rawUrl = await fastify.twenty.createWorkspaceLoginUrl(
        user.email,
        password,
        tenant.twentyWorkspaceId,
      );
      const url = toBrowserCrmUrl(rawUrl, tenant.crmSubdomain);
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

    const crmSub =
      subscriptions.find((s) => s.productCode === PRODUCT_CODES.CRM_BASE) ||
      subscriptions[0] ||
      null;
    const crmAccess = evaluateCrmAccess({
      tenantStatus: tenant.status,
      crmSubscription: crmSub,
      now,
    });
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
        crmAccessLocked: crmAccess.locked,
        crmAccessReason: crmAccess.reason,
        crmAccessError: crmAccess.error,
      },
      subscription: crmSub
        ? {
            productCode: crmSub.productCode,
            status: crmSub.status,
            isTrial: crmIsTrial(tenant.status, crmSub),
            periodMonths: crmSub.periodMonths,
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

  // --- CRM portal settings (single payload for /dashboard/crm) ---
  fastify.get('/crm', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, tenantRole } = (request as any).user;
    const prisma = fastify.prisma;
    const now = new Date();

    const [tenant, members, crmSubRow, access, crmPricing] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          slug: true,
          status: true,
          crmSubdomain: true,
          twentyWorkspaceId: true,
        },
      }),
      prisma.tenantMember.findMany({
        where: { tenantId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.subscription.findFirst({
        where: { tenantId, status: 'active', productCode: PRODUCT_CODES.CRM_BASE },
        orderBy: { endsAt: 'desc' },
      }),
      loadCrmAccessForTenant(prisma, tenantId, now),
      import('../services/crm-pricing-settings.js').then(async (m) => {
        const platform = await m.loadCrmPlatformPricing(prisma);
        const { loadTenantCrmPricing } = await import('../services/crm-tenant-pricing.js');
        return loadTenantCrmPricing(prisma, tenantId, platform, null);
      }),
    ]);

    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const crmSub = crmSubRow;
    const seatsIncluded = crmSub?.seatsIncluded ?? crmPricing.seatsIncluded;
    const extraSeats = crmSub?.extraSeats ?? 0;
    const seatLimit = seatsIncluded + extraSeats;
    const used = members.length;
    const crmUrl = buildCrmPublicUrl(tenant.crmSubdomain, tenant.slug);
    const crmAccess = access.evaluation;
    const isActive = Boolean(crmSub && crmSub.endsAt >= now);
    const isTrial = crmIsTrial(tenant.status, crmSub);

    const { fetchTwentyMemberDisplayNames } = await import(
      '../services/twenty-member-display-names.js'
    );
    const crmNames = await fetchTwentyMemberDisplayNames(tenant.twentyWorkspaceId);

    return reply.send({
      tenantRole: tenantRole || 'member',
      tenant: {
        slug: tenant.slug,
        status: tenant.status,
        crmReady: Boolean(tenant.twentyWorkspaceId),
        crmSubdomain: tenant.crmSubdomain,
        crmUrl,
        crmHost: new URL(crmUrl).host,
      },
      crmAccessLocked: crmAccess.locked,
      crmAccessReason: crmAccess.reason,
      crmAccessError: crmAccess.error,
      crmInGrace: crmAccess.inGrace,
      crmGraceEndsAt: crmAccess.graceEndsAt,
      subscription: crmSub
        ? {
            isTrial,
            isActive,
            periodMonths: crmSub.periodMonths,
            startsAt: crmSub.startsAt.toISOString(),
            endsAt: crmSub.endsAt.toISOString(),
            seatsIncluded,
            extraSeats,
          }
        : {
            isTrial: tenant.status === 'trial',
            isActive: false,
            periodMonths: 0,
            startsAt: null,
            endsAt: null,
            seatsIncluded: crmPricing.seatsIncluded,
            extraSeats: 0,
          },
      seats: {
        limit: seatLimit,
        used,
        remaining: Math.max(0, seatLimit - used),
      },
      pricing: {
        baseMonthly: crmPricing.baseMonthly,
        extraSeatMonthly: crmPricing.extraSeatMonthly,
        seatsIncluded: crmPricing.seatsIncluded,
      },
      members: members.map((m) => {
        const email = m.user.email.trim().toLowerCase();
        const crm = crmNames.get(email);
        const firstName = m.user.firstName?.trim() || crm?.firstName || null;
        const lastName = m.user.lastName?.trim() || crm?.lastName || null;
        return {
          id: m.id,
          email: m.user.email,
          firstName,
          lastName,
          role: m.role,
          hasCrmAccess: Boolean(
            m.role === 'owner'
              ? tenant.twentyWorkspaceId
              : (m as { twentyPasswordEncrypted?: string | null }).twentyPasswordEncrypted,
          ),
        };
      }),
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

  // --- Remove member (Voxly seat + Twenty CRM; deals/tasks → owner) ---
  fastify.delete('/members/:memberId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, sub: ownerUserId, email: ownerEmail, role: userRole, tenantRole } =
      (request as any).user;
    const { memberId } = request.params as { memberId: string };
    const prisma = fastify.prisma;

    if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
      return reply.code(403).send({ error: 'Only owners can remove members' });
    }

    const member = await prisma.tenantMember.findFirst({
      where: { id: memberId, tenantId },
      include: { user: true, tenant: true },
    });
    if (!member) {
      return reply.code(404).send({ error: 'Member not found' });
    }
    if (member.role === 'owner') {
      return reply.code(403).send({ error: 'Cannot remove workspace owner' });
    }
    if (member.userId === ownerUserId) {
      return reply.code(403).send({ error: 'Cannot remove yourself' });
    }

    const resolvedOwnerEmail =
      typeof ownerEmail === 'string' && ownerEmail
        ? ownerEmail
        : (
            await prisma.user.findUnique({
              where: { id: ownerUserId },
              select: { email: true },
            })
          )?.email;

    if (!resolvedOwnerEmail) {
      return reply.code(500).send({ error: 'Owner email not found' });
    }

    const { removeTwentyMemberFromTenant } = await import('../services/twenty-member-remove.js');
    const crmResult = await removeTwentyMemberFromTenant({
      tenant: member.tenant,
      ownerEmail: resolvedOwnerEmail,
      memberEmail: member.user.email,
      log: fastify.log,
    });
    if (!crmResult.ok) {
      return reply.code(502).send({
        error: crmResult.error || 'Failed to remove member from CRM',
      });
    }

    await prisma.tenantMember.delete({ where: { id: memberId } });

    return reply.send({
      message: 'Member removed',
      removedFromCrm: crmResult.removedFromCrm,
    });
  });

  // --- Reveal stored member CRM credentials (no password change) ---
  fastify.get(
    '/members/:memberId/credentials',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId, role: userRole, tenantRole } = (request as any).user;
      const { memberId } = request.params as { memberId: string };
      const prisma = fastify.prisma;

      if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
        return reply.code(403).send({ error: 'Only owners can view member credentials' });
      }

      const member = await prisma.tenantMember.findFirst({
        where: { id: memberId, tenantId },
        include: { user: true, tenant: true },
      });
      if (!member) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      if (member.role === 'owner') {
        return reply.code(403).send({ error: 'Owner credentials are not managed here' });
      }

      const crmUrl = buildCrmPublicUrl(member.tenant.crmSubdomain, member.tenant.slug);
      const email = member.user.email.trim().toLowerCase();
      let password: string | null = null;
      if (member.twentyPasswordEncrypted) {
        try {
          password = decrypt(member.twentyPasswordEncrypted);
        } catch {
          password = null;
        }
      }

      return reply.send({
        email,
        password,
        crmUrl,
        twentyProvisioned: Boolean(member.twentyPasswordEncrypted),
        ...(password
          ? {}
          : {
              warning:
                'Пароль не сохранён в кабинете. Задайте новый пароль кнопкой «Сменить пароль».',
            }),
      });
    },
  );

  // --- Set / reissue member credentials (explicit password change + CRM sync) ---
  const setCredentialsSchema = z.object({
    password: z.string().min(8).max(128).optional(),
  });

  fastify.post(
    '/members/:memberId/reissue-credentials',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId, sub: ownerUserId, email: ownerEmail, role: userRole, tenantRole } =
        (request as any).user;
      const { memberId } = request.params as { memberId: string };
      const prisma = fastify.prisma;

      if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
        return reply.code(403).send({ error: 'Only owners can reissue credentials' });
      }

      const parsedBody = setCredentialsSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.code(400).send({ error: 'Пароль: минимум 8 символов' });
      }

      const member = await prisma.tenantMember.findFirst({
        where: { id: memberId, tenantId },
        include: { user: true, tenant: true },
      });

      if (!member) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      if (member.role === 'owner') {
        return reply.code(403).send({ error: 'Cannot reissue owner credentials' });
      }

      const tenant = member.tenant;
      const email = member.user.email.trim().toLowerCase();
      const tempPassword = parsedBody.data.password?.trim() || nanoid(16);
      const crmUrl = buildCrmPublicUrl(tenant.crmSubdomain, tenant.slug);

      const resolvedOwnerEmail =
        typeof ownerEmail === 'string' && ownerEmail
          ? ownerEmail
          : (
              await prisma.user.findUnique({
                where: { id: ownerUserId },
                select: { email: true },
              })
            )?.email;

      if (!resolvedOwnerEmail) {
        return reply.code(500).send({ error: 'Owner email not found' });
      }

      await prisma.user.update({
        where: { id: member.userId },
        data: { passwordHash: await bcrypt.hash(tempPassword, 12) },
      });

      let twentyProvisioned = false;
      let warning: string | undefined;

      if (member.twentyPasswordEncrypted) {
        const { updateTwentyUserPassword } = await import('../services/twenty-user-password.js');
        const updated = await updateTwentyUserPassword(email, tempPassword);
        if (updated) {
          await prisma.tenantMember.update({
            where: { id: memberId },
            data: { twentyPasswordEncrypted: encrypt(tempPassword) },
          });
          twentyProvisioned = true;
        } else {
          warning = 'Пароль кабинета обновлён. Не удалось обновить пароль в CRM — попробуйте ещё раз.';
        }
      } else {
        const provisioned = await provisionTwentyMemberForTenant({
          tenant,
          ownerEmail: resolvedOwnerEmail,
          memberEmail: email,
          memberPassword: tempPassword,
          log: fastify.log,
        });
        if (provisioned.ok && provisioned.twentyPasswordEncrypted) {
          await prisma.tenantMember.update({
            where: { id: memberId },
            data: { twentyPasswordEncrypted: provisioned.twentyPasswordEncrypted },
          });
          twentyProvisioned = true;
        } else {
          warning =
            provisioned.error ||
            'Пароль кабинета обновлён. Пользователь в CRM не создан — попробуйте ещё раз.';
        }
      }

      return reply.send({
        email,
        tempPassword,
        crmUrl,
        twentyProvisioned,
        ...(warning ? { warning } : {}),
      });
    },
  );

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
