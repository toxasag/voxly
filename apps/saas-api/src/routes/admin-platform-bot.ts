// Superadmin: GetVoxlybot subscribers, broadcasts, support, expiry notify

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendPlatformTelegramMessage } from '../services/platform-telegram.js';
import { processDuePlatformBroadcasts } from '../services/platform-broadcasts.js';

function actorUserId(request: { user?: { sub?: string; userId?: string } }): string {
  return request.user?.sub || request.user?.userId || '';
}

export const adminPlatformBotRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  fastify.get('/stats', async (_request, reply) => {
    const prisma = fastify.prisma;
    const [subscribers, linked, unreadSupport, broadcasts] = await Promise.all([
      prisma.platformBotSubscriber.count({ where: { blocked: false } }),
      prisma.platformBotSubscriber.count({ where: { userId: { not: null }, blocked: false } }),
      prisma.platformSupportMessage.count({
        where: { direction: 'inbound', readAt: null },
      }),
      prisma.platformBroadcast.count(),
    ]);
    return reply.send({ subscribers, linked, unreadSupport, broadcasts });
  });

  fastify.get('/subscribers', async (request, reply) => {
    const q = z
      .object({ take: z.coerce.number().min(1).max(200).default(50) })
      .safeParse(request.query);
    const take = q.success ? q.data.take : 50;
    const rows = await fastify.prisma.platformBotSubscriber.findMany({
      orderBy: { linkedAt: 'desc' },
      take,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return reply.send({
      items: rows.map((r) => ({
        id: r.id,
        telegramUserId: r.telegramUserId.toString(),
        chatId: r.chatId.toString(),
        username: r.username,
        blocked: r.blocked,
        linkedAt: r.linkedAt,
        user: r.user,
      })),
    });
  });

  fastify.get('/support', async (request, reply) => {
    const q = z
      .object({
        take: z.coerce.number().min(1).max(200).default(50),
        unreadOnly: z.coerce.boolean().optional(),
      })
      .safeParse(request.query);
    const take = q.success ? q.data.take : 50;
    const unreadOnly = q.success ? q.data.unreadOnly : false;
    const items = await fastify.prisma.platformSupportMessage.findMany({
      where: unreadOnly ? { direction: 'inbound', readAt: null } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
    });
    return reply.send({
      items: items.map((m) => ({
        ...m,
        telegramUserId: m.telegramUserId.toString(),
        chatId: m.chatId.toString(),
      })),
    });
  });

  fastify.post('/support/:id/reply', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ text: z.string().min(1).max(4000) }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    const inbound = await fastify.prisma.platformSupportMessage.findUnique({ where: { id } });
    if (!inbound) {
      return reply.code(404).send({ error: 'Message not found' });
    }
    const ok = await sendPlatformTelegramMessage(inbound.chatId, body.data.text);
    if (!ok) {
      return reply.code(502).send({ error: 'Не удалось отправить в Telegram' });
    }
    await fastify.prisma.platformSupportMessage.update({
      where: { id },
      data: { readAt: new Date() },
    });
    await fastify.prisma.platformSupportMessage.create({
      data: {
        telegramUserId: inbound.telegramUserId,
        chatId: inbound.chatId,
        direction: 'outbound',
        text: body.data.text,
        username: inbound.username,
        readAt: new Date(),
      },
    });
    return reply.send({ ok: true });
  });

  fastify.post('/support/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    await fastify.prisma.platformSupportMessage.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  fastify.get('/broadcasts', async (_request, reply) => {
    const items = await fastify.prisma.platformBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send({ items });
  });

  fastify.post('/broadcasts', async (request, reply) => {
    const body = z
      .object({
        text: z.string().min(1).max(4000),
        scheduledAt: z.string().datetime().optional(),
        sendNow: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    const scheduledAt = body.data.scheduledAt
      ? new Date(body.data.scheduledAt)
      : body.data.sendNow
        ? new Date()
        : null;
    const row = await fastify.prisma.platformBroadcast.create({
      data: {
        text: body.data.text,
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduledAt,
        createdById: actorUserId(request as any),
      },
    });
    if (body.data.sendNow) {
      await processDuePlatformBroadcasts(fastify.prisma);
      const fresh = await fastify.prisma.platformBroadcast.findUnique({ where: { id: row.id } });
      return reply.code(201).send({ item: fresh });
    }
    return reply.code(201).send({ item: row });
  });

  /** Manual: notify trials ending within N days */
  fastify.post('/notify-expiring', async (request, reply) => {
    const body = z
      .object({
        days: z.number().int().min(0).max(30).default(3),
        kind: z.enum(['trial', 'paid', 'both']).default('both'),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    const { notifyExpiringSubscriptions } = await import('../services/platform-expiry-notify.js');
    const result = await notifyExpiringSubscriptions(fastify.prisma, {
      days: body.data.days,
      kind: body.data.kind,
      force: true,
    });
    return reply.send(result);
  });
};
