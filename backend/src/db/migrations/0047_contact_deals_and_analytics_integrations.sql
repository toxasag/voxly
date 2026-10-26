-- ---------------------------------------------------------------------------
-- 0047_contact_deals_and_analytics_integrations.sql
--
-- 1. Связь «Контакт 1 : N Сделки»: внешний ключ и индекс idx_deals_tenant_contact.
-- 2. Таблица analytics_integrations для серверных конверсий (Yandex, GA4, Meta, VK, Google Ads).
-- 3. RLS-политики и индекс по tenant_id.
-- 4. Стандартные вкладки карточек deals-history и contact-history.
-- ---------------------------------------------------------------------------

-- 1. Внешний ключ deals.contact_id -> contacts.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'deals_contact_id_fkey' AND table_name = 'deals'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Индекс по (tenant_id, contact_id) для быстрой выборки истории сделок контакта
CREATE INDEX IF NOT EXISTS idx_deals_tenant_contact
  ON deals (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- 2. Таблица настроек интеграций серверной веб-аналитики
CREATE TABLE IF NOT EXISTS analytics_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('yandex', 'ga4', 'google_ads', 'meta', 'vk')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_analytics_integrations_tenant_provider UNIQUE (tenant_id, provider)
);

-- RLS изоляция арендаторов
ALTER TABLE analytics_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_integrations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'analytics_integrations' AND policyname = 'analytics_integrations_tenant_isolation'
  ) THEN
    CREATE POLICY analytics_integrations_tenant_isolation ON analytics_integrations
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_integrations_tenant ON analytics_integrations (tenant_id);

-- Триггер обновления updated_at
DROP TRIGGER IF EXISTS trg_analytics_integrations_updated_at ON analytics_integrations;
CREATE TRIGGER trg_analytics_integrations_updated_at
  BEFORE UPDATE ON analytics_integrations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 3. Добавление вкладок в page_layout_tabs для всех существующих тенантов
DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    -- Вкладка «История обращений / Сделки» в карточку контакта
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'contact', 'deals-history', 'История обращений / Сделки', 'Briefcase', 18, true, NULL, 'deals:read')
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;

    -- Вкладка «История контакта» в карточку сделки
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'deal', 'contact-history', 'История контакта', 'History', 25, true, NULL, 'contacts:read')
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;
  END LOOP;
END $$;
