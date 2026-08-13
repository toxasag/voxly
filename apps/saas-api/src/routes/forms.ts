/**
 * Web form lead intake — public webhook + tenant CRUD.
 * POST /api/webhooks/forms/:token — Tilda / WordPress / JSON (no JWT)
 * /api/forms/* — portal JWT
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';
import { phoneFingerprint } from '@voxly/twenty-client';
import {
  parseFormWebhookBody,
  sanitizeRawFields,
  buildDedupeFingerprint,
  parseClientTs,
} from '../services/form-lead-parse.js';
import { enqueueFormLead } from '../jobs/queues.js';

/** Dedicated Redis client for webhook idempotency (4.1). Lazy — never blocks route boot. */
const FORMS_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const formsRedis = new IORedis(FORMS_REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

/** Webhook idempotency window: collapse identical resubmissions (4.1). */
const FORM_DEDUPE_TTL_SEC = 10 * 60;

/**
 * Claim a dedupe fingerprint via Redis SET NX EX. Returns true when this is the
 * first delivery in the window, false when it is a duplicate. Fails OPEN (true)
 * on Redis error — the DB unique index (endpointId, dedupeFingerprint) is the backstop.
 */
async function claimFormFingerprint(fingerprint: string): Promise<boolean> {
  try {
    const ok = await formsRedis.set(
      `forms:dedupe:${fingerprint}`,
      '1',
      'EX',
      FORM_DEDUPE_TTL_SEC,
      'NX',
    );
    return ok === 'OK';
  } catch (err) {
    console.warn('[forms] fingerprint claim failed (fail-open)', err);
    return true;
  }
}

/** Best-effort client IP behind Traefik/CDN: first X-Forwarded-For hop, else socket. */
function clientIpOf(request: {
  headers: Record<string, unknown>;
  ip?: string;
}): string | undefined {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0]!.trim();
  }
  const real = request.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return request.ip;
}

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

      // 4.2 client analytics: UA / IP / client submit ts.
      const userAgent =
        (request.headers['user-agent'] as string | undefined)?.slice(0, 500) ||
        null;
      const ipAddress = clientIpOf(request as any)?.slice(0, 64) || null;
      const clientTs = parseClientTs(normalized.clientTs) || null;
      const phoneFp = phoneFingerprint(normalized.phone) || null;

      // 4.1 idempotency: when no stable externalId, dedupe by content fingerprint.
      const dedupeFingerprint = normalized.externalId
        ? null
        : buildDedupeFingerprint({
            endpointId: endpoint.id,
            phone: normalized.phone,
            email: normalized.email,
            formId: normalized.formId,
          }) || null;
      if (dedupeFingerprint) {
        const fresh = await claimFormFingerprint(dedupeFingerprint);
        if (!fresh) {
          // Duplicate within the 10-min window — ACK without creating a lead.
          return reply.code(200).type('text/plain').send('ok');
        }
      }

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
            userAgent,
            ipAddress,
            clientTs,
            msclkid: normalized.attribution.msclkid || null,
            phoneFingerprint: phoneFp,
            dedupeFingerprint,
          },
        });
      } catch (err: any) {
        // Unique (tenantId, source, externalId) or (endpointId, dedupeFingerprint) → duplicate
        if (err?.code === 'P2002') {
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
          userAgent: true,
          ipAddress: true,
          clientTs: true,
          msclkid: true,
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

  // Interaction history (4.3): timeline for a Person or a phone fingerprint.
  fastify.get(
    '/activity',
    { preHandler: [(fastify as any).authenticate] },
    async (request: any, reply) => {
      const tenantId = request.user.tenantId as string;
      const q = request.query as {
        personId?: string;
        phone?: string;
        limit?: string;
      };
      const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
      const fp = q.phone ? phoneFingerprint(q.phone) : undefined;
      if (!q.personId && !fp) {
        return reply.code(400).send({ error: 'personId or phone required' });
      }
      const or = [
        q.personId ? { twentyPersonId: q.personId } : undefined,
        fp ? { phoneFingerprint: fp } : undefined,
      ].filter(Boolean) as any[];
      const activities = await prisma.customerActivity.findMany({
        where: { tenantId, OR: or },
        orderBy: { occurredAt: 'desc' },
        take: limit,
        select: {
          id: true,
          kind: true,
          channel: true,
          title: true,
          description: true,
          meta: true,
          twentyPersonId: true,
          formLeadId: true,
          occurredAt: true,
        },
      });
      return { activities };
    },
  );
};
