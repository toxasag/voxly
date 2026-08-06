import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@voxly/db';
import { PRODUCT_CODES } from '@voxly/shared';
import { authHeaderFor, closeTestApp, getTestApp } from './helpers/app.js';
import { isTestDbReady } from './helpers/db-gate.js';
import { cleanupTenant, createTenantWithOwner } from './helpers/factories.js';

const dbReady = await isTestDbReady();

describe.skipIf(!dbReady)('ai_tg / gift_bot one-shot trial', () => {
  let tenantId = '';
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    tenantId = ctx.tenant.id;
    headers = await authHeaderFor(app, ctx.user, ctx.membership);
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(tenantId);
    await closeTestApp();
    await prisma.$disconnect();
  });

  it('marks ai_tg trial as consumed and refuses a second start', async () => {
    const app = await getTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/bots/ai/start-trial',
      headers,
    });
    expect(first.statusCode).toBe(200);
    const addon = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_TELEGRAM } },
    });
    expect((addon?.config as { trialConsumed?: boolean })?.trialConsumed).toBe(true);

    // Expire the addon so a naive upsert would otherwise renew it.
    await prisma.addon.update({
      where: { id: addon!.id },
      data: { status: 'expired', activeUntil: new Date(Date.now() - 60_000) },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/bots/ai/start-trial',
      headers,
    });
    expect(second.statusCode).toBe(409);
  });

  it('marks gift_bot trial as consumed and refuses a second start', async () => {
    const app = await getTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/bots/gift/start-trial',
      headers,
    });
    expect(first.statusCode).toBe(200);
    const addon = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
    });
    expect((addon?.config as { trialConsumed?: boolean })?.trialConsumed).toBe(true);

    await prisma.addon.update({
      where: { id: addon!.id },
      data: { status: 'expired', activeUntil: new Date(Date.now() - 60_000) },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/bots/gift/start-trial',
      headers,
    });
    expect(second.statusCode).toBe(409);
  });
});
