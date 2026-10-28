import pg from 'pg';

export const INTENTIONAL_EXCEPTIONS = new Set([
  'auth_sessions', 'contacts_company_backfill_0020', 'marketplace_modules', 'otp_codes',
  'password_reset_tokens', 'pgmigrations', 'pipelines', 'platform_billing_config',
  'platform_integrations_config', 'refresh_tokens', 'repair_counters', 'reserved_slugs',
  'stages', 'tenant_audit_log', 'tenants', 'users',
]);

export const PARENT_SCOPED_EXCEPTIONS = new Set(['invoice_items']);

export function classifyRlsRows(rows) {
  return rows.map((row) => {
    const intentional = INTENTIONAL_EXCEPTIONS.has(row.table_name);
    const parentScoped = PARENT_SCOPED_EXCEPTIONS.has(row.table_name);
    const violations = [];
    if (!intentional && !parentScoped && !row.has_tenant_id) violations.push('missing tenant_id NOT NULL');
    if (!intentional && !row.rls_enabled) violations.push('RLS disabled');
    if (!intentional && !row.rls_forced) violations.push('FORCE RLS disabled');
    if (!intentional && !row.has_policy) violations.push('policy missing');
    return { ...row, intentional, parentScoped, violations };
  });
}

export async function auditRls(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             EXISTS (
               SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema = 'public' AND col.table_name = c.relname
                 AND col.column_name = 'tenant_id' AND col.is_nullable = 'NO'
             ) AS has_tenant_id,
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
             ) AS has_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    const findings = classifyRlsRows(result.rows);
    return {
      tables: findings.length,
      intentionalExceptions: findings.filter((row) => row.intentional).map((row) => row.table_name),
      unexplained: findings.filter((row) => row.violations.length > 0)
        .map((row) => ({ table: row.table_name, violations: row.violations })),
    };
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('/rls-audit.mjs')) {
  const runtime = process.argv[2];
  if (!runtime) {
    console.error('Usage: node scripts/rls-audit.mjs <database-url>');
    process.exit(2);
  }
  const result = await auditRls(runtime);
  console.log(JSON.stringify({ ...result, result: result.unexplained.length === 0 ? 'passed' : 'failed' }, null, 2));
  if (result.unexplained.length > 0) process.exitCode = 1;
}
