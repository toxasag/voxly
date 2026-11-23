-- ---------------------------------------------------------------------------
-- 0128_add_bots_table.sql
--
-- Таблица `bots` для автоматической регистрации и управления конфигурациями ботов,
-- с поддержкой уникальности имени, RLS-изоляции арендаторов и связью с channel_accounts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(64) NOT NULL,
  token TEXT NOT NULL,
  token_encrypted BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(32) NOT NULL DEFAULT 'connected' CHECK (status IN ('pending', 'connected', 'error', 'disabled')),
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс по арендатору и уникальное имя бота в системе
CREATE INDEX IF NOT EXISTS idx_bots_tenant ON bots (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_username ON bots (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_bots_channel_account ON bots (channel_account_id);

-- RLS-изоляция арендаторов
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bots' AND policyname = 'bots_tenant_isolation'
  ) THEN
    CREATE POLICY bots_tenant_isolation ON bots
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

GRANT ALL ON bots TO app_user;

-- Триггер обновления updated_at
DROP TRIGGER IF EXISTS trg_bots_updated_at ON bots;
CREATE TRIGGER trg_bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
