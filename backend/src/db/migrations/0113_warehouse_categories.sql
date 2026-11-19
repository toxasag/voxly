-- =============================================================================
-- Migration 0113: Create warehouse_categories table with multi-tenant RLS
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouse_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_warehouse_categories_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE warehouse_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON warehouse_categories;
CREATE POLICY tenant_isolation ON warehouse_categories
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_warehouse_categories_tenant_name
  ON warehouse_categories (tenant_id, lower(name));
