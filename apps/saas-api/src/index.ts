// Voxly SaaS API — main entry point
// Control plane: auth, billing, provisioning, admin

import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@voxly/db';
import { RobokassaClient } from '@voxly/billing';
import { TwentyClient } from '@voxly/twenty-client';
import { PRICING } from '@voxly/shared';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { tenantRoutes } from './routes/tenant.js';
import { adminRoutes } from './routes/admin.js';
import { adminReferralRoutes } from './routes/admin-referrals.js';
import { adminPlatformBotRoutes } from './routes/admin-platform-bot.js';
import { adminPricingRoutes } from './routes/admin-pricing.js';
import { adminServicesRoutes } from './routes/admin-services.js';
import { adminAiBalanceRoutes } from './routes/admin-ai-balance.js';
import { publicPricingRoutes } from './routes/public-pricing.js';
import { platformBotInternalRoutes } from './routes/platform-bot-internal.js';
import { referralRoutes } from './routes/referral.js';
import { botRoutes } from './routes/bots.js';
import { gramjsRoutes } from './routes/gramjs.js';
import { maxRoutes } from './routes/max.js';
import { maxInternalRoutes } from './routes/max-internal.js';
import { gramjsInternalRoutes } from './routes/gramjs-internal.js';
import { crmEnrichInternalRoutes } from './routes/crm-enrich-internal.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { aiAgentRoutes } from './routes/ai-agents.js';
import { audienceRoutes } from './routes/audience.js';
import { analyticsRoutes } from './routes/analytics.js';
import { metricsRoutes } from './routes/metrics.js';
import { crmChatRoutes } from './routes/crm-chat.js';
import { formsRoutes, formWebhookRoutes } from './routes/forms.js';
import { openTgRoutes } from './routes/open-tg.js';
import { openMaxRoutes } from './routes/open-max.js';
import { startScheduledJobs } from './jobs/scheduler.js';
import { assertCrmAccessAllowed } from './services/crm-access.js';
import './jobs/queues.js'; // Start BullMQ workers (skipped when VOXLY_DISABLE_WORKERS=1)

const PORT = parseInt(process.env.API_PORT || '3002', 10);
const VOXLY_DOMAIN = process.env.VOXLY_DOMAIN || 'getvoxly.ru';

function isAllowedCorsOrigin(origin: string): boolean {
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  if (origin === `https://${VOXLY_DOMAIN}` || origin === `https://www.${VOXLY_DOMAIN}`) return true;
  const escaped = VOXLY_DOMAIN.replace(/\./g, '\\.');
  return new RegExp(`^https://[a-z0-9-]+\\.${escaped}(?::\\d+)?$`).test(origin);
}

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    // Signed CRM media tokens are base64url.payload.sig — well over Fastify's
    // default maxParamLength (100), which otherwise 404s /media/:token (INC-063).
    maxParamLength: 8192,
    // Gift media uploads (photo/video → Telegram file_id) up to ~48MB multipart.
    bodyLimit: 52 * 1024 * 1024,
    // Large video → Telegram can exceed default idle timeouts.
    connectionTimeout: 0,
    requestTimeout: 0,
    keepAliveTimeout: 72_000,
  });

  // --- CORS (portal + Twenty CRM subdomain / localhost) ---
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || isAllowedCorsOrigin(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // --- JWT ---
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === 'production' && (!jwtSecret || jwtSecret === 'dev-secret-change-me')) {
    throw new Error(
      'FATAL: JWT_SECRET must be set to a secure secret in production (cannot use default dev-secret-change-me).',
    );
  }
  await fastify.register(jwt, {
    secret: jwtSecret || 'dev-secret-change-me',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  });

  // --- Rate limiting ---
  await fastify.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // --- Shared services on instance ---
  const hashAlgRaw = (process.env.ROBOKASSA_HASH_ALG || 'sha256').toLowerCase();
  const robokassaHashAlgorithm = hashAlgRaw === 'md5' ? 'md5' : 'sha256';
  const robokassaLogin = (process.env.ROBOKASSA_LOGIN || '').trim();
  const robokassa = new RobokassaClient({
    merchantLogin: robokassaLogin,
    password1: process.env.ROBOKASSA_PASSWORD1 || '',
    password2: process.env.ROBOKASSA_PASSWORD2 || '',
    isTest: process.env.ROBOKASSA_IS_TEST === '1',
    hashAlgorithm: robokassaHashAlgorithm,
  });
  if (!robokassaLogin || !process.env.ROBOKASSA_PASSWORD1 || !process.env.ROBOKASSA_PASSWORD2) {
    console.warn(
      '[saas-api] ROBOKASSA_LOGIN / PASSWORD1 / PASSWORD2 incomplete — checkout will fail signatures',
    );
  }

  const twentyClient = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    apiKey: process.env.TWENTY_API_KEY,
  });

  fastify.decorate('prisma', prisma);
  fastify.decorate('robokassa', robokassa);
  fastify.decorate('twenty', twentyClient);
  fastify.decorate('voxlyDomain', VOXLY_DOMAIN);

  // Robokassa ResultURL sends application/x-www-form-urlencoded
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const raw = typeof body === 'string' ? body : String(body ?? '');
        done(null, Object.fromEntries(new URLSearchParams(raw)));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Portal DELETE/POST without body may still send Content-Type: application/json
  // (legacy authHeaders). Treat empty body as {}.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const raw = typeof body === 'string' ? body : String(body ?? '');
        if (!raw.trim()) {
          done(null, {});
          return;
        }
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // --- Auth decorator ---
  // Portal JWT, short-lived crm-chat JWT, or Twenty app service token
  // (Authorization: Bearer VOXLY_SERVICE_TOKEN + X-Twenty-Workspace-Id).
  const serviceToken = process.env.VOXLY_SERVICE_TOKEN || '';

  async function rejectIfCrmLocked(tenantId: string, reply: any): Promise<boolean> {
    const denied = await assertCrmAccessAllowed(prisma, tenantId);
    if (!denied) return false;
    reply.code(denied.code || 403).send({
      error: denied.error || 'CRM access locked',
      reason: denied.reason,
      crmAccessLocked: true,
    });
    return true;
  }

  function isCrmChatRequest(request: { url?: string; routerPath?: string }): boolean {
    const path = String(request.routerPath || request.url || '');
    return path.includes('/crm/chat');
  }

  fastify.decorate('authenticate', async (request: any, reply: any) => {
    const authHeader = String(request.headers.authorization || '');
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

    if (serviceToken && bearer && bearer === serviceToken) {
      const workspaceId = String(
        request.headers['x-twenty-workspace-id'] || '',
      ).trim();
      if (!workspaceId) {
        return reply.code(401).send({
          error: 'Unauthorized',
          detail: 'X-Twenty-Workspace-Id required for service token',
        });
      }
      const tenant = await prisma.tenant.findFirst({
        where: { twentyWorkspaceId: workspaceId },
        select: { id: true, status: true },
      });
      if (!tenant) {
        return reply.code(401).send({
          error: 'Unauthorized',
          detail: 'Unknown Twenty workspace',
        });
      }
      if (await rejectIfCrmLocked(tenant.id, reply)) return;
      request.user = {
        sub: 'twenty-app',
        role: 'member',
        tenantRole: 'owner',
        tenantId: tenant.id,
        purpose: 'crm-service',
      };
      return;
    }

    try {
      await request.jwtVerify();
      if (isCrmChatRequest(request) && request.user?.tenantId) {
        if (await rejectIfCrmLocked(request.user.tenantId, reply)) return;
      }
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.decorate('requireSuperadmin', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'superadmin') {
        reply.code(403).send({ error: 'Forbidden: superadmin only' });
      }
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // --- Health check ---
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Public HTTPS → tg://user?id=… (Person Telegram LINKS without @username)
  await fastify.register(openTgRoutes, { prefix: '/open' });
  await fastify.register(openMaxRoutes, { prefix: '/open' });

  // --- Routes ---
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(publicPricingRoutes, { prefix: '/api/pricing' });
  await fastify.register(billingRoutes, { prefix: '/api/billing' });
  await fastify.register(tenantRoutes, { prefix: '/api/tenant' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(adminReferralRoutes, { prefix: '/api/admin/referrals' });
  await fastify.register(adminPlatformBotRoutes, { prefix: '/api/admin/platform-bot' });
  await fastify.register(adminPricingRoutes, { prefix: '/api/admin' });
  await fastify.register(adminServicesRoutes, { prefix: '/api/admin' });
  await fastify.register(adminAiBalanceRoutes, { prefix: '/api/admin' });
  await fastify.register(platformBotInternalRoutes, { prefix: '/api/internal/platform-bot' });
  await fastify.register(referralRoutes, { prefix: '/api/referrals' });
  await fastify.register(botRoutes, { prefix: '/api/bots' });
  await fastify.register(gramjsRoutes, { prefix: '/api/bots/gramjs' });
  await fastify.register(maxRoutes, { prefix: '/api/bots/max' });
  await fastify.register(maxInternalRoutes, { prefix: '/api/internal/max' });
  await fastify.register(gramjsInternalRoutes, { prefix: '/api/internal/gramjs' });
  await fastify.register(crmEnrichInternalRoutes, { prefix: '/api/internal/crm' });
  await fastify.register(whatsappRoutes, { prefix: '/api/bots/whatsapp' });
  await fastify.register(aiAgentRoutes, { prefix: '/api/ai/agents' });
  await fastify.register(audienceRoutes, { prefix: '/api/audience' });
  await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
  await fastify.register(metricsRoutes, { prefix: '/api/admin' });
  await fastify.register(crmChatRoutes, { prefix: '/api/crm/chat' });
  await fastify.register(formsRoutes, { prefix: '/api/forms' });
  await fastify.register(formWebhookRoutes, { prefix: '/api/webhooks/forms' });

  return fastify;
}

async function main() {
  try {
    const server = await buildServer();
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`Voxly API running on port ${PORT}`);

    // Start BullMQ scheduled jobs (grace period checker, etc.)
    startScheduledJobs();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main();
}
