-- ---------------------------------------------------------------------------
-- Migration 0067: Multi-site & multi-counter analytics extensions
--
-- 1. Adds name and event_rules columns to analytics_integrations.
-- 2. Relaxes provider check constraint to support long names & aliases.
-- 3. Backfills existing rows and adds performance indexes.
-- 4. Ensures strict Row-Level Security (RLS) policies.
-- ---------------------------------------------------------------------------

ALTER TABLE analytics_integrations
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS event_rules JSONB NOT NULL DEFAULT '{"onLeadCreated": true, "onDealWon": true, "onFirstMessage": true}'::jsonb;

-- Расширяем check constraint для провайдеров
ALTER TABLE analytics_integrations
  DROP CONSTRAINT IF EXISTS analytics_integrations_provider_check;

ALTER TABLE analytics_integrations
  ADD CONSTRAINT analytics_integrations_provider_check
  CHECK (provider IN (
    'yandex', 'yandex_metrika',
    'ga4', 'google_analytics_4',
    'google_ads',
    'meta', 'meta_pixel',
    'vk', 'vk_ads'
  ));

-- Бэкфилл поля name
UPDATE analytics_integrations
SET name = COALESCE(NULLIF(name, ''), NULLIF(site_name, ''), 'Основной сайт')
WHERE name IS NULL OR name = '';

-- Индексы для фильтрации по сайтам и активным интеграциям
CREATE INDEX IF NOT EXISTS idx_analytics_integrations_tenant_active
  ON analytics_integrations (tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_analytics_integrations_tenant_site_url
  ON analytics_integrations (tenant_id, site_url);

-- RLS изоляция арендаторов
ALTER TABLE analytics_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_integrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_integrations_tenant_isolation ON analytics_integrations;
CREATE POLICY analytics_integrations_tenant_isolation ON analytics_integrations
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
