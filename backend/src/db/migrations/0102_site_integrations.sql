-- ---------------------------------------------------------------------------
-- 0102_site_integrations.sql
--
-- Таблица site_integrations для приёма лидов с внешних сайтов (Tilda, WordPress,
-- Webflow, кастомные формы) через персональные Webhook URL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  site_url VARCHAR(500) DEFAULT NULL,
  webhook_token VARCHAR(64) NOT NULL,
  target_pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  target_stage_id UUID REFERENCES stages(id) ON DELETE SET NULL,
  field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  leads_count INT NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс по арендатору и уникальный токен вебхука
CREATE INDEX IF NOT EXISTS idx_site_integrations_tenant ON site_integrations (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_integrations_webhook_token ON site_integrations (webhook_token);

-- RLS изоляция арендаторов
ALTER TABLE site_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_integrations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'site_integrations' AND policyname = 'site_integrations_tenant_isolation'
  ) THEN
    CREATE POLICY site_integrations_tenant_isolation ON site_integrations
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

GRANT ALL ON site_integrations TO app_user;

-- Автоматическое обновление updated_at
DROP TRIGGER IF EXISTS trg_site_integrations_updated_at ON site_integrations;
CREATE TRIGGER trg_site_integrations_updated_at
  BEFORE UPDATE ON site_integrations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
