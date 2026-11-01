-- -----------------------------------------------------------------------------
-- 0065_widget_analytics_events.sql
--
-- 1. Создание таблицы widget_analytics_events для 5-ступенчатой воронки конверсий
--    онлайн-виджета (channel_accounts, channel = 'webchat'):
--    - Посетители (VISIT)
--    - Запуски виджета (WIDGET_OPEN)
--    - Начатые диалоги (CHAT_START)
--    - Заявки / Лиды (LEAD_CAPTURED)
--    - Продажи (WON - из deals / stages)
-- 2. Привязка сделок к сайту/виджету через source_widget_id в deals.
-- 3. Row-Level Security (RLS) и индексы дедупликации/выборки.
-- -----------------------------------------------------------------------------

-- 1. Таблица событий аналитики виджета
CREATE TABLE IF NOT EXISTS widget_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  widget_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('VISIT', 'WIDGET_OPEN', 'CHAT_START', 'LEAD_CAPTURED')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_widget_analytics_session_event UNIQUE (widget_id, session_id, event_type)
);

ALTER TABLE widget_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_analytics_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'widget_analytics_events' AND policyname = 'widget_analytics_events_tenant_isolation'
  ) THEN
    CREATE POLICY widget_analytics_events_tenant_isolation ON widget_analytics_events
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_widget_analytics_events_lookup
  ON widget_analytics_events (tenant_id, widget_id, created_at, event_type);

CREATE INDEX IF NOT EXISTS idx_widget_analytics_events_widget_time
  ON widget_analytics_events (widget_id, created_at);

-- 2. Добавление колонки source_widget_id в deals для сквозной атрибуции продаж
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source_widget_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_source_widget_id
  ON deals (tenant_id, source_widget_id)
  WHERE source_widget_id IS NOT NULL;

-- 3. Бэкфилл атрибуции существующих сделок, созданных через webchat
UPDATE deals d
SET source_widget_id = sub.channel_account_id
FROM (
  SELECT deal_id, channel_account_id
  FROM deal_messages
  WHERE channel = 'webchat' AND channel_account_id IS NOT NULL
  GROUP BY deal_id, channel_account_id
) sub
WHERE d.id = sub.deal_id
  AND d.source_widget_id IS NULL;

-- 4. Права роли app_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON widget_analytics_events TO app_user;
  END IF;
END $$;
