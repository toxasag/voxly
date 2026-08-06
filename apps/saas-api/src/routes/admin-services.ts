/**
 * Superadmin ops: cross-tenant view of addons/bots + expire/extend + deep-link hints.
 * Phase 2 compressed panel (not full client CRUD).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

function actorUserId(request: { user?: { sub?: string; userId?: string } }): string {
  return request.user?.sub || request.user?.userId || 'unknown';
}

export const adminServicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  fastify.get('/services/tenants', async (request, reply) => {
    const q = (request.query || {}) as { search?: string };
    const search = (q.search || '').trim().toLowerCase();

    const tenants = await fastify.prisma.tenant.findMany({
      where: search
        ? {
            OR: [
              { slug: { contains: search, mode: 'insensitive' } },
              {
                users: {
                  some: { user: { email: { contains: search, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : undefined,
      select: {
        id: true,
        slug: true,
        status: true,
        createdAt: true,
        users: {
          where: { role: 'owner' },
          take: 1,
          include: { user: { select: { email: true } } },
        },
        addons: {
          select: {
            id: true,
            type: true,
            status: true,
            activeUntil: true,
          },
        },
        botInstances: {
          select: {
            id: true,
            botType: true,
            status: true,
            botUsername: true,
            displayName: true,
          },
        },
        aiWallet: { select: { balanceRub: true } },
        _count: {
          select: {
            botInstances: true,
            aiAgents: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return reply.send({
      tenants: tenants.map((t) => {
        const botsByType: Record<string, number> = {};
        for (const b of t.botInstances) {
          botsByType[b.botType] = (botsByType[b.botType] || 0) + 1;
        }
        return {
          id: t.id,
          slug: t.slug,
          status: t.status,
          ownerEmail: t.users[0]?.user.email || null,
          createdAt: t.createdAt.toISOString(),
          aiWalletRub: t.aiWallet ? Number(t.aiWallet.balanceRub) : 0,
          agentCount: t._count.aiAgents,
          botsByType,
          bots: t.botInstances.map((b) => ({
            id: b.id,
            botType: b.botType,
            status: b.status,
            label: b.displayName || b.botUsername || b.id.slice(-8),
          })),
          addons: t.addons.map((a) => ({
            id: a.id,
            type: a.type,
            status: a.status,
            activeUntil: a.activeUntil.toISOString(),
            expired: a.activeUntil.getTime() < Date.now() || a.status !== 'active',
          })),
          deepLinks: {
            crm: '/dashboard/crm',
            ai: '/dashboard/ai',
            agents: '/dashboard/ai/agents',
            whatsapp: '/dashboard/ai/whatsapp',
            gramjs: '/dashboard/ai/gramjs',
            bots: '/dashboard/bots',
            mailing: '/dashboard/mailing',
          },
        };
      }),
    });
  });

  /** Force-expire or extend an addon (ops). */
  fastify.patch('/services/addons/:addonId', async (request, reply) => {
    const { addonId } = request.params as { addonId: string };
    const body = z
      .object({
        action: z.enum(['expire', 'extend_days', 'activate']),
        days: z.number().int().min(1).max(730).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'action=expire|extend_days|activate required' });
    }

    const addon = await fastify.prisma.addon.findUnique({ where: { id: addonId } });
    if (!addon) return reply.code(404).send({ error: 'Addon not found' });

    let activeUntil = addon.activeUntil;
    let status = addon.status;

    if (body.data.action === 'expire') {
      activeUntil = new Date();
      status = 'expired';
    } else if (body.data.action === 'extend_days') {
      const days = body.data.days ?? 30;
      const base =
        addon.activeUntil.getTime() > Date.now() ? addon.activeUntil : new Date();
      activeUntil = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
      status = 'active';
    } else {
      status = 'active';
      if (addon.activeUntil.getTime() < Date.now()) {
        activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    }

    const updated = await fastify.prisma.addon.update({
      where: { id: addonId },
      data: { activeUntil, status },
    });

    await fastify.prisma.auditLog.create({
      data: {
        tenantId: addon.tenantId,
        actorUserId: actorUserId(request as any),
        action: 'admin_addon_update',
        payload: {
          addonId,
          type: addon.type,
          action: body.data.action,
          days: body.data.days,
          activeUntil: updated.activeUntil.toISOString(),
          status: updated.status,
        },
      },
    });

    return reply.send({
      id: updated.id,
      type: updated.type,
      status: updated.status,
      activeUntil: updated.activeUntil.toISOString(),
    });
  });

  /** Soft-suspend a bot instance (status=suspended). */
  fastify.patch('/services/bots/:botId', async (request, reply) => {
    const { botId } = request.params as { botId: string };
    const body = z
      .object({ action: z.enum(['suspend', 'activate']) })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'action=suspend|activate required' });
    }

    const bot = await fastify.prisma.botInstance.findUnique({ where: { id: botId } });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });

    const status = body.data.action === 'suspend' ? 'suspended' : 'active';
    const updated = await fastify.prisma.botInstance.update({
      where: { id: botId },
      data: { status },
    });

    await fastify.prisma.auditLog.create({
      data: {
        tenantId: bot.tenantId,
        actorUserId: actorUserId(request as any),
        action: 'admin_bot_status',
        payload: { botId, botType: bot.botType, status },
      },
    });

    return reply.send({
      id: updated.id,
      botType: updated.botType,
      status: updated.status,
    });
  });
};
