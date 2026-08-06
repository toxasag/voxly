import pg from 'pg';
import { TwentyClient } from '@voxly/twenty-client';
import { decrypt } from '@voxly/crypto';

type Logger = {
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

/**
 * Reassign CRM ownership (deals/tasks) from removed member → owner, then
 * remove the member from the Twenty workspace via deleteUserFromWorkspace.
 *
 * People/companies stay in the workspace (no owner field); deals with null
 * ownerId are unchanged. createdBy history is left as-is (audit).
 */
export async function removeTwentyMemberFromTenant(params: {
  tenant: {
    twentyWorkspaceId: string | null;
    twentyOwnerPasswordEncrypted: string | null;
  };
  ownerEmail: string;
  memberEmail: string;
  log?: Logger;
}): Promise<{ ok: boolean; removedFromCrm: boolean; error?: string }> {
  const { tenant, ownerEmail, memberEmail, log } = params;
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return { ok: true, removedFromCrm: false };
  }

  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    return { ok: false, removedFromCrm: false, error: 'TWENTY_DATABASE_URL unset' };
  }

  const workspaceId = tenant.twentyWorkspaceId;
  const email = memberEmail.trim().toLowerCase();
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      return { ok: false, removedFromCrm: false, error: 'CRM workspace schema not found' };
    }

    const members = await client.query<{
      id: string;
      userEmail: string | null;
      userId: string;
    }>(
      `SELECT id, "userEmail", "userId"
       FROM "${schema}"."workspaceMember"
       WHERE "deletedAt" IS NULL`,
    );

    const ownerEmailNorm = ownerEmail.trim().toLowerCase();
    const ownerRow = members.rows.find(
      (m) => (m.userEmail || '').trim().toLowerCase() === ownerEmailNorm,
    );
    const memberRow = members.rows.find(
      (m) => (m.userEmail || '').trim().toLowerCase() === email,
    );

    if (!memberRow) {
      // Already gone from CRM — Voxly row can still be deleted.
      return { ok: true, removedFromCrm: false };
    }
    if (!ownerRow) {
      return { ok: false, removedFromCrm: false, error: 'Owner not found in CRM workspace' };
    }
    if (memberRow.id === ownerRow.id) {
      return { ok: false, removedFromCrm: false, error: 'Cannot remove workspace owner from CRM' };
    }

    // Transfer ownership before Twenty soft-deletes the workspaceMember row.
    await client.query(
      `UPDATE "${schema}".opportunity
       SET "ownerId" = $1::uuid, "updatedAt" = now()
       WHERE "ownerId" = $2::uuid AND "deletedAt" IS NULL`,
      [ownerRow.id, memberRow.id],
    );
    await client.query(
      `UPDATE "${schema}".task
       SET "assigneeId" = $1::uuid, "updatedAt" = now()
       WHERE "assigneeId" = $2::uuid AND "deletedAt" IS NULL`,
      [ownerRow.id, memberRow.id],
    );

    const ownerPassword = decrypt(tenant.twentyOwnerPasswordEncrypted);
    const twenty = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    await twenty.removeWorkspaceMember({
      ownerEmail: ownerEmailNorm,
      ownerPassword,
      workspaceId,
      workspaceMemberId: memberRow.id,
    });

    return { ok: true, removedFromCrm: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    log?.error({ err, memberEmail: email }, 'Twenty member remove failed');
    return {
      ok: false,
      removedFromCrm: false,
      error:
        raw.length > 180 || raw.includes('GraphQL')
          ? 'Не удалось удалить пользователя из CRM. Попробуйте ещё раз.'
          : raw,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
