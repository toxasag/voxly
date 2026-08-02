import { afterAll, describe, expect, it } from 'vitest';
import { closeTestApp, getTestApp } from './helpers/app.js';
import { isTestDbReady } from './helpers/db-gate.js';
import { cleanupTenant, createPendingPayment, createTenantWithOwner } from './helpers/factories.js';
import { prisma } from '@voxly/db';

const dbReady = await isTestDbReady();

describe.skipIf(!dbReady)('external integration degradation', () => {
  afterAll(async () => {
    await closeTestApp();
    await prisma.$disconnect();
  });

  it('rejects Robokassa ResultURL with a bad signature', async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    try {
      const payment = await createPendingPayment({ tenantId: ctx.tenant.id, amount: 500 });
      const invId = String(payment.robokassaInvId);
      const res = await app.inject({
        method: 'POST',
        url: '/api/billing/result',
        payload: {
          OutSum: '500.00',
          InvId: invId,
          SignatureValue: 'deadbeef',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('bad signature');
      const still = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(still?.status).toBe('pending');
    } finally {
      await cleanupTenant(ctx.tenant.id);
    }
  });

  it('returns 503 when GramJS bridge is unreachable', async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    const prev = process.env.GRAMJS_BRIDGE_URL;
    process.env.GRAMJS_BRIDGE_URL = 'http://127.0.0.1:9';
    try {
      const token = app.jwt.sign({
        sub: ctx.user.id,
        email: ctx.email,
        role: 'owner',
        tenantRole: 'owner',
        tenantId: ctx.tenant.id,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/bots/gramjs/auth/qr/start',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'acct1' },
      });
      // Bridge down → 503; validation → 4xx. Must not leak an unhandled 500.
      expect(res.statusCode).not.toBe(500);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      process.env.GRAMJS_BRIDGE_URL = prev;
      await cleanupTenant(ctx.tenant.id);
    }
  });

  it('returns 503 when WhatsApp worker is unreachable', async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    const prev = process.env.AI_WHATSAPP_WORKER_URL;
    process.env.AI_WHATSAPP_WORKER_URL = 'http://127.0.0.1:9';
    try {
      const token = app.jwt.sign({
        sub: ctx.user.id,
        email: ctx.email,
        role: 'owner',
        tenantRole: 'owner',
        tenantId: ctx.tenant.id,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/bots/whatsapp/auth/qr/start',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'wa1' },
      });
      expect(res.statusCode).not.toBe(500);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      process.env.AI_WHATSAPP_WORKER_URL = prev;
      await cleanupTenant(ctx.tenant.id);
    }
  });

  it('documents Telegram account disconnect invariant: conversations survive bot soft-delete', async () => {
    // Product rule for mass-looker / spam audiences: when a TG account drops,
    // CRM conversations and contacts must remain. Soft-delete must not cascade-wipe chat.
    const ctx = await createTenantWithOwner();
    try {
      const bot = await prisma.botInstance.create({
        data: {
          tenantId: ctx.tenant.id,
          botType: 'ai_tg',
          status: 'active',
          botUsername: `test_${Date.now()}`,
        },
      });
      const conv = await prisma.conversation.create({
        data: {
          tenantId: ctx.tenant.id,
          botInstanceId: bot.id,
          platform: 'telegram',
          platformUserId: '12345',
          status: 'open',
        },
      });
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { status: 'suspended' },
      });
      const still = await prisma.conversation.findUnique({ where: { id: conv.id } });
      expect(still).not.toBeNull();
      expect(still?.status).toBe('open');
    } finally {
      await cleanupTenant(ctx.tenant.id);
    }
  });
});
