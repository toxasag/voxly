/**
 * Backfill Person.telegram open links from Conversation.platformUserId
 * when @username is missing. Never invents t.me/+phone; never overwrites
 * existing https://t.me/{username}.
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import {
  TwentyClient,
  isTelegramUsernameLink,
  telegramOpenLink,
} from '@voxly/twenty-client';
import pg from 'pg';

export type BackfillTelegramOpenLinksSummary = {
  ok: boolean;
  slug?: string;
  scanned: number;
  updated: number;
  skippedUsername: number;
  skippedEmpty: number;
  failed: number;
  error?: string;
  samples?: Array<{ personId: string; userId: string; url: string }>;
};

async function readTelegramPrimaryUrl(
  workspaceId: string,
  personId: string,
): Promise<string | null> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return null;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
    const row = await client.query<{
      telegramPrimaryLinkUrl: string | null;
      telegram: string | null;
    }>(
      `SELECT "telegramPrimaryLinkUrl", telegram
       FROM "${schema}".person
       WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [personId],
    );
    const r = row.rows[0];
    return (r?.telegramPrimaryLinkUrl || r?.telegram || null)?.trim() || null;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function backfillTelegramOpenLinks(opts: {
  prisma: PrismaClient;
  tenantId: string;
  limit?: number;
  /** Optional extra personId → userId pairs (e.g. Кувалдин 928954961). */
  extra?: Array<{ personId: string; userId: string }>;
}): Promise<BackfillTelegramOpenLinksSummary> {
  const tenant = await opts.prisma.tenant.findUnique({
    where: { id: opts.tenantId },
  });
  if (!tenant) return { ok: false, scanned: 0, updated: 0, skippedUsername: 0, skippedEmpty: 0, failed: 0, error: 'tenant_not_found' };
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      updated: 0,
      skippedUsername: 0,
      skippedEmpty: 0,
      failed: 0,
      error: 'crm_not_provisioned',
    };
  }

  const owner = await opts.prisma.tenantMember.findFirst({
    where: { tenantId: opts.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (!owner?.user?.email) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      updated: 0,
      skippedUsername: 0,
      skippedEmpty: 0,
      failed: 0,
      error: 'no_owner',
    };
  }

  const limit = Math.min(Math.max(opts.limit || 500, 1), 2000);
  const convs = await opts.prisma.conversation.findMany({
    where: {
      tenantId: opts.tenantId,
      platform: 'telegram',
      twentyPersonId: { not: null },
      platformUserId: { not: '' },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      twentyPersonId: true,
      platformUserId: true,
      platformUsername: true,
    },
  });

  const byPerson = new Map<string, { userId: string; username?: string }>();
  for (const c of convs) {
    const personId = c.twentyPersonId!;
    const userId = String(c.platformUserId || '').trim();
    if (!/^\d{1,20}$/.test(userId)) continue;
    if (byPerson.has(personId)) continue;
    byPerson.set(personId, {
      userId,
      username: c.platformUsername || undefined,
    });
  }

  // Gift TG subscribers (platformUserId may live only on GiftSubscriber).
  const giftSubs = await opts.prisma.giftSubscriber.findMany({
    where: {
      tenantId: opts.tenantId,
      twentyPersonId: { not: null },
      telegramId: { not: '' },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { twentyPersonId: true, telegramId: true, username: true },
  });
  for (const s of giftSubs) {
    const personId = s.twentyPersonId!;
    const userId = String(s.telegramId || '').trim();
    if (!/^\d{1,20}$/.test(userId)) continue;
    if (byPerson.has(personId)) continue;
    byPerson.set(personId, {
      userId,
      username: s.username || undefined,
    });
  }
  for (const e of opts.extra || []) {
    const personId = String(e.personId || '').trim();
    const userId = String(e.userId || '').trim();
    if (!personId || !/^\d{1,20}$/.test(userId)) continue;
    if (!byPerson.has(personId)) {
      byPerson.set(personId, { userId });
    }
  }

  const twenty = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await twenty.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );

  let updated = 0;
  let skippedUsername = 0;
  let skippedEmpty = 0;
  let failed = 0;
  const samples: Array<{ personId: string; userId: string; url: string }> = [];

  for (const [personId, meta] of byPerson) {
    try {
      const existing = await readTelegramPrimaryUrl(tenant.twentyWorkspaceId, personId);
      if (isTelegramUsernameLink(existing)) {
        skippedUsername += 1;
        continue;
      }
      // Already has open-bridge / tg:// for same id — skip.
      if (
        existing &&
        (existing.includes(`/open/tg/${meta.userId}`) ||
          existing === `tg://user?id=${meta.userId}`)
      ) {
        skippedEmpty += 1;
        continue;
      }
      const open = telegramOpenLink({
        username: meta.username,
        userId: meta.userId,
      });
      if (!open) {
        skippedEmpty += 1;
        continue;
      }
      await twenty.updatePersonTelegram(personId, {
        username: meta.username,
        userId: meta.userId,
      });
      updated += 1;
      if (samples.length < 12) {
        samples.push({ personId, userId: meta.userId, url: open.url });
      }
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true,
    slug: tenant.slug,
    scanned: byPerson.size,
    updated,
    skippedUsername,
    skippedEmpty,
    failed,
    samples,
  };
}
