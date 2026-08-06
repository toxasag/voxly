/**
 * Clear Twenty onboarding pending flags so new workspaces skip /install-apps,
 * /sync/emails, /invite-team — but **keep** /create/profile (FIO required).
 *
 * GraphQL `triggerInstallAppsOnboardingStep([])` only deletes INSTALL_APPS and
 * can race workspace creation (flags written in the same signup transaction).
 * SQL is the reliable post-provision cleanup (same pattern as customDomain).
 */
import pg from 'pg';

/** Keys to clear — CREATE_PROFILE intentionally excluded (ADR-010 amend). */
const ONBOARDING_KEYS_TO_CLEAR = [
  'ONBOARDING_INSTALL_APPS_PENDING',
  'ONBOARDING_CONNECT_ACCOUNT_PENDING',
  'ONBOARDING_INVITE_TEAM_PENDING',
  // Sync-email step (GraphQL skipSyncEmailOnboardingStep may no-op).
  'ONBOARDING_SYNC_EMAIL_PENDING',
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
      [workspaceId, [...ONBOARDING_KEYS_TO_CLEAR]],
    );
    const n = result.rowCount ?? 0;
    console.log(
      `[provisioning] cleared ${n} onboarding flag(s) for workspace=${workspaceId} (CREATE_PROFILE kept)`,
    );
    return n;
  } finally {
    await client.end();
  }
}
