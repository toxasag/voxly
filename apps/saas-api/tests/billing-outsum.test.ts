import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@voxly/db';
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

describe.skipIf(!dbReady)('Robokassa OutSum vs payment.amount', () => {
  let tenantId = '';
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    tenantId = ctx.tenant.id;
    headers = await authHeaderFor(app, ctx.user, ctx.membership);
    void headers;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(tenantId);
    await closeTestApp();
    await prisma.$disconnect();
  });

  it('rejects a webhook whose OutSum does not match the invoice', async () => {
    const app = await getTestApp();
    const payment = await createPendingPayment({ tenantId, amount: 1000 });
    const invId = String(payment.robokassaInvId);
    const outSum = '1.00';
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/result',
      payload: {
        OutSum: outSum,
        InvId: invId,
        SignatureValue: signResult(outSum, invId),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('amount mismatch');
    const still = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(still?.status).toBe('pending');
  });

  it('accepts a webhook whose OutSum matches the invoice', async () => {
    const app = await getTestApp();
    const payment = await createPendingPayment({ tenantId, amount: 500 });
    const invId = String(payment.robokassaInvId);
    const outSum = '500.00';
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/result',
      payload: {
        OutSum: outSum,
        InvId: invId,
        SignatureValue: signResult(outSum, invId),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(`OK${invId}`);
    const paid = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paid?.status).toBe('paid');
  });
});
