/**
 * Clear Twenty onboarding pending flags so new workspaces skip /install-apps,
 * /create/profile, /sync/emails, /invite-team.
 *
 * GraphQL `triggerInstallAppsOnboardingStep([])` only deletes INSTALL_APPS and
 * can race workspace creation (flags written in the same signup transaction).
 * SQL is the reliable post-provision cleanup (same pattern as customDomain).
 */
import pg from 'pg';

const ONBOARDING_KEYS = [
  'ONBOARDING_INSTALL_APPS_PENDING',
  'ONBOARDING_CREATE_PROFILE_PENDING',
  'ONBOARDING_CONNECT_ACCOUNT_PENDING',
  'ONBOARDING_INVITE_TEAM_PENDING',
] as const;

export async function clearTwentyOnboardingFlags(workspaceId: string): Promise<number> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[provisioning] TWENTY_DATABASE_URL unset — cannot clear onboarding flags',
    );
    return 0;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `DELETE FROM core."keyValuePair"
       WHERE "workspaceId" = $1::uuid
         AND key = ANY($2::text[])`,
      [workspaceId, [...ONBOARDING_KEYS]],
    );
    const n = result.rowCount ?? 0;
    console.log(
      `[provisioning] cleared ${n} onboarding flag(s) for workspace=${workspaceId}`,
    );
    return n;
  } finally {
    await client.end();
  }
}
