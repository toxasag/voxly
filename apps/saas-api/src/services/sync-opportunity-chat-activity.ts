/**
 * Align Twenty Opportunity.updatedAt with latest ChatMessage / Conversation activity
 * so Kanban «Последнее обновление» reflects messenger traffic (not only CRM field edits).
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';
import pg from 'pg';

export type SyncOppChatActivitySummary = {
  ok: boolean;
  slug?: string;
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  error?: string;
};

async function bumpOpportunityUpdatedAtSql(opts: {
  workspaceId: string;
  opportunityId: string;
  at: Date;
}): Promise<boolean> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return false;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return false;
    const res = await client.query(
      `UPDATE "${schema}".opportunity
       SET "updatedAt" = $2
       WHERE id = $1::uuid
         AND "deletedAt" IS NULL
         AND ("updatedAt" IS NULL OR "updatedAt" < $2)`,
      [opts.opportunityId, opts.at],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    console.warn(
      '[opp-chat-activity] SQL bump failed',
      err instanceof Error ? err.message : err,
    );
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * For one tenant: set Opportunity.updatedAt = max(ChatMessage.createdAt) when newer.
 */
export async function syncOpportunityChatActivityForTenant(opts: {
  prisma: PrismaClient;
  tenantId: string;
  /** Cap conversations scanned (newest first). */
  limit?: number;
}): Promise<SyncOppChatActivitySummary> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const tenant = await opts.prisma.tenant.findUnique({
    where: { id: opts.tenantId },
  });
  if (!tenant) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: 'tenant_not_found',
    };
  }
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: 'crm_not_provisioned',
    };
  }

  // Latest ChatMessage per Opportunity (many Conversations may share one opp).
  const rows = await opts.prisma.$queryRaw<
    Array<{ twentyOpportunityId: string; lastAt: Date }>
  >`
    SELECT c."twentyOpportunityId" AS "twentyOpportunityId",
           MAX(m."createdAt") AS "lastAt"
    FROM "Conversation" c
    INNER JOIN "ChatMessage" m ON m."conversationId" = c.id
    WHERE c."tenantId" = ${opts.tenantId}
      AND c."twentyOpportunityId" IS NOT NULL
    GROUP BY c."twentyOpportunityId"
    ORDER BY MAX(m."createdAt") DESC
    LIMIT ${limit}
  `;
  const latestByOpp = new Map<string, Date>();
  for (const r of rows) {
    if (r.twentyOpportunityId && r.lastAt) {
      latestByOpp.set(r.twentyOpportunityId, new Date(r.lastAt));
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Prefer SQL (exact timestamp). Fallback GraphQL touch (= now) if SQL unavailable.
  let useSql = Boolean(process.env.TWENTY_DATABASE_URL?.trim());
  let gqlClient: TwentyClient | null = null;

  for (const [opportunityId, at] of latestByOpp) {
    try {
      if (useSql) {
        const ok = await bumpOpportunityUpdatedAtSql({
          workspaceId: tenant.twentyWorkspaceId,
          opportunityId,
          at,
        });
        if (ok) updated += 1;
        else skipped += 1;
      } else {
        if (!gqlClient) {
          const owner = await opts.prisma.tenantMember.findFirst({
            where: { tenantId: opts.tenantId, role: 'owner' },
            include: { user: true },
          });
          if (!owner?.user?.email) {
            return {
              ok: false,
              slug: tenant.slug,
              scanned: latestByOpp.size,
              updated,
              skipped,
              failed,
              error: 'owner_not_found',
            };
          }
          gqlClient = new TwentyClient({
            apiUrl:
              process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
          });
          await gqlClient.authenticateWorkspace(
            owner.user.email,
            decrypt(tenant.twentyOwnerPasswordEncrypted),
            tenant.twentyWorkspaceId,
          );
        }
        const ok = await gqlClient.touchOpportunityActivity(opportunityId);
        if (ok) updated += 1;
        else skipped += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true,
    slug: tenant.slug,
    scanned: latestByOpp.size,
    updated,
    skipped,
    failed,
  };
}

/** Live path: bump one Opportunity after a chat message (best-effort). */
export async function touchOpportunityFromConversation(opts: {
  prisma: PrismaClient;
  tenantId: string;
  conversationId: string;
  twenty?: TwentyClient;
}): Promise<void> {
  const conv = await opts.prisma.conversation.findUnique({
    where: { id: opts.conversationId },
    select: { twentyOpportunityId: true },
  });
  const oppId = conv?.twentyOpportunityId;
  if (!oppId) return;

  if (opts.twenty) {
    await opts.twenty.touchOpportunityActivity(oppId);
    return;
  }

  const tenant = await opts.prisma.tenant.findUnique({
    where: { id: opts.tenantId },
  });
  const owner = await opts.prisma.tenantMember.findFirst({
    where: { tenantId: opts.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (
    !tenant?.twentyWorkspaceId ||
    !tenant.twentyOwnerPasswordEncrypted ||
    !owner?.user?.email
  ) {
    return;
  }
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  await client.touchOpportunityActivity(oppId);
}
