// Internal MAX ingest + bot upsert for max-bridge (VOXLY_SERVICE_TOKEN).
// ADR-025: Conversation(platform=max) + ChatMessage + CRM Person/Opportunity.

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encrypt, decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';

function requireMaxService(request: { headers: Record<string, unknown> }, reply: {
  code: (n: number) => { send: (b: unknown) => unknown };
}): boolean {
  const service = String(request.headers['x-voxly-service'] || '');
  const auth = String(request.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
  if (!token || bearer !== token || service !== 'max-bridge') {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function getTenantTwenty(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
): Promise<TwentyClient | null> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId, role: 'owner' },
    include: { user: true },
  });
  if (
    !tenant?.twentyWorkspaceId ||
    !tenant.twentyOwnerPasswordEncrypted ||
    !owner?.user?.email
  ) {
    return null;
  }
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  return client;
}

/** Best-effort CRM lead: one Person + one open Opportunity per peer. */
async function syncMaxLeadToCrm(opts: {
  prisma: FastifyInstance['prisma'];
  tenantId: string;
  conversationId: string;
  platformUserId: string;
  username?: string | null;
  firstName?: string | null;
}): Promise<void> {
  const conversation = await opts.prisma.conversation.findUnique({
    where: { id: opts.conversationId },
  });
  if (!conversation) return;
  if (conversation.twentyPersonId && conversation.twentyOpportunityId) return;

  const client = await getTenantTwenty(opts.prisma, opts.tenantId);
  if (!client) return;

  let personId = conversation.twentyPersonId || undefined;
  let opportunityId = conversation.twentyOpportunityId || undefined;

  if (personId && !(await client.personExists(personId))) personId = undefined;
  if (opportunityId && !(await client.opportunityExists(opportunityId))) {
    opportunityId = undefined;
  }

  if (!personId) {
    const prior = await opts.prisma.conversation.findFirst({
      where: {
        tenantId: opts.tenantId,
        platformUserId: opts.platformUserId,
        twentyPersonId: { not: null },
        NOT: { id: opts.conversationId },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (prior?.twentyPersonId && (await client.personExists(prior.twentyPersonId))) {
      personId = prior.twentyPersonId;
      if (prior.twentyOpportunityId && (await client.opportunityExists(prior.twentyOpportunityId))) {
        opportunityId = prior.twentyOpportunityId;
      }
    }
  }

  if (!personId) {
    const who =
      opts.firstName ||
      (opts.username ? `@${opts.username.replace(/^@/, '')}` : null) ||
      `MAX ${opts.platformUserId}`;
    const created = await client.createPerson({
      firstName: who,
      lastName: opts.username
        ? `@${opts.username.replace(/^@/, '')}`
        : opts.platformUserId,
    });
    personId = created?.id;
  }

  if (!opportunityId && personId) {
    const fromConv = await opts.prisma.conversation.findFirst({
      where: {
        tenantId: opts.tenantId,
        twentyPersonId: personId,
        twentyOpportunityId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (
      fromConv?.twentyOpportunityId &&
      (await client.opportunityExists(fromConv.twentyOpportunityId))
    ) {
      opportunityId = fromConv.twentyOpportunityId;
    }
  }

  if (!opportunityId && personId) {
    const who =
      opts.username
        ? `@${opts.username.replace(/^@/, '')}`
        : opts.firstName || opts.platformUserId;
    const opp = await client.createOpportunity({
      name: `${who} · MAX · личный`,
      personId,
      stage: 'NEW',
    });
    opportunityId = opp?.id;
  }

  if (personId || opportunityId) {
    await opts.prisma.conversation.update({
      where: { id: opts.conversationId },
      data: {
        twentyPersonId: personId || null,
        twentyOpportunityId: opportunityId || null,
      },
    });
  }
}

const upsertBotSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1).max(80).default('default'),
  maxUserId: z.string().optional(),
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  sessionReady: z.boolean().optional(),
});

const inboundSchema = z.object({
  botId: z.string().min(1),
  peerId: z.string().min(1),
  text: z.string().max(8000).default(''),
  messageId: z.union([z.string(), z.number()]).optional(),
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
});

export const maxInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    if (!requireMaxService(request as any, reply)) return;
  });

  /** List active personal MAX bots (restore sessions on bridge boot). */
  fastify.get('/bots/active', async (_request, reply) => {
    const bots = await fastify.prisma.botInstance.findMany({
      where: {
        botType: 'ai_max',
        status: 'active',
        botTokenEncrypted: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        botUsername: true,
        displayName: true,
        phoneNumberId: true,
      },
      take: 500,
    });
    return reply.send({
      ok: true,
      bots: bots.map((b) => ({
        botId: b.id,
        tenantId: b.tenantId,
        name: b.displayName || b.botUsername || 'default',
        maxUserId: b.phoneNumberId,
      })),
    });
  });

  /** Create/update BotInstance after QR auth. */
  fastify.post('/bots/upsert', async (request, reply) => {
    const parsed = upsertBotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { tenantId, name, maxUserId, username, firstName, sessionReady } = parsed.data;
    const prisma = fastify.prisma;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant not found' });

    const existing = await prisma.botInstance.findFirst({
      where: {
        tenantId,
        botType: 'ai_max',
        OR: [{ displayName: name }, { botUsername: name }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const sessionMarker = sessionReady
      ? encrypt(`max-session:${maxUserId || 'unknown'}:${Date.now()}`)
      : existing?.botTokenEncrypted || null;

    const data = {
      displayName: name,
      botUsername: username?.replace(/^@/, '') || name,
      phoneNumberId: maxUserId || existing?.phoneNumberId || null,
      botTokenEncrypted: sessionMarker,
      status: 'active' as const,
      provisionedVia: 'manual' as const,
    };

    const bot = existing
      ? await prisma.botInstance.update({ where: { id: existing.id }, data })
      : await prisma.botInstance.create({
          data: {
            tenantId,
            botType: 'ai_max',
            ...data,
          },
        });

    return reply.send({
      ok: true,
      botId: bot.id,
      tenantId,
      name,
      maxUserId: bot.phoneNumberId,
      firstName: firstName || null,
    });
  });

  /** Clear session marker / soft-delete account. */
  fastify.post('/bots/delete', async (request, reply) => {
    const body = (request.body || {}) as { tenantId?: string; botId?: string };
    const tenantId = String(body.tenantId || '').trim();
    const botId = String(body.botId || '').trim();
    if (!tenantId || !botId) {
      return reply.code(400).send({ error: 'tenantId and botId required' });
    }
    const bot = await fastify.prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'ai_max' },
    });
    if (!bot) return reply.code(404).send({ error: 'not found' });

    await fastify.prisma.conversation.updateMany({
      where: { botInstanceId: botId },
      data: { botInstanceId: null },
    });
    try {
      await fastify.prisma.botInstance.delete({ where: { id: botId } });
    } catch {
      await fastify.prisma.botInstance.update({
        where: { id: botId },
        data: { status: 'inactive', botTokenEncrypted: null, phoneNumberId: null },
      });
    }
    return reply.send({ ok: true, botId });
  });

  /** Inbound DM → Conversation + ChatMessage + CRM (no sales LLM). */
  fastify.post('/inbound', async (request, reply) => {
    const parsed = inboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { botId, peerId, text, messageId, username, firstName } = parsed.data;
    const prisma = fastify.prisma;

    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, botType: 'ai_max', status: 'active' },
    });
    if (!bot) return reply.code(404).send({ error: 'bot not found' });

    const extId = messageId != null ? `max:${messageId}` : null;
    if (extId) {
      const dup = await prisma.chatMessage.findFirst({
        where: { externalMessageId: extId, conversation: { botInstanceId: botId } },
        select: { id: true, conversationId: true },
      });
      if (dup) {
        return reply.send({ ok: true, duplicate: true, conversationId: dup.conversationId });
      }
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: bot.tenantId,
        botInstanceId: botId,
        platform: 'max',
        platformUserId: peerId,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId: bot.tenantId,
          botInstanceId: botId,
          platform: 'max',
          platformUserId: peerId,
          platformUsername: username || null,
          platformFirstName: firstName || null,
          channel: 'max_personal',
          status: 'open',
          mode: 'ai',
        },
      });
    } else {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          platformUsername: username || conversation.platformUsername,
          platformFirstName: firstName || conversation.platformFirstName,
          updatedAt: new Date(),
        },
      });
    }

    const content = (text || '').trim() || '[сообщение]';
    const msg = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content,
        externalMessageId: extId,
      },
    });

    void syncMaxLeadToCrm({
      prisma,
      tenantId: bot.tenantId,
      conversationId: conversation.id,
      platformUserId: peerId,
      username,
      firstName,
    }).catch((err) => {
      console.warn('[max-internal] CRM sync failed', err);
    });

    return reply.send({
      ok: true,
      conversationId: conversation.id,
      messageId: msg.id,
      twentyPersonId: conversation.twentyPersonId,
      twentyOpportunityId: conversation.twentyOpportunityId,
    });
  });
};
