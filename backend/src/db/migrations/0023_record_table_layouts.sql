CREATE TABLE IF NOT EXISTS record_table_layouts (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,
  layout JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, table_id),
  CONSTRAINT record_table_layouts_table_id_valid CHECK (
    table_id IN ('contacts', 'companies', 'deals', 'tasks')
  ),
  CONSTRAINT record_table_layouts_layout_object CHECK (jsonb_typeof(layout) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_record_table_layouts_user
  ON record_table_layouts (tenant_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON record_table_layouts TO app_user;

DROP TRIGGER IF EXISTS trg_record_table_layouts_updated_at ON record_table_layouts;
CREATE TRIGGER trg_record_table_layouts_updated_at
  BEFORE UPDATE ON record_table_layouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE record_table_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_table_layouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON record_table_layouts;
CREATE POLICY tenant_isolation ON record_table_layouts
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
