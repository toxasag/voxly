// Internal MAX ingest + bot upsert for max-bridge (VOXLY_SERVICE_TOKEN).
// ADR-025: Conversation(platform=max) + ChatMessage + CRM Person/Opportunity.

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encrypt, decrypt } from '@voxly/crypto';
import { upsertCrmRecordLink } from '@voxly/db';
import { TwentyClient } from '@voxly/twenty-client';
import { extractBearer, verifyServiceToken } from '@voxly/shared';
import { enqueueTimelineSync } from '@voxly/ai-core';
import { stripOwnerPhone } from '../services/max-phone-guard.js';

function requireMaxService(request: { headers: Record<string, unknown> }, reply: {
  code: (n: number) => { send: (b: unknown) => unknown };
}): boolean {
  const service = String(request.headers['x-voxly-service'] || '');
  const bearer = extractBearer(String(request.headers.authorization || ''));
  if (!verifyServiceToken(bearer, 'saas-api') || service !== 'max-bridge') {
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

/** Best-effort CRM lead: one Person + one open Opportunity per private peer. */
async function syncMaxLeadToCrm(opts: {
  prisma: FastifyInstance['prisma'];
  tenantId: string;
  conversationId: string;
  /** Chat id — Conversation/send key (may differ from MAX user id). */
  platformUserId: string;
  /** Real MAX user id for Person.max /open/max when known. */
  maxUserId?: string | null;
  username?: string | null;
  firstName?: string | null;
  phone?: string | null;
  maxLink?: string | null;
  /** Connected account MAX user id — never create a lead for self. */
  selfMaxUserId?: string | null;
  /** Connected account phone digits — never write onto peer Person (INC-113). */
  selfPhone?: string | null;
  allowOpportunityCreate?: boolean;
}): Promise<void> {
  const conversation = await opts.prisma.conversation.findUnique({
    where: { id: opts.conversationId },
  });
  if (!conversation) return;

  // Channels/groups: negative chat ids — never Person/Opportunity.
  const chatKey = String(opts.platformUserId || '').trim();
  if (!chatKey || chatKey === '0' || chatKey.startsWith('-')) return;

  const maxUserId = String(opts.maxUserId || '').trim() || undefined;
  const selfId = String(opts.selfMaxUserId || '').trim() || undefined;
  if (selfId && (maxUserId === selfId || chatKey === selfId)) return;

  const client = await getTenantTwenty(opts.prisma, opts.tenantId);
  if (!client) return;

  let personId = conversation.twentyPersonId || undefined;
  let opportunityId = conversation.twentyOpportunityId || undefined;

  if (personId && !(await client.personExists(personId))) personId = undefined;
  if (opportunityId && !(await client.opportunityExists(opportunityId))) {
    opportunityId = undefined;
  }

  // Already fully linked — still enrich max/name/phone if provided.
  // Never use connected-account phone as peer phone (fill-empty would still leak).
  const phoneDigits = stripOwnerPhone(opts.phone, opts.selfPhone) || '';

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

  // Cross-channel merge: same phone as WA/TG Person → same deal.
  if (!personId && phoneDigits.length >= 10) {
    try {
      const byPhone = await client.findPersonByPhone(phoneDigits);
      personId = byPhone?.id || byPhone?.ids?.[0];
    } catch {
      /* ignore */
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
      phone: phoneDigits.length >= 10 ? phoneDigits : undefined,
    });
    personId = created?.id;
  }

  if (personId) {
    try {
      await client.applyMaxProfile(personId, {
        firstName: opts.firstName || undefined,
        lastName: opts.username
          ? `@${opts.username.replace(/^@/, '')}`
          : undefined,
        link: opts.maxLink || undefined,
        // Prefer real user id for /open/max — chat id ≠ user id (INC-113).
        userId: maxUserId || opts.platformUserId,
        phone: phoneDigits.length >= 10 ? `+${phoneDigits}` : undefined,
      });
    } catch {
      /* optional */
    }
  }

  // Phone known → fill TG + WA (MAX already applied).
  if (personId && phoneDigits.length >= 10) {
    try {
      const { enrichPersonCrossChannelByPhone } = await import(
        '../services/enrich-person-by-phone.js'
      );
      await enrichPersonCrossChannelByPhone({
        prisma: opts.prisma,
        twenty: client,
        tenantId: opts.tenantId,
        personId,
        phone: phoneDigits,
        channels: ['telegram', 'whatsapp'],
        forbidPhones: opts.selfPhone ? [opts.selfPhone] : undefined,
      });
    } catch (err) {
      console.warn('[max-internal] cross-channel enrich failed', err);
    }
  }

  if (!opportunityId && personId) {
    try {
      const open = await client.findOpenOpportunityByPerson(personId);
      if (open?.id) opportunityId = open.id;
    } catch {
      /* ignore */
    }
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

  if (!opportunityId && personId && opts.allowOpportunityCreate !== false) {
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

  if (opportunityId) {
    try {
      await client.touchOpportunityActivity(opportunityId);
    } catch {
      /* ignore */
    }
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
  // Bridge may send null right after on_start before profile id is known.
  maxUserId: z.string().nullish(),
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  sessionReady: z.boolean().optional(),
});

const inboundAttachmentSchema = z.object({
  type: z.enum(['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation']),
  fileId: z.string().min(1),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  fileSize: z.number().optional(),
});

const inboundSchema = z.object({
  botId: z.string().min(1),
  peerId: z.string().min(1),
  /** Real MAX user id (DIALOG participant); peerId remains chat id for send/read. */
  maxUserId: z.string().nullable().optional(),
  chatType: z.string().nullable().optional(),
  text: z.string().max(8000).default(''),
  // String only — MAX snowflake ids exceed JS safe integer if parsed as number.
  messageId: z.union([z.string(), z.number()]).optional().transform((v) =>
    v == null ? undefined : String(v),
  ),
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  /** Connected MAX account phone — saas-api strips if peer phone matches (INC-113). */
  selfPhone: z.string().nullable().optional(),
  maxLink: z.string().nullable().optional(),
  attachments: z.array(inboundAttachmentSchema).max(20).optional(),
});

const outboundSchema = inboundSchema;

function maxAttachmentPlaceholder(atts: z.infer<typeof inboundAttachmentSchema>[]): string {
  const a = atts[0];
  if (!a) return '[сообщение]';
  if (a.type === 'photo') return '[фото]';
  if (a.type === 'video' || a.type === 'animation') return '[видео]';
  if (a.type === 'voice') return '[голосовое]';
  if (a.type === 'audio') return '[аудио]';
  if (a.type === 'sticker') return '[стикер]';
  return a.fileName ? `[файл: ${a.fileName}]` : '[файл]';
}

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

  /** Native outgoing MAX DM from the connected personal account → operator CRM message. */
  fastify.post('/outbound', async (request, reply) => {
    const parsed = outboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const {
      botId,
      peerId,
      maxUserId,
      chatType,
      text,
      messageId,
      username,
      firstName,
      phone,
      selfPhone,
      maxLink,
      attachments,
    } = parsed.data;
    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, botType: 'ai_max', status: 'active' },
    });
    if (!bot) return reply.code(404).send({ error: 'bot not found' });

    const chatTypeNorm = String(chatType || '').trim().toUpperCase();
    if (chatTypeNorm && chatTypeNorm !== 'DIALOG') {
      return reply.send({ ok: true, skipped: 'non_private_chat', chatType: chatTypeNorm });
    }
    if (String(peerId).trim().startsWith('-')) {
      return reply.send({ ok: true, skipped: 'non_private_chat', chatType: 'negative_id' });
    }
    const selfMaxUserId = String(bot.phoneNumberId || '').trim() || null;
    const peerUser = String(maxUserId || '').trim();
    if (selfMaxUserId && (peerUser === selfMaxUserId || String(peerId) === selfMaxUserId)) {
      return reply.send({ ok: true, skipped: 'self' });
    }
    const peerPhone = stripOwnerPhone(phone, selfPhone) || null;
    const extId = messageId != null ? `max:${messageId}` : null;
    if (extId) {
      const dup = await prisma.chatMessage.findFirst({
        where: { externalMessageId: extId, conversation: { botInstanceId: botId } },
        select: { id: true, conversationId: true },
      });
      if (dup) return reply.send({ ok: true, duplicate: true, conversationId: dup.conversationId });
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

    const atts = Array.isArray(attachments) ? attachments : [];
    const content = (text || '').trim() || (atts.length ? maxAttachmentPlaceholder(atts) : '[сообщение]');
    const msg = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'operator',
        content,
        externalMessageId: extId,
        fromMe: true,
        ...(atts.length ? { attachments: atts } : {}),
      },
    });

    await syncMaxLeadToCrm({
      prisma,
      tenantId: bot.tenantId,
      conversationId: conversation.id,
      platformUserId: peerId,
      maxUserId: peerUser || null,
      username,
      firstName,
      phone: peerPhone,
      maxLink,
      selfMaxUserId,
      selfPhone,
      // Native outbound must attach to an existing CRM lead, never create one.
      allowOpportunityCreate: false,
    });
    const linked = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { twentyPersonId: true, twentyOpportunityId: true },
    });
    await upsertCrmRecordLink(prisma, {
      tenantId: bot.tenantId,
      conversationId: conversation.id,
      twentyPersonId: linked?.twentyPersonId || null,
      twentyOpportunityId: linked?.twentyOpportunityId || null,
      source: 'outbound',
    });
    void enqueueTimelineSync({
      tenantId: bot.tenantId,
      twentyPersonId: linked?.twentyPersonId || null,
      phoneFingerprint: null,
      kind: 'chat_outbound',
      channel: 'ai_max',
      title: `Исходящее (MAX): ${content.slice(0, 80)}`,
      description: content,
      meta: { conversationId: conversation.id, botId, externalMessageId: extId },
      conversationId: conversation.id,
      messageId: msg.id,
    });
    return reply.send({
      ok: true,
      conversationId: conversation.id,
      messageId: msg.id,
      twentyPersonId: linked?.twentyPersonId || null,
      twentyOpportunityId: linked?.twentyOpportunityId || null,
    });
  });

  /** Inbound DM → Conversation + ChatMessage + CRM (no sales LLM). */
  fastify.post('/inbound', async (request, reply) => {
    const parsed = inboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const {
      botId,
      peerId,
      maxUserId,
      chatType,
      text,
      messageId,
      username,
      firstName,
      phone,
      selfPhone,
      maxLink,
      attachments,
    } = parsed.data;
    const prisma = fastify.prisma;

    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, botType: 'ai_max', status: 'active' },
    });
    if (!bot) return reply.code(404).send({ error: 'bot not found' });

    const chatTypeNorm = String(chatType || '').trim().toUpperCase();
    // Belt-and-suspenders: channels/groups never become CRM leads (bridge should already skip).
    if (chatTypeNorm && chatTypeNorm !== 'DIALOG') {
      return reply.send({ ok: true, skipped: 'non_private_chat', chatType: chatTypeNorm });
    }
    if (String(peerId).trim().startsWith('-')) {
      return reply.send({ ok: true, skipped: 'non_private_chat', chatType: 'negative_id' });
    }
    const selfMaxUserId = String(bot.phoneNumberId || '').trim() || null;
    const peerUser = String(maxUserId || '').trim();
    if (selfMaxUserId && (peerUser === selfMaxUserId || String(peerId) === selfMaxUserId)) {
      return reply.send({ ok: true, skipped: 'self' });
    }
    // Drop owner phone before Conversation metadata / CRM lead (INC-113).
    const peerPhone = stripOwnerPhone(phone, selfPhone) || null;

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

    const atts = Array.isArray(attachments) ? attachments : [];
    const content =
      (text || '').trim() || (atts.length ? maxAttachmentPlaceholder(atts) : '[сообщение]');
    const msg = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content,
        externalMessageId: extId,
        ...(atts.length ? { attachments: atts } : {}),
      },
    });

    void syncMaxLeadToCrm({
      prisma,
      tenantId: bot.tenantId,
      conversationId: conversation.id,
      platformUserId: peerId,
      maxUserId: peerUser || null,
      username,
      firstName,
      phone: peerPhone,
      maxLink,
      selfMaxUserId,
      selfPhone,
    }).catch((err) => {
      console.warn('[max-internal] CRM sync failed', err);
    });

    void enqueueTimelineSync({
      tenantId: bot.tenantId,
      twentyPersonId: conversation.twentyPersonId || null,
      phoneFingerprint: null,
      kind: 'chat_inbound',
      channel: 'ai_max',
      title: `Входящее (MAX): ${content.slice(0, 80)}`,
      description: content,
      meta: { conversationId: conversation.id, botId, externalMessageId: extId },
      conversationId: conversation.id,
      messageId: msg.id,
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
