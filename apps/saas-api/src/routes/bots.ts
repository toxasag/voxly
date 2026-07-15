// Bot routes: provision link for Managed Bots, list bot instances

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';

const provisionSchema = z.object({
  botType: z.enum(['gift', 'ai_tg', 'ai_wa']).default('gift'),
  suggestedUsername: z.string().optional(),
  suggestedName: z.string().optional(),
});

export const botRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Generate Managed Bots provisioning link ---
  fastify.post('/provision-link', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = provisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { botType, suggestedUsername, suggestedName } = parsed.data;
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const managerUsername = process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyManagerBot';
    const nonce = nanoid(32);

    // Create provision request
    const provisionReq = await prisma.botProvisionRequest.create({
      data: {
        tenantId,
        nonce,
        suggestedUsername,
        suggestedName,
        botType,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
      },
    });

    // Build deep link: t.me/newbot/{manager}/{suggested_username}?name={name}
    const params = new URLSearchParams();
    if (suggestedName) params.set('name', suggestedName);

    const deepLink = `https://t.me/newbot/${managerUsername}/${suggestedUsername || ''}${params.toString() ? `?${params}` : ''}`;

    return reply.send({
      provisionRequestId: provisionReq.id,
      nonce,
      deepLink,
      managerBot: `@${managerUsername}`,
      expiresAt: provisionReq.expiresAt,
    });
  });

  // --- List bot instances for tenant ---
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const bots = await prisma.botInstance.findMany({
      where: { tenantId },
      include: { giftCampaigns: true },
    });

    return reply.send({
      bots: bots.map((b) => ({
        id: b.id,
        botUsername: b.botUsername,
        botType: b.botType,
        provisionedVia: b.provisionedVia,
        status: b.status,
        createdAt: b.createdAt,
        hasGiftCampaign: b.giftCampaigns.length > 0,
      })),
    });
  });

  // --- Deactivate bot ---
  fastify.delete('/:botId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, role: userRole } = (request as any).user;
    const { botId } = request.params as { botId: string };
    const prisma = fastify.prisma;

    if (userRole !== 'owner' && userRole !== 'superadmin') {
      return reply.code(403).send({ error: 'Only owners can deactivate bots' });
    }

    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId },
    });

    if (!bot) {
      return reply.code(404).send({ error: 'Bot not found' });
    }

    await prisma.botInstance.update({
      where: { id: botId },
      data: { status: 'inactive' },
    });

    // TODO: delete webhook via Telegram Bot API

    return reply.send({ message: 'Bot deactivated' });
  });

  // --- Webhook endpoint for Telegram updates (called by gift-bot-worker, not Telegram directly) ---
  fastify.post('/webhook/:botId', async (request, reply) => {
    const { botId } = request.params as { botId: string };
    // This endpoint is used by bot workers to relay events to control plane
    // For now, just acknowledge
    return reply.send({ ok: true, botId });
  });
};
