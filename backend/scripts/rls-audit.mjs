import pg from 'pg';

// Tables that are deliberately outside tenant RLS because they are used before a
// tenant context exists or are platform-wide catalogs. Keep this list explicit:
// adding a table here hides a finding and therefore requires a code review.
export const INTENTIONAL_EXCEPTIONS = new Set([
  'auth_sessions', 'contacts_company_backfill_0020', 'marketplace_modules', 'otp_codes',
  'password_reset_tokens', 'pgmigrations', 'pipelines', 'platform_billing_config',
  'platform_integrations_config', 'refresh_tokens', 'repair_counters', 'reserved_slugs',
  'stages', 'tenant_audit_log', 'tenants', 'users',
]);

// invoice_items is scoped through invoices.invoice_id, not a duplicated tenant_id.
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
    // A policy existing is not enough: a permissive policy without a tenant
    // predicate silently turns RLS into "enabled but ineffective". The SQL
    // audit supplies this flag from pg_policies; unit fixtures default to true
    // for backwards-compatible, focused classification tests.
    if (!intentional && row.policy_tenant_scoped === false) violations.push('policy is not tenant-scoped');
    if (!intentional && !parentScoped && row.has_tenant_id && row.has_unsafe_tenant_foreign_key) {
      violations.push('tenant-unsafe foreign key');
    }
    if (!intentional && parentScoped && row.parent_scope_policy === false) {
      violations.push('parent-scope policy missing');
    }
    return { ...row, intentional, parentScoped, violations };
  });
}

export async function auditRls(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      WITH table_columns AS (
        SELECT table_name,
               bool_or(column_name = 'tenant_id' AND is_nullable = 'NO') AS has_tenant_id,
               bool_or(column_name = 'tenant_id') AS has_any_tenant_id
        FROM information_schema.columns
        WHERE table_schema = 'public'
        GROUP BY table_name
      ), policy_scope AS (
        SELECT p.tablename AS table_name,
               bool_or(
                 COALESCE(p.qual::text, '') ~* '(tenant_id|current_tenant_id|app\\.tenant_id)'
                 OR COALESCE(p.with_check::text, '') ~* '(tenant_id|current_tenant_id|app\\.tenant_id)'
               ) AS policy_tenant_scoped,
               bool_or(
                 COALESCE(p.qual::text, '') ~* '(invoice_id|invoices)'
                 OR COALESCE(p.with_check::text, '') ~* '(invoice_id|invoices)'
               ) AS parent_scope_policy
        FROM pg_policies p
        WHERE p.schemaname = 'public'
        GROUP BY p.tablename
      ), unsafe_fks AS (
        SELECT src.relname AS table_name
        FROM pg_constraint fk
        JOIN pg_class src ON src.oid = fk.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
        JOIN pg_class dst ON dst.oid = fk.confrelid
        JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
        JOIN table_columns src_cols ON src_cols.table_name = src.relname
        JOIN table_columns dst_cols ON dst_cols.table_name = dst.relname
        WHERE fk.contype = 'f'
          AND src_ns.nspname = 'public' AND dst_ns.nspname = 'public'
          AND src_cols.has_any_tenant_id AND dst_cols.has_any_tenant_id
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(fk.conkey) AS source_attnum
            JOIN pg_attribute source_attr
              ON source_attr.attrelid = src.oid AND source_attr.attnum = source_attnum
            WHERE source_attr.attname = 'tenant_id'
          )
      )
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             COALESCE(cols.has_tenant_id, false) AS has_tenant_id,
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
             ) AS has_policy,
             COALESCE(scope.policy_tenant_scoped, false) AS policy_tenant_scoped,
             COALESCE(scope.parent_scope_policy, false) AS parent_scope_policy,
             EXISTS (
               SELECT 1 FROM unsafe_fks f WHERE f.table_name = c.relname
             ) AS has_unsafe_tenant_foreign_key
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN table_columns cols ON cols.table_name = c.relname
      LEFT JOIN policy_scope scope ON scope.table_name = c.relname
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    const findings = classifyRlsRows(result.rows);
    return {
      tables: findings.length,
      intentionalExceptions: findings.filter((row) => row.intentional).map((row) => row.table_name),
      parentScopedExceptions: findings.filter((row) => row.parentScoped).map((row) => row.table_name),
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
