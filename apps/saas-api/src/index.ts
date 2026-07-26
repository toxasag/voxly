// Voxly SaaS API — main entry point
// Control plane: auth, billing, provisioning, admin

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
import { referralRoutes } from './routes/referral.js';
import { botRoutes } from './routes/bots.js';
import { gramjsRoutes } from './routes/gramjs.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { aiAgentRoutes } from './routes/ai-agents.js';
import { audienceRoutes } from './routes/audience.js';
import { analyticsRoutes } from './routes/analytics.js';
import { crmChatRoutes } from './routes/crm-chat.js';
import { startScheduledJobs } from './jobs/scheduler.js';
import './jobs/queues.js'; // Start BullMQ workers

const PORT = parseInt(process.env.API_PORT || '3002', 10);
const VOXLY_DOMAIN = process.env.VOXLY_DOMAIN || 'getvoxly.ru';

function isAllowedCorsOrigin(origin: string): boolean {
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  if (origin === `https://${VOXLY_DOMAIN}` || origin === `https://www.${VOXLY_DOMAIN}`) return true;
  const escaped = VOXLY_DOMAIN.replace(/\./g, '\\.');
  return new RegExp(`^https://[a-z0-9-]+\\.${escaped}(?::\\d+)?$`).test(origin);
}

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    // Signed CRM media tokens are base64url.payload.sig — well over Fastify's
    // default maxParamLength (100), which otherwise 404s /media/:token (INC-063).
    maxParamLength: 8192,
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
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  });

  // --- Rate limiting ---
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Stricter for auth routes
    keyGenerator: (req) => req.ip,
  });

  // --- Shared services on instance ---
  const robokassa = new RobokassaClient({
    merchantLogin: process.env.ROBOKASSA_LOGIN || '',
    password1: process.env.ROBOKASSA_PASSWORD1 || '',
    password2: process.env.ROBOKASSA_PASSWORD2 || '',
    isTest: process.env.ROBOKASSA_IS_TEST === '1',
  });

  const twentyClient = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    apiKey: process.env.TWENTY_API_KEY,
  });

  fastify.decorate('prisma', prisma);
  fastify.decorate('robokassa', robokassa);
  fastify.decorate('twenty', twentyClient);
  fastify.decorate('voxlyDomain', VOXLY_DOMAIN);

  // --- Auth decorator ---
  // Portal JWT, short-lived crm-chat JWT, or Twenty app service token
  // (Authorization: Bearer VOXLY_SERVICE_TOKEN + X-Twenty-Workspace-Id).
  const serviceToken = process.env.VOXLY_SERVICE_TOKEN || '';
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
      if (tenant.status === 'suspended') {
        return reply.code(403).send({ error: 'Tenant suspended' });
      }
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

  // --- Routes ---
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(billingRoutes, { prefix: '/api/billing' });
  await fastify.register(tenantRoutes, { prefix: '/api/tenant' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(referralRoutes, { prefix: '/api/referrals' });
  await fastify.register(botRoutes, { prefix: '/api/bots' });
  await fastify.register(gramjsRoutes, { prefix: '/api/bots/gramjs' });
  await fastify.register(whatsappRoutes, { prefix: '/api/bots/whatsapp' });
  await fastify.register(aiAgentRoutes, { prefix: '/api/ai/agents' });
  await fastify.register(audienceRoutes, { prefix: '/api/audience' });
  await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
  await fastify.register(crmChatRoutes, { prefix: '/api/crm/chat' });

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

main();
