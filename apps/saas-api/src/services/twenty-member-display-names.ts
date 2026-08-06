import pg from 'pg';

export type TwentyMemberDisplayName = {
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
};

function formatMemberLabel(row: TwentyMemberDisplayName): string | null {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  const email = String(row.email || '').trim();
  if (email.includes('@')) return email.split('@')[0] || email;
  return email || null;
}

async function withTwentySchema<T>(
  workspaceId: string,
  fn: (client: pg.Client, schema: string) => Promise<T>,
): Promise<T | null> {
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
    return await fn(client, schema);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Map lowercased email → workspaceMember name from Twenty schema.
 * Used by CRM portal «Команда» when Voxly User.firstName/lastName are empty.
 */
export async function fetchTwentyMemberDisplayNames(
  workspaceId: string | null | undefined,
): Promise<Map<string, TwentyMemberDisplayName>> {
  const out = new Map<string, TwentyMemberDisplayName>();
  if (!workspaceId) return out;

  const rows = await withTwentySchema(workspaceId, async (client, schema) => {
    const result = await client.query<{
      userEmail: string | null;
      nameFirstName: string | null;
      nameLastName: string | null;
    }>(
      `SELECT "userEmail", "nameFirstName", "nameLastName"
       FROM "${schema}"."workspaceMember"
       WHERE "deletedAt" IS NULL`,
    );
    return result.rows;
  });
  if (!rows) return out;

  for (const row of rows) {
    const email = (row.userEmail || '').trim().toLowerCase();
    if (!email) continue;
    const firstName = row.nameFirstName?.trim() || null;
    const lastName = row.nameLastName?.trim() || null;
    if (!firstName && !lastName) continue;
    out.set(email, { firstName, lastName, email });
  }
  return out;
}

/**
 * Resolve CRM Chat operator label from Twenty membership.
 * Prefer `userWorkspaceId` (logic-function auth context); fall back to email.
 */
export async function resolveTwentyOperatorLabel(opts: {
  workspaceId: string | null | undefined;
  userWorkspaceId?: string | null;
  email?: string | null;
}): Promise<string | null> {
  const workspaceId = opts.workspaceId?.trim();
  if (!workspaceId) return null;

  const userWorkspaceId = opts.userWorkspaceId?.trim() || null;
  const email = opts.email?.trim().toLowerCase() || null;

  const row = await withTwentySchema(workspaceId, async (client, schema) => {
    if (userWorkspaceId) {
      const byUw = await client.query<{
        userEmail: string | null;
        nameFirstName: string | null;
        nameLastName: string | null;
      }>(
        `SELECT wm."userEmail", wm."nameFirstName", wm."nameLastName"
         FROM core."userWorkspace" uw
         JOIN "${schema}"."workspaceMember" wm
           ON wm."userId" = uw."userId" AND wm."deletedAt" IS NULL
         WHERE uw.id = $1::uuid
           AND uw."workspaceId" = $2::uuid
           AND uw."deletedAt" IS NULL
         LIMIT 1`,
        [userWorkspaceId, workspaceId],
      );
      if (byUw.rows[0]) return byUw.rows[0];
    }
    if (email) {
      const byEmail = await client.query<{
        userEmail: string | null;
        nameFirstName: string | null;
        nameLastName: string | null;
      }>(
        `SELECT "userEmail", "nameFirstName", "nameLastName"
         FROM "${schema}"."workspaceMember"
         WHERE lower(trim("userEmail")) = $1 AND "deletedAt" IS NULL
         LIMIT 1`,
        [email],
      );
      if (byEmail.rows[0]) return byEmail.rows[0];
    }
    return null;
  });

  if (!row) return null;
  return formatMemberLabel({
    firstName: row.nameFirstName?.trim() || null,
    lastName: row.nameLastName?.trim() || null,
    email: row.userEmail,
  });
}
