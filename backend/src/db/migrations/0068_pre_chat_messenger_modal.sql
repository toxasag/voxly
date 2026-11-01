-- ---------------------------------------------------------------------------
-- 0068_pre_chat_messenger_modal.sql
--
-- 1. Добавление колонок двухшагового пре-чат модала и A/B тестирования
--    в таблицу analytics_sessions:
--    - prechat_name: имя посетителя, указанное в форме модала
--    - prechat_lead_code: компактный человекочитаемый код (vx-XXXX)
--    - prechat_message: итоговый текст первого сообщения
--    - ab_variant: 'direct' или 'modal'
--    - is_converted_to_chat: флаг реального получения первого сообщения в CRM
--    - chat_converted_at: время фиксации первого входящего сообщения
-- 2. Создание таблицы prechat_modal_configs для настроек модала и A/B тестирования
-- 3. Создание таблицы prechat_telemetry_events для сбора показов, кликов и конверсий A/B
-- 4. Row-Level Security (RLS) и индексы производительности
-- ---------------------------------------------------------------------------

-- 1. Расширение analytics_sessions
ALTER TABLE analytics_sessions
  ADD COLUMN IF NOT EXISTS prechat_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS prechat_lead_code VARCHAR(16),
  ADD COLUMN IF NOT EXISTS prechat_message TEXT,
  ADD COLUMN IF NOT EXISTS ab_variant VARCHAR(16) DEFAULT 'modal',
  ADD COLUMN IF NOT EXISTS is_converted_to_chat BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chat_converted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_prechat_lead_code
  ON analytics_sessions (tenant_id, prechat_lead_code)
  WHERE prechat_lead_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_lead_code_lookup
  ON analytics_sessions (prechat_lead_code)
  WHERE prechat_lead_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_ab_variant
  ON analytics_sessions (tenant_id, ab_variant);

-- 2. Таблица конфигурации пре-чат модалов арендаторов
CREATE TABLE IF NOT EXISTS prechat_modal_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  ab_mode VARCHAR(32) NOT NULL DEFAULT 'split_50_50'
    CHECK (ab_mode IN ('split_50_50', 'always_modal', 'always_direct')),
  greeting_template TEXT NOT NULL DEFAULT 'Здравствуйте! Меня зовут {name}. (код: {code})',
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
  telegram_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_number TEXT DEFAULT NULL,
  telegram_username TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_prechat_modal_configs_tenant UNIQUE (tenant_id)
);

ALTER TABLE prechat_modal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prechat_modal_configs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'prechat_modal_configs' AND policyname = 'prechat_modal_configs_tenant_isolation'
  ) THEN
    CREATE POLICY prechat_modal_configs_tenant_isolation ON prechat_modal_configs
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 3. Таблица телеметрии A/B тестирования
CREATE TABLE IF NOT EXISTS prechat_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL
    CHECK (event_type IN ('impression', 'direct_click', 'modal_open', 'modal_submit', 'chat_started')),
  ab_variant VARCHAR(16) NOT NULL CHECK (ab_variant IN ('direct', 'modal')),
  messenger_type VARCHAR(32) DEFAULT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prechat_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prechat_telemetry_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'prechat_telemetry_events' AND policyname = 'prechat_telemetry_events_tenant_isolation'
  ) THEN
    CREATE POLICY prechat_telemetry_events_tenant_isolation ON prechat_telemetry_events
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prechat_telemetry_tenant_metrics
  ON prechat_telemetry_events (tenant_id, event_type, ab_variant);

CREATE INDEX IF NOT EXISTS idx_prechat_telemetry_created_at
  ON prechat_telemetry_events (tenant_id, created_at);

-- 4. Права для app_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON prechat_modal_configs TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON prechat_telemetry_events TO app_user;
  END IF;
END $$;
