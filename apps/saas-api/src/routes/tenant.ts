// Tenant routes: get tenant info, list members, update settings

import type { FastifyPluginAsync } from 'fastify';

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {
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
    const { tenantId, role: userRole } = (request as any).user;
    const { memberId } = request.params as { memberId: string };
    const prisma = fastify.prisma;

    if (userRole !== 'owner' && userRole !== 'superadmin') {
      return reply.code(403).send({ error: 'Only owners can remove members' });
    }

    await prisma.tenantMember.deleteMany({
      where: { id: memberId, tenantId },
    });

    return reply.send({ message: 'Member removed' });
  });

  // --- Update tenant settings ---
  fastify.patch('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, role: userRole } = (request as any).user;
    const prisma = fastify.prisma;

    if (userRole !== 'owner' && userRole !== 'superadmin') {
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
