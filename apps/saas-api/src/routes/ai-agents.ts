// AI agents CRUD + assignment (ADR-014). Orthogonal to Business / GramJS channels.
// Knowledge files + won-deal sales examples (ADR-016).

import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { Prisma } from '@voxly/db';
import { parseAgentLearnSettings } from '@voxly/ai-core';
import {
  AI_MODEL_DEFAULTS,
  PRODUCT_CODES,
  PRICING,
  aiUsageChannelLabel,
  getAiAgentSlots,
} from '@voxly/shared';
import {
  deleteKnowledgeFile,
  saveKnowledgeUpload,
} from '../services/ai-knowledge.js';
import { ingestWonDealsForAgent } from '../services/ai-sales-learn.js';

function platformDefaultChatModel(): string {
  return (
    process.env.AI_CHAT_MODEL?.trim() ||
    process.env.AI_DEFAULT_MODEL?.trim() ||
    AI_MODEL_DEFAULTS.chat
  );
}

function agentModelFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null;
  const m = (settings as Record<string, unknown>).model;
  return typeof m === 'string' && m.trim() ? m.trim() : null;
}

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

/**
 * Paid agent seats live on the `ai_agent` addon. Tenants who already had agents before
 * the SKU shipped are grandfathered: slots are raised to at least the current active count.
 */
/** Read-only capacity. Grandfathering of existing agents is a one-shot migration — never
 * create or expand a paid `ai_agent` addon from a GET/list request. */
async function resolveAgentCapacity(
  prisma: any,
  tenantId: string,
): Promise<{ agentSlots: number; activeAgents: number; freeSlots: number; priceMonthly: number }> {
  const activeAgents = await prisma.aiAgent.count({
    where: { tenantId, status: { not: 'archived' } },
  });
  const addon = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_AGENT } },
  });
  const agentSlots = getAiAgentSlots(addon?.config);
  return {
    agentSlots,
    activeAgents,
    freeSlots: Math.max(0, agentSlots - activeAgents),
    priceMonthly: PRICING.AI_AGENT_MONTHLY,
  };
}

function serializeAgent(a: {
  id: string;
  name: string;
  systemPrompt: string | null;
  settings: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    conversations: number;
    defaultForBots: number;
    knowledgeFiles?: number;
    salesExamples?: number;
  };
}) {
  const learn = parseAgentLearnSettings(a.settings);
  const model = agentModelFromSettings(a.settings);
  const defaultModel = platformDefaultChatModel();
  return {
    id: a.id,
    name: a.name,
    systemPrompt: a.systemPrompt,
    settings: a.settings,
    model,
    effectiveModel: model || defaultModel,
    defaultModel,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    conversationCount: a._count?.conversations ?? undefined,
    botDefaultCount: a._count?.defaultForBots ?? undefined,
    knowledgeFileCount: a._count?.knowledgeFiles ?? undefined,
    salesExampleCount: a._count?.salesExamples ?? undefined,
    learnFromWonDeals: learn.learnFromWonDeals,
    wonStages: learn.wonStages,
  };
}

async function requireAgent(
  fastify: { prisma: any },
  tenantId: string,
  agentId: string,
) {
  return fastify.prisma.aiAgent.findFirst({
    where: { id: agentId, tenantId, status: { not: 'archived' } },
  });
}

export const aiAgentRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const [agents, capacity] = await Promise.all([
      fastify.prisma.aiAgent.findMany({
        where: { tenantId, status: { not: 'archived' } },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              conversations: true,
              defaultForBots: true,
              knowledgeFiles: true,
              salesExamples: true,
            },
          },
        },
      }),
      resolveAgentCapacity(fastify.prisma, tenantId),
    ]);
    return reply.send({
      agents: agents.map(serializeAgent),
      defaultChatModel: platformDefaultChatModel(),
      capacity,
    });
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

    const capacity = await resolveAgentCapacity(fastify.prisma, tenantId);
    if (capacity.freeSlots < 1) {
      return reply.code(402).send({
        error: `Нет свободных слотов агента. Оплатите AI-агента (${capacity.priceMonthly} ₽/мес)`,
        code: 'agent_slot_required',
        capacity,
      });
    }

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

  fastify.get('/usage', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { days?: string };
    const days = Math.min(90, Math.max(1, parseInt(q.days || '30', 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [wallet, grouped, groupedByChannel, recent] = await Promise.all([
      fastify.prisma.aiWallet.findUnique({ where: { tenantId } }),
      fastify.prisma.aiUsageLog.groupBy({
        by: ['aiAgentId'],
        where: { tenantId, createdAt: { gte: since } },
        _sum: { chargedRub: true, tokens: true, providerCostRub: true },
        _count: true,
      }),
      fastify.prisma.aiUsageLog.groupBy({
        by: ['channel'],
        where: { tenantId, createdAt: { gte: since } },
        _sum: { chargedRub: true, tokens: true, providerCostRub: true },
        _count: true,
      }),
      fastify.prisma.aiUsageLog.findMany({
        where: { tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          aiAgentId: true,
          model: true,
          tokens: true,
          chargedRub: true,
          requestType: true,
          createdAt: true,
        },
      }),
    ]);

    const agentIds = grouped.map((g) => g.aiAgentId).filter(Boolean) as string[];
    const agents = agentIds.length
      ? await fastify.prisma.aiAgent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = Object.fromEntries(agents.map((a: any) => [a.id, a.name]));

    return reply.send({
      days,
      balanceRub: wallet ? Number(wallet.balanceRub) : 0,
      byAgent: grouped.map((g: any) => ({
        aiAgentId: g.aiAgentId,
        name: g.aiAgentId ? nameById[g.aiAgentId] || 'Удалённый агент' : 'Без агента',
        requests: g._count,
        tokens: g._sum.tokens || 0,
        chargedRub: Number(g._sum.chargedRub || 0),
        providerCostRub: Number(g._sum.providerCostRub || 0),
      })),
      byChannel: groupedByChannel.map((g: any) => ({
        channel: g.channel ?? null,
        label: aiUsageChannelLabel(g.channel),
        requests: g._count,
        tokens: g._sum.tokens || 0,
        chargedRub: Number(g._sum.chargedRub || 0),
        providerCostRub: Number(g._sum.providerCostRub || 0),
      })),
      recent: recent.map((r: any) => ({
        id: r.id,
        aiAgentId: r.aiAgentId,
        agentName: r.aiAgentId ? nameById[r.aiAgentId] || null : null,
        model: r.model,
        tokens: r.tokens,
        chargedRub: Number(r.chargedRub),
        requestType: r.requestType,
        createdAt: r.createdAt,
      })),
    });
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
        model: z.string().min(1).max(120).optional().nullable(),
        settings: z.record(z.unknown()).optional().nullable(),
        status: z.enum(['active', 'archived']).optional(),
        learnFromWonDeals: z.boolean().optional(),
        wonStages: z.array(z.string().min(1).max(64)).max(20).optional(),
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

    let nextSettings: Record<string, unknown> | null =
      body.data.settings !== undefined
        ? (body.data.settings as Record<string, unknown> | null)
        : ((existing.settings as Record<string, unknown> | null) || {});
    if (body.data.model !== undefined) {
      nextSettings = {
        ...(typeof nextSettings === 'object' && nextSettings ? nextSettings : {}),
      };
      if (body.data.model === null || body.data.model.trim() === '') {
        delete nextSettings.model;
      } else {
        nextSettings.model = body.data.model.trim();
      }
    }
    if (body.data.learnFromWonDeals !== undefined || body.data.wonStages !== undefined) {
      nextSettings = {
        ...(typeof nextSettings === 'object' && nextSettings ? nextSettings : {}),
        ...(body.data.learnFromWonDeals !== undefined
          ? { learnFromWonDeals: body.data.learnFromWonDeals }
          : {}),
        ...(body.data.wonStages !== undefined ? { wonStages: body.data.wonStages } : {}),
      };
    }
    if (
      body.data.settings !== undefined ||
      body.data.model !== undefined ||
      body.data.learnFromWonDeals !== undefined ||
      body.data.wonStages !== undefined
    ) {
      data.settings =
        nextSettings === null
          ? Prisma.JsonNull
          : (nextSettings as Prisma.InputJsonValue);
    }

    const updated = await fastify.prisma.aiAgent.update({
      where: { id: agentId },
      data,
    });
    return reply.send(serializeAgent(updated));
  });

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

  fastify.get(
    '/:agentId/knowledge',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { agentId } = request.params as { agentId: string };
      const agent = await requireAgent(fastify, tenantId, agentId);
      if (!agent) return reply.code(404).send({ error: 'Not found' });
      const files = await fastify.prisma.aiKnowledgeFile.findMany({
        where: { tenantId, aiAgentId: agentId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          extractedChars: true,
          status: true,
          error: true,
          createdAt: true,
          _count: { select: { chunks: true } },
        },
      });
      return reply.send({
        files: files.map((f: any) => ({
          id: f.id,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          extractedChars: f.extractedChars,
          status: f.status,
          error: f.error,
          chunkCount: f._count.chunks,
          createdAt: f.createdAt,
        })),
      });
    },
  );

  fastify.post(
    '/:agentId/knowledge',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { agentId } = request.params as { agentId: string };
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const agent = await requireAgent(fastify, tenantId, agentId);
      if (!agent) return reply.code(404).send({ error: 'Not found' });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'file required' });
      const buffer = await file.toBuffer();
      try {
        const saved = await saveKnowledgeUpload({
          tenantId,
          agentId,
          filename: file.filename || 'upload.bin',
          mimeType: file.mimetype || 'application/octet-stream',
          buffer,
        });
        return reply.code(201).send({ id: saved.id, status: 'processing' });
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'upload failed' });
      }
    },
  );

  fastify.delete(
    '/:agentId/knowledge/:fileId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { agentId, fileId } = request.params as { agentId: string; fileId: string };
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const ok = await deleteKnowledgeFile({ tenantId, agentId, fileId });
      if (!ok) return reply.code(404).send({ error: 'Not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.get(
    '/:agentId/sales-examples',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { agentId } = request.params as { agentId: string };
      const q = request.query as { limit?: string };
      const agent = await requireAgent(fastify, tenantId, agentId);
      if (!agent) return reply.code(404).send({ error: 'Not found' });
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '30', 10) || 30));
      const [examples, total] = await Promise.all([
        fastify.prisma.aiSalesExample.findMany({
          where: { tenantId, aiAgentId: agentId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            userText: true,
            operatorText: true,
            opportunityId: true,
            conversationId: true,
            createdAt: true,
          },
        }),
        fastify.prisma.aiSalesExample.count({ where: { tenantId, aiAgentId: agentId } }),
      ]);
      return reply.send({ total, examples });
    },
  );

  fastify.delete(
    '/:agentId/sales-examples/:exampleId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { agentId, exampleId } = request.params as {
        agentId: string;
        exampleId: string;
      };
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const deleted = await fastify.prisma.aiSalesExample.deleteMany({
        where: { id: exampleId, tenantId, aiAgentId: agentId },
      });
      if (!deleted.count) return reply.code(404).send({ error: 'Not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.post(
    '/:agentId/sales-examples/sync',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { agentId } = request.params as { agentId: string };
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const agent = await requireAgent(fastify, tenantId, agentId);
      if (!agent) return reply.code(404).send({ error: 'Not found' });
      // Reset salesLearnedAt so force re-scan picks them up
      await fastify.prisma.conversation.updateMany({
        where: {
          tenantId,
          OR: [{ aiAgentId: agentId }, { botInstance: { defaultAiAgentId: agentId } }],
          twentyOpportunityId: { not: null },
        },
        data: { salesLearnedAt: null },
      });
      const result = await ingestWonDealsForAgent({
        tenantId,
        agentId,
        force: true,
      });
      return reply.send(result);
    },
  );
};
