/**
 * Enrich CRM Persons from GramJS users.GetFullUser and soft-merge duplicates by phone.
 * Triggered after personal Telegram (ai_gramjs) connects; also used by admin backfill.
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient, type TelegramProfileEnrichment } from '@voxly/twenty-client';
import { softMergePeopleByPhone } from './crm-deal-dedupe.js';

export type EnrichTarget = {
  telegramId?: string;
  username?: string;
  personId?: string;
};

export type EnrichResultRow = {
  telegramId?: string;
  personId?: string;
  ok: boolean;
  error?: string;
  fields?: string[];
  mergedInto?: string;
  losers?: string[];
  needsReview?: boolean;
};

export type EnrichRunSummary = {
  ok: boolean;
  slug?: string;
  gramjsBotId?: string;
  enriched: number;
  failed: number;
  merged: number;
  results: EnrichResultRow[];
  error?: string;
};

function bridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

async function fetchGramjsProfile(opts: {
  botId: string;
  tenantId: string;
  userId?: string;
  username?: string;
}): Promise<{ profile?: TelegramProfileEnrichment; error?: string }> {
  const token = serviceToken();
  if (!token) return { error: 'VOXLY_SERVICE_TOKEN unset' };
  const res = await fetch(`${bridgeBase()}/users/full`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      username: opts.username,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    profile?: TelegramProfileEnrichment;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.profile) {
    return { error: json.error || `HTTP ${res.status}` };
  }
  return { profile: json.profile };
}

async function collectTargets(
  prisma: PrismaClient,
  tenantId: string,
  limit: number,
  explicit?: EnrichTarget[],
): Promise<EnrichTarget[]> {
  if (explicit?.length) return explicit;

  const byPerson = new Map<string, EnrichTarget>();

  const subs = await prisma.giftSubscriber.findMany({
    where: { tenantId, twentyPersonId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { telegramId: true, username: true, twentyPersonId: true },
  });
  for (const s of subs) {
    const pid = s.twentyPersonId!;
    if (!byPerson.has(pid)) {
      byPerson.set(pid, {
        telegramId: s.telegramId,
        username: s.username || undefined,
        personId: pid,
      });
    }
  }

  const convs = await prisma.conversation.findMany({
    where: {
      tenantId,
      twentyPersonId: { not: null },
      platform: 'telegram',
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      platformUserId: true,
      platformUsername: true,
      twentyPersonId: true,
    },
  });
  for (const c of convs) {
    const pid = c.twentyPersonId!;
    const prev = byPerson.get(pid);
    if (!prev) {
      byPerson.set(pid, {
        telegramId: c.platformUserId,
        username: c.platformUsername || undefined,
        personId: pid,
      });
    } else {
      if (!prev.telegramId) prev.telegramId = c.platformUserId;
      if (!prev.username && c.platformUsername) prev.username = c.platformUsername;
    }
  }

  return [...byPerson.values()].slice(0, limit);
}

export async function runTelegramCrmEnrich(opts: {
  prisma: PrismaClient;
  twenty: TwentyClient;
  tenantId: string;
  botId?: string;
  limit?: number;
  targets?: EnrichTarget[];
}): Promise<EnrichRunSummary> {
  const { prisma, twenty, tenantId } = opts;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: {
        where: { role: 'owner' },
        include: { user: true },
        take: 1,
      },
    },
  });
  if (!tenant) return { ok: false, enriched: 0, failed: 0, merged: 0, results: [], error: 'tenant_not_found' };
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return {
      ok: false,
      slug: tenant.slug,
      enriched: 0,
      failed: 0,
      merged: 0,
      results: [],
      error: 'crm_not_provisioned',
    };
  }
  const owner = tenant.users[0]?.user;
  if (!owner?.email) {
    return {
      ok: false,
      slug: tenant.slug,
      enriched: 0,
      failed: 0,
      merged: 0,
      results: [],
      error: 'owner_not_found',
    };
  }

  const gramjs = opts.botId
    ? await prisma.botInstance.findFirst({
        where: {
          id: opts.botId,
          tenantId,
          botType: 'ai_gramjs',
          status: 'active',
          botTokenEncrypted: { not: null },
        },
      })
    : await prisma.botInstance.findFirst({
        where: {
          tenantId,
          botType: 'ai_gramjs',
          status: 'active',
          botTokenEncrypted: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });
  if (!gramjs) {
    return {
      ok: false,
      slug: tenant.slug,
      enriched: 0,
      failed: 0,
      merged: 0,
      results: [],
      error: 'no_gramjs_session',
    };
  }

  await twenty.authenticateWorkspace(
    owner.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  try {
    await twenty.ensureSocialFields();
  } catch {
    /* optional */
  }

  const targets = await collectTargets(prisma, tenantId, limit, opts.targets);
  const results: EnrichResultRow[] = [];
  let merged = 0;

  for (const t of targets) {
    try {
      const { profile, error } = await fetchGramjsProfile({
        botId: gramjs.id,
        tenantId,
        userId: t.telegramId,
        username: t.username,
      });
      if (!profile) {
        results.push({
          telegramId: t.telegramId,
          personId: t.personId,
          ok: false,
          error: error || 'no_profile',
        });
        continue;
      }

      let personId = t.personId;
      if (!personId && (t.username || t.telegramId)) {
        const found = await twenty.findPersonByHint({
          username: t.username,
          telegramId: t.telegramId,
          lastName: t.username
            ? `@${t.username.replace(/^@/, '')}`
            : t.telegramId,
        });
        personId = found?.id;
      }
      if (!personId && profile.phone) {
        const byPhone = await twenty.findPersonByPhone(profile.phone);
        personId = byPhone?.id;
      }
      if (!personId) {
        results.push({
          telegramId: t.telegramId,
          ok: false,
          error: 'person_not_found',
        });
        continue;
      }

      await twenty.applyTelegramProfile(personId, {
        ...profile,
        userId: t.telegramId || profile.userId,
      });
      if (profile.phone && t.telegramId) {
        await prisma.giftSubscriber.updateMany({
          where: { tenantId, telegramId: t.telegramId },
          data: { phone: profile.phone },
        });
      }

      let mergeInfo: {
        canonical: string;
        losers: string[];
        needsReview: boolean;
        moved: boolean;
      } | null = null;
      if (profile.phone) {
        mergeInfo = await softMergePeopleByPhone({
          prisma,
          client: twenty,
          tenantId,
          personId,
          phone: profile.phone,
        });
        if (mergeInfo.losers.length) {
          if (mergeInfo.moved) merged += 1;
          personId = mergeInfo.canonical;
          // Ensure canonical has full profile too
          await twenty.applyTelegramProfile(personId, profile);
        }
      }

      const fields = Object.entries(profile)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k]) => k);
      results.push({
        telegramId: t.telegramId,
        personId,
        ok: true,
        fields,
        mergedInto:
          mergeInfo && mergeInfo.canonical !== t.personId
            ? mergeInfo.canonical
            : undefined,
        losers: mergeInfo?.losers?.length ? mergeInfo.losers : undefined,
        needsReview: mergeInfo?.needsReview,
      });
    } catch (err) {
      results.push({
        telegramId: t.telegramId,
        personId: t.personId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    slug: tenant.slug,
    gramjsBotId: gramjs.id,
    enriched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    merged,
    results,
  };
}
