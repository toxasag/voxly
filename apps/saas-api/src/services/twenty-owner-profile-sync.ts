/**
 * Fill empty Twenty workspaceMember names from Voxly control User (register firstName/lastName).
 * Prefer this over re-showing /create/profile for already-provisioned workspaces.
 */
import pg from 'pg';

export async function syncOwnerProfileFromControlDb(opts: {
  workspaceId: string;
  ownerEmail: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<boolean> {
  const firstName = opts.firstName?.trim() || null;
  const lastName = opts.lastName?.trim() || null;
  if (!firstName && !lastName) return false;

  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return false;

  const email = opts.ownerEmail.trim().toLowerCase();
  if (!email) return false;

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return false;

    const result = await client.query(
      `UPDATE "${schema}"."workspaceMember"
       SET "nameFirstName" = COALESCE(NULLIF(btrim("nameFirstName"), ''), $3),
           "nameLastName" = COALESCE(NULLIF(btrim("nameLastName"), ''), $4),
           "updatedAt" = now()
       WHERE lower(trim("userEmail")) = $2
         AND "deletedAt" IS NULL
         AND (
           NULLIF(btrim("nameFirstName"), '') IS NULL
           OR NULLIF(btrim("nameLastName"), '') IS NULL
         )
       RETURNING id`,
      [opts.workspaceId, email, firstName, lastName],
    );

    const updated = (result.rowCount ?? 0) > 0;
    if (updated) {
      console.log(
        `[provisioning] synced owner profile workspace=${opts.workspaceId} email=${email}`
          + ` firstName=${firstName ?? ''} lastName=${lastName ?? ''}`,
      );
    }
    return updated;
  } finally {
    await client.end();
  }
}
