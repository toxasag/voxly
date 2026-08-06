/**
 * Web form lead intake — public webhook + tenant CRUD.
 * POST /api/webhooks/forms/:token — Tilda / WordPress / JSON (no JWT)
 * /api/forms/* — portal JWT
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '@voxly/db';
import {
  parseFormWebhookBody,
  sanitizeRawFields,
} from '../services/form-lead-parse.js';
import { enqueueFormLead } from '../jobs/queues.js';

function publicApiBase(domain: string): string {
  const fromEnv = (
    process.env.VOXLY_PUBLIC_API_URL ||
    process.env.PUBLIC_API_URL ||
    ''
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (domain.includes('localhost') || domain.includes('lvh.me')) {
    return 'http://localhost:3002';
  }
  return `https://api.${domain}`;
}

function webhookUrl(domain: string, token: string): string {
  return `${publicApiBase(domain)}/api/webhooks/forms/${token}`;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function extractProvidedSecret(request: {
  headers: Record<string, unknown>;
  query: unknown;
  body: unknown;
}): string | undefined {
  const h = request.headers;
  const header =
    (h['x-voxly-webhook-secret'] as string | undefined) ||
    (h['x-api-key'] as string | undefined) ||
    (h['x-webhook-secret'] as string | undefined);
  if (header?.trim()) return header.trim();

  const q = (request.query || {}) as Record<string, unknown>;
  for (const key of ['secret', 'api_key', 'apikey', 'token', 'key']) {
    const v = q[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  const body = (request.body || {}) as Record<string, unknown>;
  for (const key of [
    'secret',
    'api_key',
    'apikey',
    'token',
    'key',
    'voxly_secret',
  ]) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function verifyEndpointSecret(
  endpointSecret: string | null | undefined,
  provided: string | undefined,
): boolean {
  if (!endpointSecret) return true; // secret optional
  if (!provided) return false;
  // Accept plain secret or sha256(secret) if client hashed
  if (safeEqual(endpointSecret, provided)) return true;
  if (safeEqual(hashSecret(endpointSecret), provided)) return true;
  return false;
}

function serializeEndpoint(
  ep: {
    id: string;
    name: string;
    token: string;
    secret: string | null;
    dedupeMode: string;
    defaultStage: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  domain: string,
  opts?: { includeSecret?: boolean },
) {
  return {
    id: ep.id,
    name: ep.name,
    token: ep.token,
    url: webhookUrl(domain, ep.token),
    secret: opts?.includeSecret ? ep.secret : undefined,
    hasSecret: Boolean(ep.secret),
    dedupeMode: ep.dedupeMode,
    defaultStage: ep.defaultStage,
    isActive: ep.isActive,
    createdAt: ep.createdAt,
    updatedAt: ep.updatedAt,
    headerName: 'X-Voxly-Webhook-Secret',
  };
}

export const formWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Tilda / WP / JSON — must answer ≤5s with 200
  fastify.post(
    '/:token',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const endpoint = await prisma.formWebhookEndpoint.findUnique({
        where: { token },
      });

      if (!endpoint || !endpoint.isActive) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }

      const provided = extractProvidedSecret(request as any);
      if (!verifyEndpointSecret(endpoint.secret, provided)) {
        return reply.code(401).send({ error: 'Invalid webhook secret' });
      }

      const referer =
        (request.headers.referer as string | undefined) ||
        (request.headers.referrer as string | undefined);
      const normalized = parseFormWebhookBody(request.body, {
        referer,
      });

      // Tilda connection probe
      if (normalized.isTestProbe) {
        return reply.code(200).type('text/plain').send('ok');
      }

      if (!normalized.phone && !normalized.email && !normalized.name) {
        // Still 200 for Tilda reliability; mark as failed lead without enqueue
        await prisma.formLead.create({
          data: {
            tenantId: endpoint.tenantId,
            endpointId: endpoint.id,
            source: normalized.source,
            externalId: normalized.externalId || null,
            formId: normalized.formId || null,
            payload: {
              rawFields: sanitizeRawFields(normalized.rawFields),
              attribution: normalized.attribution,
              reason: 'empty_lead',
            } as object,
            status: 'failed',
            error: 'Нет имени, телефона и email',
          },
        }).catch(() => null);
        return reply.code(200).type('text/plain').send('ok');
      }

      const payloadJson = {
        rawFields: sanitizeRawFields(normalized.rawFields),
        attribution: normalized.attribution,
        cookiesRaw: normalized.cookiesRaw,
      } as object;

      let lead;
      try {
        lead = await prisma.formLead.create({
          data: {
            tenantId: endpoint.tenantId,
            endpointId: endpoint.id,
            source: normalized.source,
            externalId: normalized.externalId || null,
            formId: normalized.formId || null,
            name: normalized.name || null,
            phone: normalized.phone || null,
            email: normalized.email || null,
            comment: normalized.comment || null,
            pageUrl: normalized.pageUrl || null,
            referer: normalized.referer || null,
            payload: payloadJson,
            status: 'received',
          },
        });
      } catch (err: any) {
        // Unique (tenantId, source, externalId) → duplicate
        if (err?.code === 'P2002' && normalized.externalId) {
          return reply.code(200).type('text/plain').send('ok');
        }
        throw err;
      }

      // Fast ACK — CRM sync async (inline when workers disabled for local/tests)
      if (process.env.VOXLY_DISABLE_WORKERS === '1') {
        import('../services/form-lead-process.js')
          .then(({ processFormLead }) => processFormLead(lead.id))
          .catch((e) => console.error('[forms] inline process failed', e));
      } else {
        enqueueFormLead({ formLeadId: lead.id }).catch((e) => {
          console.error('[forms] enqueue failed', e);
        });
      }

      return reply.code(200).type('text/plain').send('ok');
    },
  );
};

export const formsRoutes: FastifyPluginAsync = async (fastify) => {
  const domain = (fastify as any).voxlyDomain || 'getvoxly.ru';

  // List endpoints
  fastify.get(
    '/endpoints',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any) => {
      const tenantId = request.user.tenantId as string;
      const endpoints = await prisma.formWebhookEndpoint.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        endpoints: endpoints.map((ep) => serializeEndpoint(ep, domain)),
      };
    },
  );

  // Create endpoint
  fastify.post(
    '/endpoints',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any, reply) => {
      const tenantId = request.user.tenantId as string;
      const userId = (request.user.sub || request.user.userId) as string | undefined;
      const body = (request.body || {}) as {
        name?: string;
        dedupeMode?: string;
        defaultStage?: string | null;
        withSecret?: boolean;
      };

      const dedupeMode =
        body.dedupeMode === 'always_new' ? 'always_new' : 'reuse_open';
      const secret =
        body.withSecret === false
          ? null
          : randomBytes(24).toString('hex');
      const token = `fl_${nanoid(28)}`;

      const ep = await prisma.formWebhookEndpoint.create({
        data: {
          tenantId,
          name: (body.name || 'Сайт').trim().slice(0, 120) || 'Сайт',
          token,
          secret,
          dedupeMode,
          defaultStage: body.defaultStage?.trim() || null,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId || null,
          action: 'form_webhook_endpoint_create',
          payload: { endpointId: ep.id, name: ep.name },
          ipAddress: request.ip,
        },
      });

      return reply.code(201).send({
        endpoint: serializeEndpoint(ep, domain, { includeSecret: true }),
      });
    },
  );

  // Update endpoint
  fastify.patch(
    '/endpoints/:id',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any, reply) => {
      const tenantId = request.user.tenantId as string;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as {
        name?: string;
        dedupeMode?: string;
        defaultStage?: string | null;
        isActive?: boolean;
        rotateSecret?: boolean;
      };

      const existing = await prisma.formWebhookEndpoint.findFirst({
        where: { id, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      const data: Record<string, unknown> = {};
      if (typeof body.name === 'string') {
        data.name = body.name.trim().slice(0, 120) || existing.name;
      }
      if (body.dedupeMode === 'always_new' || body.dedupeMode === 'reuse_open') {
        data.dedupeMode = body.dedupeMode;
      }
      if (body.defaultStage !== undefined) {
        data.defaultStage = body.defaultStage?.trim() || null;
      }
      if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
      let includeSecret = false;
      if (body.rotateSecret) {
        data.secret = randomBytes(24).toString('hex');
        includeSecret = true;
      }

      const ep = await prisma.formWebhookEndpoint.update({
        where: { id },
        data,
      });

      return {
        endpoint: serializeEndpoint(ep, domain, { includeSecret }),
      };
    },
  );

  // Delete endpoint
  fastify.delete(
    '/endpoints/:id',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any, reply) => {
      const tenantId = request.user.tenantId as string;
      const userId = (request.user.sub || request.user.userId) as string | undefined;
      const { id } = request.params as { id: string };
      const existing = await prisma.formWebhookEndpoint.findFirst({
        where: { id, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      await prisma.formWebhookEndpoint.delete({ where: { id } });
      await prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId || null,
          action: 'form_webhook_endpoint_delete',
          payload: { endpointId: id },
          ipAddress: request.ip,
        },
      });
      return { success: true };
    },
  );

  // Recent leads
  fastify.get(
    '/leads',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any) => {
      const tenantId = request.user.tenantId as string;
      const q = request.query as { limit?: string; endpointId?: string };
      const limit = Math.min(parseInt(q.limit || '30', 10) || 30, 100);
      const leads = await prisma.formLead.findMany({
        where: {
          tenantId,
          ...(q.endpointId ? { endpointId: q.endpointId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          endpointId: true,
          source: true,
          externalId: true,
          formId: true,
          name: true,
          phone: true,
          email: true,
          status: true,
          error: true,
          personId: true,
          opportunityId: true,
          needsReview: true,
          createdAt: true,
        },
      });
      return { leads };
    },
  );

  // Manual retry for failed lead
  fastify.post(
    '/leads/:id/retry',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any, reply) => {
      const tenantId = request.user.tenantId as string;
      const { id } = request.params as { id: string };
      const lead = await prisma.formLead.findFirst({
        where: { id, tenantId },
      });
      if (!lead) return reply.code(404).send({ error: 'Not found' });
      if (lead.status === 'duplicate') {
        return reply.code(400).send({ error: 'Duplicate lead cannot be retried' });
      }
      await prisma.formLead.update({
        where: { id },
        data: { status: 'received', error: null },
      });
      await enqueueFormLead({ formLeadId: id });
      return { success: true };
    },
  );
};
