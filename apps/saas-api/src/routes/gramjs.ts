// GramJS proxy — portal JWT auth → internal bridge with VOXLY_SERVICE_TOKEN.
// Browser never talks to gramjs-bridge directly.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PRICING, PRODUCT_CODES, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { startChannelTrial, trialMeta } from '../services/channel-trial.js';
import { runGramjsPrivateChatSync } from '../services/gramjs-chat-sync.js';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

function bridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

/** In-process GramJS history-sync jobs (long-running; avoid nginx/browser timeout). */
type GramjsHistorySyncJob = {
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

const gramjsHistorySyncJobs = new Map<string, GramjsHistorySyncJob>();

function gramjsHistorySyncState(botId: string): {
  historySyncing: boolean;
  historySyncStartedAt: string | null;
  historySyncResult: GramjsHistorySyncJob['summary'] | null;
} {
  const job = gramjsHistorySyncJobs.get(botId);
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
        error: 'gramjs-bridge unavailable',
        detail: String((err as Error)?.message || err),
        hint: 'Поднимите профиль: docker compose --profile gramjs up -d gramjs-bridge',
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

export const gramjsRoutes: FastifyPluginAsync = async (fastify) => {
  // --- List personal Telegram (ai_gramjs) accounts for tenant ---
  fastify.get('/accounts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const [bots, addon] = await Promise.all([
      prisma.botInstance.findMany({
        where: { tenantId, botType: 'ai_gramjs' },
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
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_GRAMJS } },
      }),
    ]);

    const meta = trialMeta(addon);
    const addonActive = meta.isActive;
    const { resolveUnitPrice } = await import('../services/platform-pricing.js');
    const priceMonthly = await resolveUnitPrice(
      fastify.prisma,
      tenantId,
      PRODUCT_CODES.AI_GRAMJS,
    );

    return reply.send({
      ok: true,
      priceMonthly,
      trialDays: TRIAL_PERIOD_DAYS,
      bridgeConfigured: Boolean(serviceToken()),
      gramjsAddon: addon
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
          : `Тариф «Личный Telegram» (${priceMonthly} ₽/мес) не активен. Оформите оплату.`,
      requiresPayment: !addonActive,
      accounts: bots.map((b) => {
        const sync = gramjsHistorySyncState(b.id);
        return {
          id: b.id,
          name: (b.displayName || '').trim() || b.botUsername || 'default',
          displayName: (b.displayName || '').trim() || null,
          username: b.botUsername,
          telegramUserId: b.phoneNumberId,
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

  // --- One-shot trial for ai_gramjs (TRIAL_PERIOD_DAYS) ---
  fastify.post('/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start GramJS trial' });
    }

    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.AI_GRAMJS);
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
      return reply.code(403).send({ error: 'Only owners can connect Telegram' });
    }
    const addon = await fastify.prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_GRAMJS } },
    });
    const addonActive = Boolean(addon && addon.status === 'active' && addon.activeUntil > new Date());
    if (!addonActive) {
      const { resolveUnitPrice } = await import('../services/platform-pricing.js');
      const priceMonthly = await resolveUnitPrice(
        fastify.prisma,
        tenantId,
        PRODUCT_CODES.AI_GRAMJS,
      );
      return reply.code(402).send({
        error: 'payment_required',
        message: `Оплатите тариф «Личный Telegram» (${priceMonthly} ₽/мес) или запустите trial`,
        productCode: PRODUCT_CODES.AI_GRAMJS,
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
      where: { id: botId, tenantId, botType: 'ai_gramjs' },
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
   * Manual private-dialog CRM sync (no QR reconnect).
   * Same engine as connect/enrich job step 1: bridge `/crm/private-dialogs`
   * → Conversation/ChatMessage + People/Opportunities (all private × 30 msgs).
   */
  fastify.post(
    '/accounts/:botId/sync-history',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can sync Telegram history' });
      }
      const { botId } = request.params as { botId: string };
      const body = (request.body || {}) as {
        dialogLimit?: number;
        messageLimit?: number;
      };
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_gramjs' },
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
          : 0; // 0 = all private
      const messageLimit =
        typeof body.messageLimit === 'number' && body.messageLimit > 0
          ? Math.floor(body.messageLimit)
          : 30;

      const existing = gramjsHistorySyncJobs.get(botId);
      if (existing && !existing.done) {
        return reply.send({
          ok: true,
          started: true,
          alreadyRunning: true,
          historySyncStartedAt: new Date(existing.startedAt).toISOString(),
        });
      }

      // Long sync (flood waits) — run in background so portal/nginx do not time out
      // and UI can show «Синхронизация…» via GET /accounts historySyncing.
      const startedAt = Date.now();
      gramjsHistorySyncJobs.set(botId, { startedAt, done: false });
      void runGramjsPrivateChatSync({
        prisma: fastify.prisma,
        tenantId,
        botId,
        dialogLimit,
        messageLimit,
      })
        .then((summary) => {
          gramjsHistorySyncJobs.set(botId, {
            startedAt,
            done: true,
            summary: {
              ok: summary.ok,
              dialogs: summary.dialogs,
              messagesUpserted: summary.messagesUpserted,
              peopleCreated: summary.peopleCreated,
              opportunitiesCreated: summary.opportunitiesCreated,
              skippedSuppressed: summary.skippedSuppressed,
              error: summary.error,
            },
          });
          // Drop finished job after 30m so accounts list stays lean.
          setTimeout(() => {
            const cur = gramjsHistorySyncJobs.get(botId);
            if (cur && cur.done && cur.startedAt === startedAt) {
              gramjsHistorySyncJobs.delete(botId);
            }
          }, 30 * 60 * 1000).unref?.();
        })
        .catch((err) => {
          gramjsHistorySyncJobs.set(botId, {
            startedAt,
            done: true,
            summary: {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            error: err instanceof Error ? err.message : String(err),
          });
        });

      return reply.code(202).send({
        ok: true,
        started: true,
        historySyncStartedAt: new Date(startedAt).toISOString(),
      });
    },
  );

  fastify.patch(
    '/accounts/:botId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can rename Telegram accounts' });
      }
      const { botId } = request.params as { botId: string };
      const body = z
        .object({
          displayName: z.string().max(80),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }
      const displayName = body.data.displayName.trim() || null;
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_gramjs' },
        select: { id: true, botUsername: true, displayName: true },
      });
      if (!bot) return reply.code(404).send({ ok: false, error: 'account not found' });

      const updated = await fastify.prisma.botInstance.update({
        where: { id: bot.id },
        data: { displayName },
        select: {
          id: true,
          botUsername: true,
          displayName: true,
          phoneNumberId: true,
          status: true,
          updatedAt: true,
        },
      });
      return reply.send({
        ok: true,
        account: {
          id: updated.id,
          name: (updated.displayName || '').trim() || updated.botUsername || 'default',
          displayName: (updated.displayName || '').trim() || null,
          username: updated.botUsername,
          telegramUserId: updated.phoneNumberId,
          status: updated.status,
          updatedAt: updated.updatedAt,
        },
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
        return reply.code(403).send({ error: 'Only owners can delete Telegram accounts' });
      }
      const { botId } = request.params as { botId: string };
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_gramjs' },
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
