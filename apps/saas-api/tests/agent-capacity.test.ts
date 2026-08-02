import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@voxly/db';
import { PRODUCT_CODES } from '@voxly/shared';
import { authHeaderFor, closeTestApp, getTestApp } from './helpers/app.js';
import { isTestDbReady } from './helpers/db-gate.js';
import { cleanupTenant, createTenantWithOwner } from './helpers/factories.js';

const dbReady = await isTestDbReady();

describe.skipIf(!dbReady)('resolveAgentCapacity is read-only on GET', () => {
  let tenantId = '';
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    const app = await getTestApp();
    const ctx = await createTenantWithOwner();
    tenantId = ctx.tenant.id;
    headers = await authHeaderFor(app, ctx.user, ctx.membership);
    await prisma.aiAgent.create({
      data: { tenantId, name: 'Orphan agent', status: 'active' },
    });
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(tenantId);
    await closeTestApp();
    await prisma.$disconnect();
  });

  it('does not create a free ai_agent addon when listing agents', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai/agents',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.capacity.agentSlots).toBe(0);
    expect(body.capacity.activeAgents).toBe(1);
    expect(body.capacity.freeSlots).toBe(0);

    const addon = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_AGENT } },
    });
    expect(addon).toBeNull();
  });

  it('returns 402 when creating an agent without paid slots', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers,
      payload: { name: 'Should fail' },
    });
    expect(res.statusCode).toBe(402);
  });
});
