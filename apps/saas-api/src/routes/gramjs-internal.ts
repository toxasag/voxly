// Internal: gramjs-bridge → enqueue CRM enrich+dedupe after personal TG connects.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueGramjsCrmEnrich } from '../jobs/queues.js';

const connectedSchema = z.object({
  tenantId: z.string().min(1),
  botId: z.string().min(1),
  limit: z.number().int().min(1).max(300).optional(),
});

export const gramjsInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    const service = String(request.headers['x-voxly-service'] || '');
    const auth = String(request.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const token = process.env.VOXLY_SERVICE_TOKEN || '';
    if (!token || bearer !== token || service !== 'gramjs-bridge') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post('/connected', async (request, reply) => {
    const parsed = connectedSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { tenantId, botId, limit } = parsed.data;
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
    try {
      await enqueueGramjsCrmEnrich({ tenantId, botId, limit });
    } catch (err) {
      // Duplicate jobId while previous still in Redis → treat as ok (idempotent).
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists|JobId/i.test(msg)) {
        fastify.log.error({ err, tenantId, botId }, 'enqueue gramjs crm enrich failed');
        return reply.code(500).send({ error: 'enqueue_failed', detail: msg });
      }
    }
    return reply.send({ ok: true, queued: true, tenantId, botId });
  });
};
