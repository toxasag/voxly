// AI agents CRUD + assignment (ADR-014). Orthogonal to Business / GramJS channels.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@voxly/db';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

function serializeAgent(a: {
  id: string;
  name: string;
  systemPrompt: string | null;
  settings: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { conversations: number; defaultForBots: number };
}) {
  return {
    id: a.id,
    name: a.name,
    systemPrompt: a.systemPrompt,
    settings: a.settings,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    conversationCount: a._count?.conversations ?? undefined,
    botDefaultCount: a._count?.defaultForBots ?? undefined,
  };
}

export const aiAgentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const agents = await fastify.prisma.aiAgent.findMany({
      where: { tenantId, status: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { conversations: true, defaultForBots: true } },
      },
    });
    return reply.send({ agents: agents.map(serializeAgent) });
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = z
      .object({
        name: z.string().min(1).max(120),
        systemPrompt: z.string().max(20000).optional().nullable(),
        settings: z.record(z.unknown()).optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const agent = await fastify.prisma.aiAgent.create({
      data: {
        tenantId,
        name: body.data.name.trim(),
        systemPrompt: body.data.systemPrompt ?? null,
        settings:
          body.data.settings === null
            ? Prisma.JsonNull
            : body.data.settings === undefined
              ? undefined
              : (body.data.settings as Prisma.InputJsonValue),
        status: 'active',
      },
    });
    return reply.code(201).send(serializeAgent(agent));
  });

  fastify.patch('/:agentId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { agentId } = request.params as { agentId: string };
    if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        systemPrompt: z.string().max(20000).optional().nullable(),
        settings: z.record(z.unknown()).optional().nullable(),
        status: z.enum(['active', 'archived']).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const existing = await fastify.prisma.aiAgent.findFirst({
      where: { id: agentId, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });

    const data: Prisma.AiAgentUpdateInput = {};
    if (body.data.name !== undefined) data.name = body.data.name.trim();
    if (body.data.systemPrompt !== undefined) data.systemPrompt = body.data.systemPrompt;
    if (body.data.status !== undefined) data.status = body.data.status;
    if (body.data.settings !== undefined) {
      data.settings =
        body.data.settings === null
          ? Prisma.JsonNull
          : (body.data.settings as Prisma.InputJsonValue);
    }

    const updated = await fastify.prisma.aiAgent.update({
      where: { id: agentId },
      data,
    });
    return reply.send(serializeAgent(updated));
  });

  /** Assign agent as account-level default on a BotInstance (ai_tg / ai_gramjs / …). */
  fastify.patch(
    '/assign/bot/:botId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = z
        .object({ aiAgentId: z.string().nullable() })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId },
      });
      if (!bot) return reply.code(404).send({ error: 'Bot not found' });

      if (body.data.aiAgentId) {
        const agent = await fastify.prisma.aiAgent.findFirst({
          where: { id: body.data.aiAgentId, tenantId, status: 'active' },
        });
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      }

      const updated = await fastify.prisma.botInstance.update({
        where: { id: botId },
        data: { defaultAiAgentId: body.data.aiAgentId },
        select: {
          id: true,
          botUsername: true,
          botType: true,
          defaultAiAgentId: true,
        },
      });
      return reply.send(updated);
    },
  );
};
