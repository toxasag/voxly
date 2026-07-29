// GramJS proxy — portal JWT auth → internal bridge with VOXLY_SERVICE_TOKEN.
// Browser never talks to gramjs-bridge directly.

import type { FastifyPluginAsync } from 'fastify';
import { PRICING, PRODUCT_CODES, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { startChannelTrial, trialMeta } from '../services/channel-trial.js';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

function bridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
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

    return reply.send({
      ok: true,
      priceMonthly: PRICING.AI_GRAMJS_MONTHLY,
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
          ? `Доступен пробный период ${TRIAL_PERIOD_DAYS} дней, затем ${PRICING.AI_GRAMJS_MONTHLY} ₽/мес.`
          : `Тариф «Личный Telegram» (${PRICING.AI_GRAMJS_MONTHLY} ₽/мес) не активен. Оформите оплату.`,
      requiresPayment: !addonActive,
      accounts: bots.map((b) => ({
        id: b.id,
        name: b.botUsername || 'default',
        telegramUserId: b.phoneNumberId,
        status: b.status,
        connected: Boolean(b.botTokenEncrypted),
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
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
      return reply.code(402).send({
        error: 'payment_required',
        message: `Оплатите тариф «Личный Telegram» (${PRICING.AI_GRAMJS_MONTHLY} ₽/мес) или запустите trial`,
        productCode: PRODUCT_CODES.AI_GRAMJS,
        priceMonthly: PRICING.AI_GRAMJS_MONTHLY,
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
