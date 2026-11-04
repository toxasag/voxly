-- 0071: Таблица недавних поисков ключевых слов SEO с изоляцией RLS

CREATE TABLE IF NOT EXISTS seo_recent_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  query VARCHAR(255) NOT NULL,
  country VARCHAR(50) NOT NULL,
  location VARCHAR(100) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_recent_searches_tenant_updated
  ON seo_recent_searches (tenant_id, updated_at DESC);

ALTER TABLE seo_recent_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_recent_searches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seo_recent_searches_tenant_isolation ON seo_recent_searches;
CREATE POLICY seo_recent_searches_tenant_isolation ON seo_recent_searches
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
