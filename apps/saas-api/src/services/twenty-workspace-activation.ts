/**
 * Reversible Twenty workspace activation toggle (direct-login lock).
 * Uses Twenty Postgres — same pattern as purge-tenant INACTIVE mark.
 */
import pg from 'pg';

export type TwentyActivationStatus = 'ACTIVE' | 'INACTIVE';

export async function setTwentyWorkspaceActivation(
  workspaceId: string,
  status: TwentyActivationStatus,
): Promise<boolean> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[twenty-workspace-activation] TWENTY_DATABASE_URL unset — skip',
      workspaceId,
      status,
    );
    return false;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE core.workspace
       SET "activationStatus" = $2,
           "updatedAt" = now()
       WHERE id = $1::uuid
         AND "deletedAt" IS NULL`,
      [workspaceId, status],
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}
