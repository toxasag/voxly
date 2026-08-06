// Shared Telegram audience / overlap graph — portal read API.
// Storage is platform-global; soft-gate ai_gramjs addon (see TG-AUDIENCE-GRAPH-TZ.md).

import type { FastifyPluginAsync } from 'fastify';
import { PRODUCT_CODES } from '@voxly/shared';

async function softGramjsAddon(prisma: any, tenantId: string) {
  const addon = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_GRAMJS } },
  });
  const isActive = Boolean(addon && addon.status === 'active' && addon.activeUntil > new Date());
  const { resolveUnitPrice } = await import('../services/platform-pricing.js');
  const priceMonthly = await resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.AI_GRAMJS);
  return {
    addon,
    isActive,
    billingWarning: isActive
      ? null
      : `Тариф «Личный Telegram» (${priceMonthly} ₽/мес) ещё не оплачен — soft-режим.`,
  };
}

export const audienceRoutes: FastifyPluginAsync = async (fastify) => {
  // Top channels/groups by unique telegram users sighted (platform-wide aggregates).
  fastify.get('/peers', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    // Prisma client types lag until generate is picked up in all packages (audience models are in schema).
    const prisma = fastify.prisma as any;
    const q = request.query as { limit?: string; peerType?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 40, 1), 100);
    const peerTypeFilter = q.peerType === 'channel' || q.peerType === 'group' ? q.peerType : null;

    const gate = await softGramjsAddon(prisma, tenantId);

    const grouped = await prisma.telegramSighting.groupBy({
      by: ['peerId'],
      where: {
        relation: { in: ['member', 'seen_in', 'admin'] },
      },
      _count: { telegramUserId: true },
      orderBy: { _count: { telegramUserId: 'desc' } },
      take: limit * 3,
    });

    const peerIds = grouped.map((g: { peerId: string }) => g.peerId);
    const peers = peerIds.length
      ? await prisma.telegramPeer.findMany({
          where: {
            peerId: { in: peerIds },
            ...(peerTypeFilter ? { peerType: peerTypeFilter } : { peerType: { in: ['channel', 'group'] } }),
          },
        })
      : [];
    const peerMap = new Map<string, any>(peers.map((p: any) => [p.peerId, p]));

    const rows = grouped
      .map((g: { peerId: string; _count: { telegramUserId: number } }) => {
        const peer = peerMap.get(g.peerId) as any;
        if (!peer) return null;
        return {
          peerId: peer.peerId,
          peerType: peer.peerType,
          username: peer.username,
          title: peer.title,
          uniqueUsers: g._count.telegramUserId,
          updatedAt: peer.updatedAt,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    const totals = await Promise.all([
      prisma.telegramPeer.count({ where: { peerType: { in: ['channel', 'group'] } } }),
      prisma.telegramSighting.count(),
    ]);

    return reply.send({
      ok: true,
      billingWarning: gate.billingWarning,
      gramjsAddonActive: gate.isActive,
      totals: { peers: totals[0], sightings: totals[1] },
      peers: rows,
    });
  });

  // Overlap for a lead: by telegramUserId, username, or conversationId.
  fastify.get('/overlap', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma as any;
    const q = request.query as {
      telegramUserId?: string;
      username?: string;
      conversationId?: string;
    };

    const gate = await softGramjsAddon(prisma, tenantId);

    let telegramUserId = String(q.telegramUserId || '').trim();
    let platformUsername: string | null = null;
    let conversationId: string | null = null;

    if (!telegramUserId && q.conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: String(q.conversationId).trim(), tenantId },
        select: {
          id: true,
          platformUserId: true,
          platformUsername: true,
        },
      });
      if (!conv) return reply.code(404).send({ error: 'conversation not found' });
      telegramUserId = conv.platformUserId;
      platformUsername = conv.platformUsername;
      conversationId = conv.id;
    }

    if (!telegramUserId && q.username) {
      const uname = String(q.username).trim().replace(/^@/, '');
      const peer = await prisma.telegramPeer.findFirst({
        where: {
          peerType: { in: ['user', 'bot'] },
          username: { equals: uname, mode: 'insensitive' },
        },
      });
      if (peer) {
        telegramUserId = peer.peerId;
        platformUsername = peer.username;
      } else {
        const conv = await prisma.conversation.findFirst({
          where: {
            tenantId,
            platformUsername: { equals: uname, mode: 'insensitive' },
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, platformUserId: true, platformUsername: true },
        });
        if (conv) {
          telegramUserId = conv.platformUserId;
          platformUsername = conv.platformUsername;
          conversationId = conv.id;
        }
      }
    }

    if (!telegramUserId) {
      return reply.code(400).send({
        error: 'telegramUserId, username, or conversationId required',
      });
    }

    const sightings = await prisma.telegramSighting.findMany({
      where: { telegramUserId },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });

    const peerIds = [...new Set(sightings.map((s: { peerId: string }) => s.peerId))];
    const peers = peerIds.length
      ? await prisma.telegramPeer.findMany({ where: { peerId: { in: peerIds } } })
      : [];
    const peerMap = new Map<string, any>(peers.map((p: any) => [p.peerId, p]));

    const items = sightings
      .map((s: {
        peerId: string;
        relation: string;
        firstSeenAt: Date;
        lastSeenAt: Date;
        confidence: number | null;
      }) => {
        const peer = peerMap.get(s.peerId) as any;
        if (!peer) return null;
        if (peer.peerType === 'user' || peer.peerType === 'bot') return null;
        return {
          peerId: peer.peerId,
          peerType: peer.peerType,
          username: peer.username,
          title: peer.title,
          relation: s.relation,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          confidence: s.confidence,
        };
      })
      .filter(Boolean);

    return reply.send({
      ok: true,
      billingWarning: gate.billingWarning,
      gramjsAddonActive: gate.isActive,
      telegramUserId,
      username: platformUsername,
      conversationId,
      overlapCount: items.length,
      peers: items,
    });
  });

  // Proxy: trigger GramJS dialog sync for a tenant account.
  fastify.post('/sync', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const body = (request.body || {}) as { botId?: string };
    const botId = String(body.botId || '').trim();
    if (!botId) return reply.code(400).send({ error: 'botId required' });

    const bot = await fastify.prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'ai_gramjs' },
      select: { id: true },
    });
    if (!bot) return reply.code(404).send({ error: 'account not found' });

    const token = process.env.VOXLY_SERVICE_TOKEN || '';
    const base = (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
    if (!token) {
      return reply.code(503).send({ error: 'VOXLY_SERVICE_TOKEN not configured' });
    }
    try {
      const res = await fetch(`${base}/audience/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ botId }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      return reply.code(res.status).send(json);
    } catch (err) {
      return reply.code(503).send({
        ok: false,
        error: 'gramjs-bridge unavailable',
        detail: String((err as Error)?.message || err),
      });
    }
  });
};
