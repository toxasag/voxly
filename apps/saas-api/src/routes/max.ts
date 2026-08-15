// MAX personal account proxy — portal JWT → max-bridge with VOXLY_SERVICE_TOKEN.
// Browser never talks to max-bridge directly. Pattern mirrors gramjs.ts (ADR-025).

import type { FastifyPluginAsync } from 'fastify';
import { PRODUCT_CODES, TRIAL_PERIOD_DAYS, resolveServiceToken } from '@voxly/shared';
import { startChannelTrial, trialMeta } from '../services/channel-trial.js';
import { runMaxPrivateChatSync } from '../services/max-chat-sync.js';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

function bridgeBase(): string {
  return (process.env.MAX_BRIDGE_URL || 'http://max-bridge:3010').replace(/\/$/, '');
}

function serviceToken(): string {
  return resolveServiceToken('max-bridge');
}

/** In-process MAX history-sync jobs (avoid nginx/browser timeout). */
type MaxHistorySyncJob = {
  startedAt: number;
  done: boolean;
  summary?: {
    ok: boolean;
    dialogs?: number;
    messagesUpserted?: number;
    peopleCreated?: number;
    opportunitiesCreated?: number;
    skippedSuppressed?: number;
    error?: string;
  };
  error?: string;
};

const maxHistorySyncJobs = new Map<string, MaxHistorySyncJob>();

function maxHistorySyncState(botId: string): {
  historySyncing: boolean;
  historySyncStartedAt: string | null;
  historySyncResult: MaxHistorySyncJob['summary'] | null;
} {
  const job = maxHistorySyncJobs.get(botId);
  if (!job) {
    return {
      historySyncing: false,
      historySyncStartedAt: null,
      historySyncResult: null,
    };
  }
  return {
    historySyncing: !job.done,
    historySyncStartedAt: new Date(job.startedAt).toISOString(),
    historySyncResult: job.done ? job.summary || null : null,
  };
}

async function bridgeFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json?: any; buffer?: Buffer; contentType?: string }> {
  const token = serviceToken();
  if (!token) {
    return { status: 503, json: { ok: false, error: 'VOXLY_SERVICE_TOKEN not configured' } };
  }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${bridgeBase()}${path}`, { ...init, headers });
  } catch (err) {
    return {
      status: 503,
      json: {
        ok: false,
        error: 'max-bridge unavailable',
        detail: String((err as Error)?.message || err),
        hint: 'Поднимите профиль: docker compose --profile max up -d max-bridge',
      },
    };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('image/')) {
    const ab = await res.arrayBuffer();
    return { status: res.status, buffer: Buffer.from(ab), contentType };
  }
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid bridge response' }));
  return { status: res.status, json, contentType };
}

export const maxRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/accounts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const [bots, addon] = await Promise.all([
      prisma.botInstance.findMany({
        where: { tenantId, botType: 'ai_max' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          botUsername: true,
          displayName: true,
          phoneNumberId: true,
          status: true,
          botTokenEncrypted: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_MAX } },
      }),
    ]);

    const meta = trialMeta(addon);
    const addonActive = meta.isActive;
    const { resolveUnitPrice } = await import('../services/platform-pricing.js');
    const priceMonthly = await resolveUnitPrice(
      fastify.prisma,
      tenantId,
      PRODUCT_CODES.AI_MAX,
    );

    return reply.send({
      ok: true,
      priceMonthly,
      trialDays: TRIAL_PERIOD_DAYS,
      bridgeConfigured: Boolean(serviceToken()),
      maxAddon: addon
        ? {
            status: addon.status,
            activeUntil: addon.activeUntil,
            isActive: addonActive,
            isTrial: meta.isTrial,
          }
        : null,
      trialAvailable: meta.trialAvailable,
      billingWarning: addonActive
        ? null
        : meta.trialAvailable
          ? `Доступен пробный период ${TRIAL_PERIOD_DAYS} дней, затем ${priceMonthly} ₽/мес.`
          : `Тариф «MAX (личный)» (${priceMonthly} ₽/мес) не активен. Оформите оплату.`,
      requiresPayment: !addonActive,
      accounts: bots.map((b) => {
        const sync = maxHistorySyncState(b.id);
        return {
          id: b.id,
          name: b.displayName || b.botUsername || 'default',
          maxUserId: b.phoneNumberId,
          status: b.status,
          connected: Boolean(b.botTokenEncrypted),
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          historySyncing: sync.historySyncing,
          historySyncStartedAt: sync.historySyncStartedAt,
          historySyncResult: sync.historySyncResult,
        };
      }),
    });
  });

  fastify.post('/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start MAX trial' });
    }

    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.AI_MAX);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error });
    }

    return reply.send({
      ok: true,
      addon: {
        type: result.addon.type,
        status: result.addon.status,
        activeUntil: result.addon.activeUntil,
        isTrial: true,
        days: result.days,
      },
    });
  });

  fastify.post('/auth/qr/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can connect MAX' });
    }
    const addon = await fastify.prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_MAX } },
    });
    const addonActive = Boolean(addon && addon.status === 'active' && addon.activeUntil > new Date());
    if (!addonActive) {
      const { resolveUnitPrice } = await import('../services/platform-pricing.js');
      const priceMonthly = await resolveUnitPrice(
        fastify.prisma,
        tenantId,
        PRODUCT_CODES.AI_MAX,
      );
      return reply.code(402).send({
        error: 'payment_required',
        message: `Оплатите тариф «MAX (личный)» (${priceMonthly} ₽/мес) или запустите trial`,
        productCode: PRODUCT_CODES.AI_MAX,
        priceMonthly,
      });
    }
    const body = (request.body || {}) as { name?: string };
    const name = String(body.name || 'default').trim() || 'default';

    const result = await bridgeFetch('/auth/qr/start', {
      method: 'POST',
      body: JSON.stringify({ tenantId, name }),
    });
    return reply.code(result.status).send(result.json);
  });

  fastify.get('/auth/qr/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { name?: string };
    const name = String(q.name || 'default').trim() || 'default';
    const result = await bridgeFetch(
      `/auth/qr/status?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`,
    );
    return reply.code(result.status).send(result.json);
  });

  fastify.get('/auth/qr/png', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { name?: string };
    const name = String(q.name || 'default').trim() || 'default';
    const result = await bridgeFetch(
      `/auth/qr/png?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`,
    );
    if (result.buffer) {
      return reply
        .code(result.status)
        .header('Content-Type', result.contentType || 'image/png')
        .header('Cache-Control', 'no-store')
        .send(result.buffer);
    }
    return reply.code(result.status).send(result.json);
  });

  fastify.post('/auth/qr/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can submit 2FA' });
    }
    const body = (request.body || {}) as { name?: string; password?: string };
    const name = String(body.name || 'default').trim() || 'default';
    const password = String(body.password || '');

    const result = await bridgeFetch('/auth/qr/password', {
      method: 'POST',
      body: JSON.stringify({ tenantId, name, password }),
    });
    return reply.code(result.status).send(result.json);
  });

  fastify.post('/sessions/connect', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = (request.body || {}) as { botId?: string };
    const botId = String(body.botId || '').trim();
    if (!botId) return reply.code(400).send({ error: 'botId required' });

    const bot = await fastify.prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'ai_max' },
      select: { id: true },
    });
    if (!bot) return reply.code(404).send({ error: 'account not found' });

    const result = await bridgeFetch('/sessions/connect', {
      method: 'POST',
      body: JSON.stringify({ botId }),
    });
    return reply.code(result.status).send(result.json);
  });

  /**
   * Manual private-dialog CRM sync (no QR).
   * Bridge `/crm/private-dialogs` → Conversation/ChatMessage + Person/Opportunity.
   * Reuses open Opportunity per Person (dupe guard). Long job → 202 + poll GET /accounts.
   */
  fastify.post(
    '/accounts/:botId/sync-history',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can sync MAX history' });
      }
      const { botId } = request.params as { botId: string };
      const body = (request.body || {}) as {
        dialogLimit?: number;
        messageLimit?: number;
      };
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_max' },
        select: { id: true, status: true, botTokenEncrypted: true },
      });
      if (!bot) return reply.code(404).send({ ok: false, error: 'account not found' });
      if (!bot.botTokenEncrypted || bot.status !== 'active') {
        return reply.code(400).send({
          ok: false,
          error: 'account_not_connected',
          message: 'Сначала подключите аккаунт (QR).',
        });
      }

      const dialogLimit =
        typeof body.dialogLimit === 'number' && body.dialogLimit > 0
          ? Math.floor(body.dialogLimit)
          : 0;
      const messageLimit =
        typeof body.messageLimit === 'number' && body.messageLimit > 0
          ? Math.floor(body.messageLimit)
          : 30;

      const existing = maxHistorySyncJobs.get(botId);
      if (existing && !existing.done) {
        return reply.send({
          ok: true,
          started: true,
          alreadyRunning: true,
          historySyncStartedAt: new Date(existing.startedAt).toISOString(),
        });
      }

      const startedAt = Date.now();
      maxHistorySyncJobs.set(botId, { startedAt, done: false });
      void runMaxPrivateChatSync({
        prisma: fastify.prisma,
        tenantId,
        botId,
        dialogLimit,
        messageLimit,
      })
        .then((summary) => {
          maxHistorySyncJobs.set(botId, {
            startedAt,
            done: true,
            summary,
          });
          setTimeout(() => {
            const cur = maxHistorySyncJobs.get(botId);
            if (cur?.done && cur.startedAt === startedAt) {
              maxHistorySyncJobs.delete(botId);
            }
          }, 10 * 60 * 1000);
        })
        .catch((err) => {
          maxHistorySyncJobs.set(botId, {
            startedAt,
            done: true,
            summary: {
              ok: false,
              dialogs: 0,
              messagesUpserted: 0,
              peopleCreated: 0,
              opportunitiesCreated: 0,
              skippedSuppressed: 0,
              error: String(err?.message || err),
            },
            error: String(err?.message || err),
          });
        });

      return reply.code(202).send({
        ok: true,
        started: true,
        historySyncStartedAt: new Date(startedAt).toISOString(),
      });
    },
  );

  fastify.delete(
    '/accounts/:botId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can delete MAX accounts' });
      }
      const { botId } = request.params as { botId: string };
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_max' },
        select: { id: true },
      });
      if (!bot) return reply.code(404).send({ ok: false, error: 'account not found' });

      const result = await bridgeFetch('/accounts/delete', {
        method: 'POST',
        body: JSON.stringify({ tenantId, botId }),
      });
      if (result.status >= 300 || !result.json?.ok) {
        await fastify.prisma.conversation.updateMany({
          where: { botInstanceId: botId },
          data: { botInstanceId: null },
        });
        try {
          await fastify.prisma.botInstance.delete({ where: { id: botId } });
          return reply.send({ ok: true, botId, sessionCleared: false, localOnly: true });
        } catch {
          await fastify.prisma.botInstance.update({
            where: { id: botId },
            data: { status: 'inactive', botTokenEncrypted: null, phoneNumberId: null },
          });
          return reply.send({ ok: true, botId, sessionCleared: false, softDeleted: true });
        }
      }
      return reply.code(result.status).send(result.json);
    },
  );
};
