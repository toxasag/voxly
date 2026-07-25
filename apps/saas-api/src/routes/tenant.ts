// Tenant routes: get tenant info, list members, update settings

import type { FastifyPluginAsync } from 'fastify';
import { decrypt } from '@voxly/crypto';

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
