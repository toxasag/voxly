/**
 * Fully wipe a tenant: Twenty CRM workspace + control-plane rows (+ optional Evolution).
 * Used by superadmin «Удалить аккаунт полностью». Irreversible.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { prisma, type PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';

async function dropTwentyWorkspaceHard(workspaceId: string): Promise<void> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn('[purge-tenant] TWENTY_DATABASE_URL unset — skip hard workspace drop');
    return;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const row = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = row.rows[0]?.databaseSchema;
    if (schema && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client.query(`DELETE FROM core.application WHERE "workspaceId" = $1::uuid`, [
      workspaceId,
    ]);
    await client.query(`DELETE FROM core."userWorkspace" WHERE "workspaceId" = $1::uuid`, [
      workspaceId,
    ]);
    await client.query(
      `UPDATE core.workspace
       SET "deletedAt" = COALESCE("deletedAt", now()),
           "activationStatus" = 'INACTIVE',
           "updatedAt" = now()
       WHERE id = $1::uuid`,
      [workspaceId],
    );
    await client.query(`DELETE FROM core.workspace WHERE id = $1::uuid`, [workspaceId]);
  } finally {
    await client.end();
  }
}

async function deleteEvolutionInstancesForTenant(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  const evoUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const evoKey = process.env.EVOLUTION_API_KEY || '';
  if (!evoUrl || !evoKey) return;

  const bots = await db.botInstance.findMany({
    where: { tenantId, botType: 'ai_wa' },
    select: { id: true, botUsername: true, phoneNumberId: true },
  });
  for (const bot of bots) {
    const instance =
      bot.phoneNumberId ||
      bot.botUsername ||
      `wa_${tenantId.slice(0, 10)}_${bot.id.slice(-8)}`;
    try {
      await fetch(`${evoUrl}/instance/delete/${encodeURIComponent(instance)}`, {
        method: 'DELETE',
        headers: { apikey: evoKey },
      });
    } catch {
      /* best-effort */
    }
  }
}

async function deleteKnowledgeFiles(tenantId: string): Promise<void> {
  const root = process.env.AI_KNOWLEDGE_DIR || '/data/ai-knowledge';
  try {
    const { rm } = await import('node:fs/promises');
    await rm(`${root}/${tenantId}`, { recursive: true, force: true });
  } catch {
    /* optional volume */
  }
}

export async function purgeTenantFully(opts: {
  tenantId: string;
  confirmSlug: string;
  actorUserId: string;
  db?: PrismaClient;
}): Promise<{ ok: true; slug: string; twentyWorkspaceId: string | null }> {
  const db = opts.db || prisma;
  const tenant = await db.tenant.findUnique({
    where: { id: opts.tenantId },
    include: {
      users: { include: { user: true } },
    },
  });
  if (!tenant) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }
  if (tenant.slug !== opts.confirmSlug) {
    throw Object.assign(new Error('confirmSlug does not match tenant slug'), {
      statusCode: 400,
    });
  }

  const owner = tenant.users.find((m) => m.role === 'owner')?.user;
  const workspaceId = tenant.twentyWorkspaceId;

  await deleteEvolutionInstancesForTenant(db, tenant.id);
  await deleteKnowledgeFiles(tenant.id);

  if (workspaceId && owner?.email && tenant.twentyOwnerPasswordEncrypted) {
    try {
      const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
      const client = new TwentyClient({
        apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
      });
      await client.authenticateWorkspace(owner.email, password, workspaceId);
      await client.deleteCurrentWorkspace();
    } catch (err) {
      console.warn(
        '[purge-tenant] deleteCurrentWorkspace failed, will hard-drop via SQL:',
        err instanceof Error ? err.message : err,
      );
    }
    await dropTwentyWorkspaceHard(workspaceId);
  } else if (workspaceId) {
    await dropTwentyWorkspaceHard(workspaceId);
  }

  const memberUserIds = tenant.users.map((m) => m.userId);

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: opts.actorUserId,
      action: 'purge_tenant',
      payload: {
        slug: tenant.slug,
        twentyWorkspaceId: workspaceId,
      },
    },
  });

  // Break Payment → Subscription FK before cascade delete.
  await db.payment.updateMany({
    where: { tenantId: tenant.id },
    data: { subscriptionId: null },
  });

  // Cascade deletes control-plane children (bots, chats, billing, AI, …).
  await db.tenant.delete({ where: { id: tenant.id } });

  // Remove orphan users that only belonged to this tenant (keep superadmins).
  for (const userId of memberUserIds) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { tenantMembers: true },
    });
    if (!user) continue;
    if (user.role === 'superadmin') continue;
    if (user.tenantMembers.length === 0) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  }

  return {
    ok: true,
    slug: tenant.slug,
    twentyWorkspaceId: workspaceId,
  };
}

/** Force-refresh private CRM chat app tarball into a workspace (AI buttons, etc.). */
export async function refreshCrmChatAppForTenant(opts: {
  tenantId: string;
  db?: PrismaClient;
}): Promise<{ ok: true; versionHint: string }> {
  const db = opts.db || prisma;
  const tenant = await db.tenant.findUnique({
    where: { id: opts.tenantId },
    include: {
      users: { where: { role: 'owner' }, include: { user: true }, take: 1 },
    },
  });
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    throw Object.assign(new Error('CRM workspace is not provisioned yet'), {
      statusCode: 409,
    });
  }
  const owner = tenant.users[0]?.user;
  if (!owner?.email) {
    throw Object.assign(new Error('Tenant owner not found'), { statusCode: 404 });
  }

  const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.email,
    password,
    tenant.twentyWorkspaceId,
  );

  const domain = process.env.VOXLY_DOMAIN || 'getvoxly.ru';
  const workspaceOrigin = `https://${tenant.slug}-crm.${domain}`;
  const voxlyApiUrl = (
    process.env.VOXLY_CHAT_API_URL?.trim() || 'http://saas-api:3002'
  ).replace(/\/+$/, '');
  const tarballPath = process.env.VOXLY_CRM_CHAT_TARBALL?.trim();
  const tarball = tarballPath
    ? new Uint8Array(await readFile(tarballPath))
    : undefined;

  // Drop prior registration so uploadAppTarball can publish a new version.
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (connectionString && tarball?.byteLength) {
    const pgClient = new pg.Client({ connectionString });
    await pgClient.connect();
    try {
      await pgClient.query(
        `DELETE FROM core."applicationRegistrationVariable"
         WHERE "applicationRegistrationId" IN (
           SELECT id FROM core."applicationRegistration"
           WHERE "universalIdentifier" = $1
         )`,
        ['b5c92442-f0ae-4090-8a31-88fd51785c25'],
      );
      await pgClient.query(
        `DELETE FROM core."applicationRegistration" WHERE "universalIdentifier" = $1`,
        ['b5c92442-f0ae-4090-8a31-88fd51785c25'],
      );
    } finally {
      await pgClient.end();
    }
  }

  await client.ensureCrmChatAppInstalled({
    workspaceOrigin,
    voxlyApiUrl,
    tarball,
    tarballPath,
    forceReinstall: true,
  });

  return { ok: true, versionHint: '0.1.10+' };
}
