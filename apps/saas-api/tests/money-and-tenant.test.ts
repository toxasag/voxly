import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@voxly/db';
import { chargeAiUsage } from '@voxly/ai-core';
import { PRODUCT_CODES, REFERRAL_EXCLUDED_PRODUCTS } from '@voxly/shared';
import { authHeaderFor, closeTestApp, getTestApp } from './helpers/app.js';
import { isTestDbReady } from './helpers/db-gate.js';
import {
  cleanupTenant,
  createPendingPayment,
  createTenantWithOwner,
} from './helpers/factories.js';

function signResult(outSum: string, invId: string): string {
  return createHash('sha256').update(`${outSum}:${invId}:pass2`).digest('hex');
}

const dbReady = await isTestDbReady();

describe.skipIf(!dbReady)('money paths and tenant isolation', () => {
  afterAll(async () => {
    await closeTestApp();
    await prisma.$disconnect();
  });

  it('webhook delivery is idempotent — second ResultURL does not double-fulfil', async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    try {
      const payment = await createPendingPayment({
        tenantId: ctx.tenant.id,
        amount: 500,
        productCode: PRODUCT_CODES.AI_TOPUP,
      });
      const invId = String(payment.robokassaInvId);
      const payload = {
        OutSum: '500.00',
        InvId: invId,
        SignatureValue: signResult('500.00', invId),
      };
      const first = await app.inject({ method: 'POST', url: '/api/billing/result', payload });
      const second = await app.inject({ method: 'POST', url: '/api/billing/result', payload });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const wallet = await prisma.aiWallet.findUnique({ where: { tenantId: ctx.tenant.id } });
      // seeded 100 + one top-up 500
      expect(Number(wallet?.balanceRub)).toBe(600);
    } finally {
      await cleanupTenant(ctx.tenant.id);
    }
  });

  it('concurrent chargeAiUsage does not overdraft the wallet', async () => {
    const ctx = await createTenantWithOwner();
    try {
      await prisma.aiWallet.update({
        where: { tenantId: ctx.tenant.id },
        data: { balanceRub: 10 },
      });
      // markup 50% → chargedRub ≈ 3 from providerCostRub 2
      await Promise.all(
        Array.from({ length: 8 }, () =>
          chargeAiUsage({
            tenantId: ctx.tenant.id,
            providerCostRub: 2,
            tokens: 100,
            model: 'test/model',
            requestType: 'text',
            channel: 'telegram_business',
          }),
        ),
      );
      const wallet = await prisma.aiWallet.findUnique({ where: { tenantId: ctx.tenant.id } });
      expect(Number(wallet?.balanceRub)).toBeGreaterThanOrEqual(0);
      expect(Number(wallet?.balanceRub)).toBeLessThanOrEqual(10);
      const logs = await prisma.aiUsageLog.findMany({ where: { tenantId: ctx.tenant.id } });
      const sumCharged = logs.reduce((s, l) => s + Number(l.chargedRub), 0);
      // Collected from wallet cannot exceed the starting 10₽ plus floating dust.
      const collected = sumCharged - logs.reduce((s, l) => s + Number(l.uncollectedRub ?? 0), 0);
      expect(collected).toBeLessThanOrEqual(10.01);
    } finally {
      await cleanupTenant(ctx.tenant.id);
    }
  });

  it('ai_topup is excluded from referral product scope', () => {
    expect(REFERRAL_EXCLUDED_PRODUCTS.has(PRODUCT_CODES.AI_TOPUP)).toBe(true);
  });

  it('member of tenant A cannot read agents of tenant B', async () => {
    const app = await getTestApp();
    const a = await createTenantWithOwner();
    const b = await createTenantWithOwner();
    try {
      const agent = await prisma.aiAgent.create({
        data: { tenantId: b.tenant.id, name: 'Secret', status: 'active' },
      });
      const headers = await authHeaderFor(app, a.user, a.membership);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/agents/${agent.id}`,
        headers,
        payload: { name: 'Hijacked' },
      });
      expect([403, 404]).toContain(res.statusCode);
      const still = await prisma.aiAgent.findUnique({ where: { id: agent.id } });
      expect(still?.name).toBe('Secret');
      expect(still?.tenantId).toBe(b.tenant.id);
    } finally {
      await cleanupTenant(a.tenant.id);
      await cleanupTenant(b.tenant.id);
    }
  });

  it('hold + withdrawal cannot spend the same balance twice', async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    try {
      await prisma.tenantBalance.update({
        where: { tenantId: ctx.tenant.id },
        data: { balanceRub: 1000 },
      });
      const headers = await authHeaderFor(app, ctx.user, ctx.membership);

      const checkout = await app.inject({
        method: 'POST',
        url: '/api/billing/checkout',
        headers,
        payload: {
          productCode: PRODUCT_CODES.CRM_BASE,
          periodMonths: 1,
          applyBalanceRub: 1000,
        },
      });
      // fully covered path returns paid/url-less; either way balance is held/spent
      expect([200, 201]).toContain(checkout.statusCode);

      const withdrawal = await app.inject({
        method: 'POST',
        url: '/api/referrals/withdrawals',
        headers,
        payload: {
          amountRub: 1000,
          payoutDetails: 'card 4111',
        },
      });
      expect([400, 402, 409]).toContain(withdrawal.statusCode);
      const bal = await prisma.tenantBalance.findUnique({ where: { tenantId: ctx.tenant.id } });
      expect(Number(bal?.balanceRub)).toBeLessThan(1000);
    } finally {
      await cleanupTenant(ctx.tenant.id);
    }
  });
});
