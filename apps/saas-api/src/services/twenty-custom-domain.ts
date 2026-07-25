/**
 * Twenty GraphQL `updateWorkspace(customDomain)` requires CLOUDFLARE_API_KEY
 * (Twenty Cloud DNS). Voxly terminates TLS at NPM/Traefik with wildcard
 * `*-crm.getvoxly.ru`, so we set customDomain directly in Twenty Postgres.
 *
 * See Twenty issue #17101 / INC-025 follow-up.
 */
import pg from 'pg';

export async function ensureTwentyCustomDomain(
  workspaceId: string,
  customDomain: string,
): Promise<boolean> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[provisioning] TWENTY_DATABASE_URL unset — cannot set customDomain without Cloudflare',
    );
    return false;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE core.workspace
       SET "customDomain" = $1,
           "isCustomDomainEnabled" = true,
           "updatedAt" = now()
       WHERE id = $2::uuid
       RETURNING id, subdomain, "customDomain", "isCustomDomainEnabled"`,
      [customDomain, workspaceId],
    );
    if (result.rowCount !== 1) {
      console.warn(
        `[provisioning] customDomain update matched 0 rows (workspaceId=${workspaceId})`,
      );
      return false;
    }
    console.log(
      `[provisioning] customDomain set via SQL: ${JSON.stringify(result.rows[0])}`,
    );
    return true;
  } finally {
    await client.end();
  }
}
