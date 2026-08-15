// Internal endpoints for platform-bot-service (VOXLY_SERVICE_TOKEN + X-Voxly-Service)

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { extractBearer, verifyServiceToken } from '@voxly/shared';
import { bindAuthNonce } from '../services/auth-otp.js';

const bindSchema = z.object({
  nonce: z.string().min(8),
  telegramUserId: z.union([z.number(), z.string()]),
  chatId: z.union([z.number(), z.string()]),
  username: z.string().nullable().optional(),
});

const subscriberSchema = z.object({
  telegramUserId: z.union([z.number(), z.string()]),
  chatId: z.union([z.number(), z.string()]),
  username: z.string().nullable().optional(),
});

const supportSchema = z.object({
  telegramUserId: z.union([z.number(), z.string()]),
  chatId: z.union([z.number(), z.string()]),
  text: z.string().min(1).max(4000),
  username: z.string().nullable().optional(),
});

function asBigInt(v: number | string): bigint {
  return BigInt(v);
}

export const platformBotInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    const service = String(request.headers['x-voxly-service'] || '');
    const bearer = extractBearer(String(request.headers.authorization || ''));
    if (!verifyServiceToken(bearer, 'saas-api') || service !== 'platform-bot') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/bind-auth', async (request, reply) => {
    const parsed = bindSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const result = await bindAuthNonce({
      prisma: fastify.prisma,
      nonce: parsed.data.nonce,
      telegramUserId: asBigInt(parsed.data.telegramUserId),
      chatId: asBigInt(parsed.data.chatId),
      username: parsed.data.username,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send({ ok: true });
  });

  fastify.post('/ensure-subscriber', async (request, reply) => {
    const parsed = subscriberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const telegramUserId = asBigInt(parsed.data.telegramUserId);
    const chatId = asBigInt(parsed.data.chatId);
    await fastify.prisma.platformBotSubscriber.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        chatId,
        username: parsed.data.username || undefined,
      },
      update: {
        chatId,
        username: parsed.data.username || undefined,
        updatedAt: new Date(),
      },
    });
    return reply.send({ ok: true });
  });

  fastify.post('/support-inbound', async (request, reply) => {
    const parsed = supportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const telegramUserId = asBigInt(parsed.data.telegramUserId);
    const chatId = asBigInt(parsed.data.chatId);
    await fastify.prisma.platformBotSubscriber.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        chatId,
        username: parsed.data.username || undefined,
      },
      update: {
        chatId,
        username: parsed.data.username || undefined,
        updatedAt: new Date(),
      },
    });
    await fastify.prisma.platformSupportMessage.create({
      data: {
        telegramUserId,
        chatId,
        direction: 'inbound',
        text: parsed.data.text,
        username: parsed.data.username || undefined,
      },
    });
    return reply.send({ ok: true });
  });
};
