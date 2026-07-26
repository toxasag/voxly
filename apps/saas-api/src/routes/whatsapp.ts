// WhatsApp (Evolution) proxy — portal JWT → ai-whatsapp-worker with VOXLY_SERVICE_TOKEN.
// Browser never talks to Evolution or the worker directly.

import type { FastifyPluginAsync } from 'fastify';
import { PRICING, PRODUCT_CODES } from '@voxly/shared';
import { startChannelTrial, trialMeta } from '../services/channel-trial.js';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

function workerBase(): string {
  return (process.env.AI_WHATSAPP_WORKER_URL || 'http://ai-whatsapp-worker:3006').replace(
    /\/$/,
    '',
  );
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

async function workerFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: any }> {
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
    res = await fetch(`${workerBase()}${path}`, { ...init, headers });
  } catch (err) {
    return {
      status: 503,
      json: {
        ok: false,
        error: 'ai-whatsapp-worker unavailable',
        detail: String((err as Error)?.message || err),
        hint: 'Поднимите ai-whatsapp-worker и evolution-api (profile whatsapp).',
      },
    };
  }
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid worker response' }));
  return { status: res.status, json };
}

function accountLabel(b: {
  displayName?: string | null;
  botUsername?: string | null;
}): string {
  const label = String(b.displayName || '').trim();
  if (label) return label;
  return b.botUsername || 'default';
}

/** Never-scanned junk: inactive, no phone, underscore-only / empty slug. */
function isNeverConnectedStub(b: {
  status: string;
  phoneNumberId: string | null;
  botUsername: string | null;
}): boolean {
  if (b.status === 'active') return false;
  if (b.phoneNumberId) return false;
  const slug = String(b.botUsername || '').trim();
  return !slug || /^_+$/.test(slug);
}

export const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/accounts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    // One-shot prune of underscore-only never-connected stubs for this tenant.
    const stubs = await prisma.botInstance.findMany({
      where: {
        tenantId,
        botType: 'ai_wa',
        status: { not: 'active' },
        phoneNumberId: null,
      },
      select: { id: true, status: true, phoneNumberId: true, botUsername: true },
    });
    const pruneIds = stubs.filter(isNeverConnectedStub).map((s) => s.id);
    let pruned = 0;
    for (const botId of pruneIds) {
      const del = await workerFetch('/internal/accounts/delete', {
        method: 'POST',
        body: JSON.stringify({ tenantId, botId }),
      });
      if (del.status < 300 && del.json?.ok) pruned += 1;
      else {
        // Fallback: soft-clear locally if worker unavailable
        await prisma.conversation.updateMany({
          where: { botInstanceId: botId },
          data: { botInstanceId: null },
        });
        try {
          await prisma.botInstance.delete({ where: { id: botId } });
          pruned += 1;
        } catch {
          await prisma.botInstance.update({
            where: { id: botId },
            data: { status: 'inactive', botTokenEncrypted: null },
          });
        }
      }
    }

    const [bots, addon, cfg] = await Promise.all([
      prisma.botInstance.findMany({
        where: {
          tenantId,
          botType: 'ai_wa',
          // Hide fully cleared leftovers if soft-delete fell back
          NOT: {
            status: 'inactive',
            phoneNumberId: null,
            botTokenEncrypted: null,
          },
        },
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
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_WHATSAPP } },
      }),
      workerFetch('/internal/config'),
    ]);

    const meta = trialMeta(addon);
    const addonActive = meta.isActive;
    const evolutionConfigured = Boolean(cfg.json?.evolutionConfigured);

    return reply.send({
      ok: true,
      priceMonthly: PRICING.AI_WHATSAPP_MONTHLY,
      trialDays: 14,
      workerConfigured: Boolean(serviceToken()),
      evolutionConfigured,
      evolutionHint: cfg.json?.hint || null,
      pruned,
      waAddon: addon
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
          ? `Доступен пробный период 14 дней, затем ${PRICING.AI_WHATSAPP_MONTHLY} ₽/мес.`
          : `Тариф WhatsApp (${PRICING.AI_WHATSAPP_MONTHLY} ₽/мес) не активен. Оформите оплату.`,
      requiresPayment: !addonActive,
      accounts: bots.map((b) => ({
        id: b.id,
        name: accountLabel(b),
        displayName: accountLabel(b),
        slug: b.botUsername || 'default',
        phoneNumberId: b.phoneNumberId,
        status: b.status,
        connected: Boolean(b.botTokenEncrypted) && b.status === 'active',
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
    });
  });

  fastify.post('/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start WhatsApp trial' });
    }

    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.AI_WHATSAPP);
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
      return reply.code(403).send({ error: 'Only owners can connect WhatsApp' });
    }
    const addon = await fastify.prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_WHATSAPP } },
    });
    const addonActive = Boolean(addon && addon.status === 'active' && addon.activeUntil > new Date());
    if (!addonActive) {
      return reply.code(402).send({
        error: 'payment_required',
        message: `Оплатите тариф WhatsApp (${PRICING.AI_WHATSAPP_MONTHLY} ₽/мес) или запустите trial`,
        productCode: PRODUCT_CODES.AI_WHATSAPP,
        priceMonthly: PRICING.AI_WHATSAPP_MONTHLY,
      });
    }
    const body = (request.body || {}) as { name?: string };
    const name = String(body.name || 'default').trim() || 'default';

    const result = await workerFetch('/internal/auth/qr/start', {
      method: 'POST',
      body: JSON.stringify({ tenantId, name }),
    });
    return reply.code(result.status).send(result.json);
  });

  fastify.get('/auth/qr/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { name?: string };
    const name = String(q.name || 'default').trim() || 'default';
    const result = await workerFetch(
      `/internal/auth/qr/status?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`,
    );
    return reply.code(result.status).send(result.json);
  });

  fastify.delete(
    '/accounts/:botId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can delete WhatsApp accounts' });
      }
      const { botId } = request.params as { botId: string };
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: 'ai_wa' },
        select: { id: true },
      });
      if (!bot) return reply.code(404).send({ ok: false, error: 'account not found' });

      const result = await workerFetch('/internal/accounts/delete', {
        method: 'POST',
        body: JSON.stringify({ tenantId, botId }),
      });
      if (result.status >= 300 || !result.json?.ok) {
        // Local fallback when worker down — still remove from portal list
        await fastify.prisma.conversation.updateMany({
          where: { botInstanceId: botId },
          data: { botInstanceId: null },
        });
        try {
          await fastify.prisma.botInstance.delete({ where: { id: botId } });
          return reply.send({ ok: true, botId, evolutionDeleted: false, localOnly: true });
        } catch {
          await fastify.prisma.botInstance.update({
            where: { id: botId },
            data: { status: 'inactive', botTokenEncrypted: null, phoneNumberId: null },
          });
          return reply.send({ ok: true, botId, evolutionDeleted: false, softDeleted: true });
        }
      }
      return reply.code(result.status).send(result.json);
    },
  );
};
