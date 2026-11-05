-- 0074: repair services catalog
--
-- Reference catalogue of repair services and standard operations with default prices
-- strictly isolated per tenant via Row-Level Security.

CREATE TABLE IF NOT EXISTS repair_services_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE repair_services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_services_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON repair_services_catalog;
CREATE POLICY tenant_isolation ON repair_services_catalog
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_repair_services_catalog_tenant
  ON repair_services_catalog (tenant_id, name);
