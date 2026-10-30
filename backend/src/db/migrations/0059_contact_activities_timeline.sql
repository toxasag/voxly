-- ---------------------------------------------------------------------------
-- 0059_contact_activities_timeline.sql
--
-- Сквозной таймлайн активности клиента: дискретные бизнес-события и
-- агрегированные сессии взаимодействия (веб-активность, лидогенерация, мессенджеры).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  activity_channel VARCHAR(50) NOT NULL,
  activity_kind VARCHAR(50) NOT NULL,
  direction VARCHAR(20) DEFAULT NULL,
  title VARCHAR(500) NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(255),
  client_handle VARCHAR(255),
  external_account_id VARCHAR(255),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- RLS
ALTER TABLE contact_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_activities FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_activities' AND policyname = 'contact_activities_tenant_isolation'
  ) THEN
    CREATE POLICY contact_activities_tenant_isolation ON contact_activities
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contact_activities_tenant_contact
  ON contact_activities (tenant_id, contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_activities_deal
  ON contact_activities (tenant_id, deal_id)
  WHERE deal_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON contact_activities TO app_user;
