// Internal cross-channel Person enrich by phone (service token).
// Used by ai-telegram-worker / gift-bot-worker when E.164 is known.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';
import { extractBearer, verifyServiceToken } from '@voxly/shared';
import {
  enrichPersonCrossChannelByPhone,
  type EnrichChannel,
} from '../services/enrich-person-by-phone.js';

const ALLOWED_SERVICES = new Set([
  'ai-telegram-worker',
  'gift-bot-worker',
  'ai-whatsapp-worker',
  'gramjs-bridge',
  'max-bridge',
]);

function requireService(request: {
  headers: Record<string, unknown>;
}, reply: {
  code: (n: number) => { send: (b: unknown) => unknown };
}): boolean {
  const service = String(request.headers['x-voxly-service'] || '');
  const bearer = extractBearer(String(request.headers.authorization || ''));
  // saas-api is the target service; callers present its (per-service or shared)
  // token. X-Voxly-Service must still name a known internal caller.
  if (!verifyServiceToken(bearer, 'saas-api') || !ALLOWED_SERVICES.has(service)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const bodySchema = z.object({
  tenantId: z.string().min(1),
  personId: z.string().min(8).max(64),
  phone: z.string().min(8).max(32),
  channels: z
    .array(z.enum(['telegram', 'max', 'whatsapp']))
    .optional(),
});

export const crmEnrichInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/enrich-by-phone', async (request, reply) => {
    if (!requireService(request as any, reply as any)) return;

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
    }
    const { tenantId, personId, phone } = parsed.data;
    const channels = parsed.data.channels as EnrichChannel[] | undefined;

    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const owner = await fastify.prisma.tenantMember.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: true },
    });
    if (
      !tenant?.twentyWorkspaceId ||
      !tenant.twentyOwnerPasswordEncrypted ||
      !owner?.user?.email
    ) {
      return reply.code(409).send({ ok: false, error: 'crm_not_ready' });
    }

    const twenty = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    await twenty.authenticateWorkspace(
      owner.user.email,
      decrypt(tenant.twentyOwnerPasswordEncrypted),
      tenant.twentyWorkspaceId,
    );
    try {
      await twenty.ensureSocialFields();
    } catch {
      /* optional */
    }

    const result = await enrichPersonCrossChannelByPhone({
      prisma: fastify.prisma,
      twenty,
      tenantId,
      personId,
      phone,
      channels,
    });
    return { ok: true, result };
  });
};
