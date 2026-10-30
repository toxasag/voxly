-- ---------------------------------------------------------------------------
-- 0060_source_metadata_and_tabs.sql
--
-- 1. Добавление колонки source_metadata (JSONB) в таблицы contacts и deals
-- 2. Вставка вкладки «Источник» (tab_key: 'source') в page_layout_tabs
-- 3. Очистка устаревших технических префиксов [Устройство:...][Страница:...] из deal_messages
-- 4. Бэкфилл source_metadata из существующих custom_fields
-- ---------------------------------------------------------------------------

-- 1. Добавляем колонку source_metadata
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Вставка вкладки «Источник» в page_layout_tabs для всех тенантов
DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    -- Вкладка «Источник» в карточку сделки (позиция 24 рядом с аналитикой и историей контакта)
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'deal', 'source', 'Источник', 'Globe', 24, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
      SET title = EXCLUDED.title,
          icon = EXCLUDED.icon,
          position = EXCLUDED.position,
          is_active = true;

    -- Вкладка «Источник» в карточку контакта (позиция 22)
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'contact', 'source', 'Источник', 'Globe', 22, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
      SET title = EXCLUDED.title,
          icon = EXCLUDED.icon,
          position = EXCLUDED.position,
          is_active = true;
  END LOOP;
END $$;

-- 3. Очистка устаревших системных префиксов из ленты переписки deal_messages
UPDATE deal_messages
SET content = trim(both from regexp_replace(
  content,
  '^(\[(Устройство|Страница|UTM|Реклама ClickID|Яндекс ID|YM ClientID|GA ClientID|Top\.Mail\.ru|История переходов|Визит №|Черновик)[^\]]*\]\s*)+',
  '',
  'g'
))
WHERE content LIKE '%[Устройство:%'
   OR content LIKE '%[Страница:%'
   OR content LIKE '%[UTM:%'
   OR content LIKE '%[Реклама ClickID:%';

-- 4. Первичный бэкфилл source_metadata для сделок из custom_fields
UPDATE deals
SET source_metadata = jsonb_strip_nulls(jsonb_build_object(
  'device', custom_fields->'device_info',
  'page', jsonb_build_object(
    'url', COALESCE(custom_fields->>'page_url', custom_fields->>'last_page_url'),
    'title', custom_fields->>'page_title'
  ),
  'utm', custom_fields->'utm_tags',
  'clickIds', custom_fields->'click_ids',
  'referrer', custom_fields->>'referrer',
  'network', jsonb_build_object(
    'ip', COALESCE(custom_fields->>'ip', custom_fields->>'client_ip', custom_fields->'device_info'->>'ip')
  ),
  'visitCount', custom_fields->'visit_count',
  'pageHistory', custom_fields->'page_history'
))
WHERE (source_metadata IS NULL OR source_metadata = '{}'::jsonb)
  AND (
    custom_fields->'device_info' IS NOT NULL OR
    custom_fields->>'page_url' IS NOT NULL OR
    custom_fields->'utm_tags' IS NOT NULL OR
    custom_fields->>'referrer' IS NOT NULL
  );

-- Первичный бэкфилл source_metadata для контактов из custom_fields
UPDATE contacts
SET source_metadata = jsonb_strip_nulls(jsonb_build_object(
  'device', custom_fields->'device_info',
  'page', jsonb_build_object(
    'url', COALESCE(custom_fields->>'page_url', custom_fields->>'last_page_url'),
    'title', custom_fields->>'page_title'
  ),
  'utm', custom_fields->'utm_tags',
  'clickIds', custom_fields->'click_ids',
  'referrer', custom_fields->>'referrer',
  'network', jsonb_build_object(
    'ip', COALESCE(custom_fields->>'ip', custom_fields->>'client_ip', custom_fields->'device_info'->>'ip')
  ),
  'visitCount', custom_fields->'visit_count',
  'pageHistory', custom_fields->'page_history'
))
WHERE (source_metadata IS NULL OR source_metadata = '{}'::jsonb)
  AND (
    custom_fields->'device_info' IS NOT NULL OR
    custom_fields->>'page_url' IS NOT NULL OR
    custom_fields->'utm_tags' IS NOT NULL OR
    custom_fields->>'referrer' IS NOT NULL
  );
