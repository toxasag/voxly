/**
 * Seed a large tenant footprint and measure key API latencies locally.
 * Requires DATABASE_URL + running saas-api (API_URL).
 *
 *   pnpm exec tsx scripts/perf-seed-and-measure.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_URL = (process.env.API_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const CONV_COUNT = Number(process.env.PERF_CONVERSATIONS || 2000);
const MSG_COUNT = Number(process.env.PERF_MESSAGES || 10000);
const REF_COUNT = Number(process.env.PERF_REFERRALS || 200);
const P95_BUDGET_MS = Number(process.env.PERF_P95_MS || 1500);

function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

async function main() {
  const slug = `perf_${Date.now().toString(36)}`;
  const tenant = await prisma.tenant.create({
    data: { slug, portalHost: `${slug}.getvoxly.ru`, status: 'active' },
  });
  const bot = await prisma.botInstance.create({
    data: { tenantId: tenant.id, botType: 'ai_wa', status: 'active', botUsername: slug },
  });

  console.log(`[perf] seeding tenant=${tenant.id} conv=${CONV_COUNT} msg=${MSG_COUNT}`);
  const convIds: string[] = [];
  for (let i = 0; i < CONV_COUNT; i += 200) {
    const batch = await prisma.$transaction(
      Array.from({ length: Math.min(200, CONV_COUNT - i) }, (_, j) =>
        prisma.conversation.create({
          data: {
            tenantId: tenant.id,
            botInstanceId: bot.id,
            platform: 'whatsapp',
            platformUserId: `u${i + j}`,
            status: 'open',
          },
          select: { id: true },
        }),
      ),
    );
    convIds.push(...batch.map((c) => c.id));
  }

  for (let i = 0; i < MSG_COUNT; i += 500) {
    const chunk = Math.min(500, MSG_COUNT - i);
    await prisma.chatMessage.createMany({
      data: Array.from({ length: chunk }, (_, j) => ({
        conversationId: convIds[(i + j) % convIds.length],
        role: j % 2 === 0 ? 'user' : 'assistant',
        content: `msg ${i + j}`,
        deliveryStatus: 'delivered',
      })),
    });
  }

  await prisma.referralCode.create({
    data: { tenantId: tenant.id, code: slug.toUpperCase().slice(0, 10) },
  });
  for (let i = 0; i < REF_COUNT; i++) {
    const referred = await prisma.tenant.create({
      data: {
        slug: `${slug}_r${i}`,
        portalHost: `${slug}-r${i}.getvoxly.ru`,
        status: 'active',
      },
    });
    await prisma.referral.create({
      data: { referrerTenantId: tenant.id, referredTenantId: referred.id, status: 'attributed' },
    });
  }

  const endpoints = [
    '/health',
    '/api/tenant/dashboard',
  ];
  const token = process.env.PERF_JWT || '';
  const results: Record<string, number> = {};
  for (const path of endpoints) {
    const samples: number[] = [];
    for (let n = 0; n < 10; n++) {
      const t0 = Date.now();
      const res = await fetch(`${API_URL}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      samples.push(Date.now() - t0);
      if (path !== '/health' && res.status === 401) break;
    }
    results[path] = p95(samples);
  }

  console.log(JSON.stringify({ tenantId: tenant.id, p95Ms: results, budgetMs: P95_BUDGET_MS }, null, 2));
  const healthP95 = results['/health'] ?? 0;
  if (healthP95 > P95_BUDGET_MS) {
    console.error(`[perf] FAIL /health p95 ${healthP95} > ${P95_BUDGET_MS}`);
    process.exit(2);
  }
  console.log('[perf] OK (seed left in DB for inspection; delete tenant manually if needed)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
