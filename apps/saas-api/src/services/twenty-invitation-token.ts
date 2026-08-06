import pg from 'pg';

const INVITATION_TYPES = ['INVITATION_TOKEN', 'ONBOARDING_INVITATION_TOKEN'] as const;

/**
 * Twenty GraphQL sendInvitations returns AppToken.id, but signUpInWorkspace
 * expects AppToken.value (64-char hex invite token).
 */
export async function fetchTwentyInvitationTokenValue(params: {
  workspaceId: string;
  appTokenId: string;
  memberEmail?: string;
}): Promise<string | null> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return null;

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const byId = await client.query<{ value: string }>(
      `SELECT value
       FROM core."appToken"
       WHERE id = $1::uuid
         AND "workspaceId" = $2::uuid
         AND type = ANY($3::text[])
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [params.appTokenId, params.workspaceId, INVITATION_TYPES],
    );
    if (byId.rows[0]?.value) return byId.rows[0].value;

    if (params.memberEmail) {
      const email = params.memberEmail.trim().toLowerCase();
      const byEmail = await client.query<{ value: string }>(
        `SELECT value
         FROM core."appToken"
         WHERE "workspaceId" = $1::uuid
           AND type = ANY($2::text[])
           AND "deletedAt" IS NULL
           AND lower(context->>'email') = $3
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [params.workspaceId, INVITATION_TYPES, email],
      );
      return byEmail.rows[0]?.value ?? null;
    }

    return null;
  } finally {
    await client.end();
  }
}
