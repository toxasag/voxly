-- =============================================================================
-- 0095: Индивидуальные квоты и лимиты функций тенантов (Tenant Feature Quotas)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_feature_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key VARCHAR(64) NOT NULL,
  is_unlimited BOOLEAN NOT NULL DEFAULT false,
  max_limit INT NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_feature_quotas UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_feature_quotas_tenant
  ON tenant_feature_quotas(tenant_id);

ALTER TABLE tenant_feature_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_quotas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_feature_quotas_isolation ON tenant_feature_quotas;
CREATE POLICY tenant_feature_quotas_isolation ON tenant_feature_quotas
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id() OR platform_scope());
