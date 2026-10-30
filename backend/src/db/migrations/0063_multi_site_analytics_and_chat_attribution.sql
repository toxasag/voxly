-- ---------------------------------------------------------------------------
-- 0063_multi_site_analytics_and_chat_attribution.sql
--
-- 1. Снятие ограничения UNIQUE (tenant_id, provider) в analytics_integrations
--    для поддержки множественных сайтов и счётчиков одного провайдера.
-- 2. Добавление колонок site_name, site_url, counter_id, channel_account_id, is_default.
-- 3. Ослабление ограничения deal_id в conversion_delivery_attempts для тестовых задач
--    и добавление is_test, job_id.
-- 4. Создание таблицы analytics_sessions для сквозного deep-link трекинга и фиксации
--    первого входящего сообщения (защита от пустых кликов).
-- 5. Создание таблицы yandex_chat_conversions для двухфазной выгрузки чатов в Яндекс.Метрику.
-- 6. Row-Level Security (RLS) для всех создаваемых сущностей.
-- ---------------------------------------------------------------------------

-- 1. Модификация analytics_integrations для поддержки нескольких сайтов/счётчиков
ALTER TABLE analytics_integrations
  DROP CONSTRAINT IF EXISTS uq_analytics_integrations_tenant_provider;

ALTER TABLE analytics_integrations
  ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS counter_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- Бэкфилл данных существующих интеграций
UPDATE analytics_integrations
SET
  site_name = CASE
    WHEN site_name IS NULL OR site_name = '' THEN 'Основной сайт'
    ELSE site_name
  END,
  is_default = true,
  counter_id = COALESCE(counter_id, config->>'counterId', config->>'measurementId', config->>'pixelId')
WHERE is_default IS FALSE;

CREATE INDEX IF NOT EXISTS idx_analytics_integrations_tenant_site
  ON analytics_integrations (tenant_id, provider, is_default);

-- 2. Поддержка тестовых очередей в conversion_delivery_attempts
ALTER TABLE conversion_delivery_attempts
  ALTER COLUMN deal_id DROP NOT NULL;

ALTER TABLE conversion_delivery_attempts
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS job_id TEXT DEFAULT NULL;

-- 3. Таблица сессий сквозной атрибуции мессенджеров
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_token VARCHAR(64) NOT NULL,
  
  -- Идентификаторы систем веб-аналитики и рекламы
  ga_client_id VARCHAR(64),
  ym_client_id VARCHAR(64),
  yandexuid VARCHAR(64),
  gclid VARCHAR(128),
  yclid VARCHAR(128),
  fbclid VARCHAR(128),
  vkclid VARCHAR(128),
  
  -- Контекст перехода и UTM-метки
  utm_source VARCHAR(255),
  utm_medium VARCHAR(255),
  utm_campaign VARCHAR(255),
  utm_content VARCHAR(255),
  utm_term VARCHAR(255),
  referrer TEXT,
  page_url TEXT,
  
  -- Привязка к виджету и мессенджеру
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  messenger_type VARCHAR(32) NOT NULL CHECK (messenger_type IN ('telegram', 'whatsapp', 'vk', 'max', 'webchat')),
  messenger_user_id VARCHAR(64),
  messenger_username VARCHAR(255),
  messenger_chat_id VARCHAR(64),
  
  -- Статусы воронки: clicked (клик) -> opened (/start) -> first_message_received (написал) -> channel_subscribed (подписался)
  status VARCHAR(32) NOT NULL DEFAULT 'clicked'
    CHECK (status IN ('clicked', 'opened', 'first_message_received', 'channel_subscribed')),
    
  -- Флаги отправки конверсий в рекламные кабинеты
  yandex_conversion_sent BOOLEAN NOT NULL DEFAULT false,
  ga4_conversion_sent BOOLEAN NOT NULL DEFAULT false,
  google_ads_conversion_sent BOOLEAN NOT NULL DEFAULT false,
  meta_conversion_sent BOOLEAN NOT NULL DEFAULT false,
  vk_conversion_sent BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_message_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  
  CONSTRAINT uq_analytics_sessions_tenant_token UNIQUE (tenant_id, session_token)
);

ALTER TABLE analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_sessions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'analytics_sessions' AND policyname = 'analytics_sessions_tenant_isolation'
  ) THEN
    CREATE POLICY analytics_sessions_tenant_isolation ON analytics_sessions
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_lookup
  ON analytics_sessions (tenant_id, session_token);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_messenger
  ON analytics_sessions (messenger_type, messenger_user_id)
  WHERE messenger_user_id IS NOT NULL;

-- 4. Таблица выгрузки офлайн-чатов в Яндекс.Метрику (POST /offline_conversions/upload?type=CHATS)
CREATE TABLE IF NOT EXISTS yandex_chat_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  counter_id TEXT NOT NULL,
  chat_platform TEXT NOT NULL CHECK (chat_platform IN ('telegram', 'whatsapp', 'viber')),
  chat_user_id TEXT,
  chat_username TEXT,
  phone_number TEXT,
  client_id TEXT,
  yclid TEXT,
  initial_datetime BIGINT NOT NULL, -- Unix Timestamp в секундах (UTC)
  chat_answered INT NOT NULL DEFAULT 0,
  price NUMERIC(12, 2) DEFAULT 0,
  currency TEXT DEFAULT 'RUB',
  source_url TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  upload_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_yandex_chat_conversions_key UNIQUE (tenant_id, counter_id, initial_datetime, chat_platform, chat_user_id)
);

ALTER TABLE yandex_chat_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yandex_chat_conversions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'yandex_chat_conversions' AND policyname = 'yandex_chat_conversions_tenant_isolation'
  ) THEN
    CREATE POLICY yandex_chat_conversions_tenant_isolation ON yandex_chat_conversions
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_yandex_chat_conversions_deal
  ON yandex_chat_conversions (tenant_id, deal_id)
  WHERE deal_id IS NOT NULL;
