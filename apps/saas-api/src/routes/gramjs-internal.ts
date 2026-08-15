// Internal: gramjs-bridge → acknowledge personal TG connect.
// History sync + CRM enrich are manual only (portal POST …/sync-history / admin enqueue).

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { extractBearer, verifyServiceToken } from '@voxly/shared';

const connectedSchema = z.object({
  tenantId: z.string().min(1),
  botId: z.string().min(1),
  limit: z.number().int().min(1).max(300).optional(),
});

export const gramjsInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    const service = String(request.headers['x-voxly-service'] || '');
    const bearer = extractBearer(String(request.headers.authorization || ''));
    if (!verifyServiceToken(bearer, 'saas-api') || service !== 'gramjs-bridge') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/connected', async (request, reply) => {
    const parsed = connectedSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { tenantId, botId } = parsed.data;
    const bot = await fastify.prisma.botInstance.findFirst({
      where: {
        id: botId,
        tenantId,
        botType: 'ai_gramjs',
        status: 'active',
      },
      select: { id: true },
    });
    if (!bot) {
      return reply.code(404).send({ error: 'gramjs bot not found' });
    }
    // Do not enqueue runGramjsPrivateChatSync / enrich on connect — button only.
    return reply.send({
      ok: true,
      queued: false,
      reason: 'manual_sync_only',
      tenantId,
      botId,
    });
  });
};
