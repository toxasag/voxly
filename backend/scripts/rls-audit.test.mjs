import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRlsRows, INTENTIONAL_EXCEPTIONS } from './rls-audit.mjs';

test('classifies known auth/catalog tables as intentional exceptions', () => {
  const [row] = classifyRlsRows([{
    table_name: 'users', rls_enabled: false, rls_forced: false,
    has_tenant_id: true, has_policy: false,
  }]);
  assert.equal(row.intentional, true);
  assert.deepEqual(row.violations, []);
  assert.equal(INTENTIONAL_EXCEPTIONS.has('users'), true);
});

test('fails unexplained business table without forced RLS', () => {
  const [row] = classifyRlsRows([{
    table_name: 'contacts', rls_enabled: true, rls_forced: false,
    has_tenant_id: true, has_policy: true,
  }]);
  assert.deepEqual(row.violations, ['FORCE RLS disabled']);
});

test('fails business table without tenant id, policy and RLS', () => {
  const [row] = classifyRlsRows([{
    table_name: 'business_data', rls_enabled: false, rls_forced: false,
    has_tenant_id: false, has_policy: false,
  }]);
  assert.deepEqual(row.violations, [
    'missing tenant_id NOT NULL', 'RLS disabled', 'FORCE RLS disabled', 'policy missing',
  ]);
});

test('fails a tenant table with a foreign key that does not carry tenant scope', () => {
  const [row] = classifyRlsRows([{
    table_name: 'deals', rls_enabled: true, rls_forced: true,
    has_tenant_id: true, has_policy: true, has_unsafe_tenant_foreign_key: true,
  }]);
  assert.deepEqual(row.violations, ['tenant-unsafe foreign key']);
});
