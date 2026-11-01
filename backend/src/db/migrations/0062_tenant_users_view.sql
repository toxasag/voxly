-- ---------------------------------------------------------------------------
-- 0062_tenant_users_view.sql
--
-- View exposing tenant-user associations and partner parent-child relationships.
-- Enables unified querying of tenant members and partner access roles.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW tenant_users AS
SELECT 
  u.id AS id,
  u.id AS user_id,
  u.tenant_id,
  u.role,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.deleted_at IS NULL
UNION ALL
SELECT 
  md5(parent_u.id::text || child_t.id::text)::uuid AS id,
  parent_u.id AS user_id,
  child_t.id AS tenant_id,
  'partner' AS role,
  child_t.created_at,
  child_t.updated_at
FROM tenants child_t
JOIN users parent_u ON parent_u.tenant_id = child_t.parent_tenant_id AND parent_u.role IN ('owner', 'admin') AND parent_u.deleted_at IS NULL
WHERE child_t.parent_tenant_id IS NOT NULL;
