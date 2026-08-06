// Platform health checks for superadmin ops dashboard

import type { PrismaClient } from '@voxly/db';
import IORedis from 'ioredis';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export type HealthCheck = {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  latencyMs?: number;
};

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

async function httpProbe(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status?: number; detail: string; ms: number }> {
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const body = await res.text().catch(() => '');
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} ${body.slice(0, 120)}`,
      ms,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
    };
  }
}

export async function collectPlatformHealth(prisma: PrismaClient) {
  const checks: HealthCheck[] = [];

  const db = await timed(() => prisma.$queryRaw`SELECT 1 as ok`);
  checks.push({
    id: 'postgres_control',
    name: 'Control Postgres',
    status: db.ok ? 'ok' : 'fail',
    detail: db.ok ? 'SELECT 1 ok' : db.error,
    latencyMs: db.ms,
  });

  const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
  let redisClient: IORedis | null = null;
  try {
    redisClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    const r = await timed(async () => {
      await redisClient!.connect();
      const pong = await redisClient!.ping();
      const info = await redisClient!.info('memory');
      const used = /used_memory_human:(\S+)/.exec(info)?.[1] || '?';
      return { pong, used };
    });
    checks.push({
      id: 'redis',
      name: 'Redis',
      status: r.ok && r.value.pong === 'PONG' ? 'ok' : 'fail',
      detail: r.ok ? `PONG · mem ${r.value.used}` : r.error,
      latencyMs: r.ms,
    });

    if (r.ok) {
      const queues = ['provisioning', 'email', 'subscription'];
      for (const q of queues) {
        try {
          const waiting = await redisClient.llen(`bull:${q}:wait`);
          const failed = await redisClient.zcard(`bull:${q}:failed`);
          const delayed = await redisClient.zcard(`bull:${q}:delayed`);
          let status: CheckStatus = 'ok';
          let detail = `wait=${waiting} delayed=${delayed} failed=${failed}`;
          if (failed > 20 || waiting > 200) {
            status = 'warn';
            detail += failed > 20 ? ' — много failed' : ' — очередь растёт';
          }
          if (failed > 100 || waiting > 1000) status = 'fail';
          checks.push({ id: `queue_${q}`, name: `Очередь ${q}`, status, detail });
        } catch {
          /* missing keys ok */
        }
      }
    }
  } catch (e) {
    checks.push({
      id: 'redis',
      name: 'Redis',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {
        redisClient.disconnect();
      }
    }
  }

  const probes: Array<{ id: string; name: string; url: string; optional?: boolean }> = [
    {
      id: 'twenty',
      name: 'Twenty CRM',
      url:
        (process.env.TWENTY_SERVER_URL || 'http://twenty-server:3000').replace(/\/graphql\/?$/, '') +
        '/healthz',
    },
    {
      id: 'gift_worker',
      name: 'Gift bot worker',
      url: `${process.env.GIFT_BOT_WORKER_URL || 'http://gift-bot-worker:3004'}/health`,
    },
    {
      id: 'ai_tg_worker',
      name: 'AI Telegram worker',
      url: `${process.env.AI_TELEGRAM_WORKER_URL || 'http://ai-telegram-worker:3005'}/health`,
    },
    {
      id: 'ai_wa_worker',
      name: 'AI WhatsApp worker',
      url: `${process.env.AI_WHATSAPP_WORKER_URL || 'http://ai-whatsapp-worker:3006'}/health`,
      optional: true,
    },
    {
      id: 'gramjs',
      name: 'GramJS bridge',
      url: `${process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008'}/health`,
      optional: true,
    },
    {
      id: 'manager',
      name: 'Manager bot',
      url: `${process.env.MANAGER_BOT_URL || 'http://manager-bot-service:3003'}/health`,
    },
  ];

  for (const p of probes) {
    const res = await httpProbe(p.url);
    checks.push({
      id: p.id,
      name: p.name,
      status: res.ok ? 'ok' : p.optional ? 'warn' : 'fail',
      detail: res.ok ? res.detail : `${res.detail}`,
      latencyMs: res.ms,
    });
  }

  const now = new Date();
  const in3d = new Date(now.getTime() + 3 * 86400000);
  const in7d = new Date(now.getTime() + 7 * 86400000);

  const [addonsExpiring, subsExpiring, lowWallets, bizLimited, pendingPayments] = await Promise.all([
    prisma.addon.count({ where: { status: 'active', activeUntil: { lte: in3d, gt: now } } }),
    prisma.subscription.count({ where: { status: 'active', endsAt: { lte: in7d, gt: now } } }),
    prisma.aiWallet.count({ where: { balanceRub: { lt: 50 } } }),
    prisma.conversation.count({
      where: { channel: 'telegram_business_account', status: 'limited' },
    }),
    prisma.payment.count({
      where: { status: 'pending', createdAt: { gte: new Date(now.getTime() - 86400000) } },
    }),
  ]);

  checks.push({
    id: 'addons_expiring',
    name: 'Аддоны истекают ≤3д',
    status: addonsExpiring > 10 ? 'warn' : 'ok',
    detail: `${addonsExpiring} аддонов скоро закончатся`,
  });
  checks.push({
    id: 'subs_expiring',
    name: 'Подписки истекают ≤7д',
    status: subsExpiring > 20 ? 'warn' : 'ok',
    detail: `${subsExpiring} подписок`,
  });
  checks.push({
    id: 'ai_wallets_low',
    name: 'AI-балансы < 50 ₽',
    status: lowWallets > 5 ? 'warn' : 'ok',
    detail: `${lowWallets} тенантов — риск остановки AI`,
  });
  checks.push({
    id: 'business_limited',
    name: 'Business без прав ответа',
    status: bizLimited > 0 ? 'warn' : 'ok',
    detail: `${bizLimited} аккаунтов limited (can_reply=false)`,
  });
  checks.push({
    id: 'payments_pending',
    name: 'Платежи pending за 24ч',
    status: pendingPayments > 30 ? 'warn' : 'ok',
    detail: `${pendingPayments} незавершённых checkout`,
  });

  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    checks.push({
      id: 'llm_key',
      name: 'LLM API key',
      status: 'warn',
      detail: 'Ключ не задан — AI не ответит',
    });
  } else {
    checks.push({
      id: 'llm_key',
      name: 'LLM API key',
      status: 'ok',
      detail: process.env.OPENROUTER_API_KEY ? 'OPENROUTER set' : 'OPENAI set',
    });
  }

  checks.push({
    id: 'service_token',
    name: 'VOXLY_SERVICE_TOKEN',
    status: process.env.VOXLY_SERVICE_TOKEN ? 'ok' : 'fail',
    detail: process.env.VOXLY_SERVICE_TOKEN ? 'задан' : 'Не задан — CRM chat / GramJS / WA proxy',
  });

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const overall: CheckStatus = fails > 0 ? 'fail' : warns > 0 ? 'warn' : 'ok';

  return {
    overall,
    checkedAt: new Date().toISOString(),
    summary: { ok: checks.filter((c) => c.status === 'ok').length, warn: warns, fail: fails },
    checks,
  };
}
