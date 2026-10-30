-- Добавление вкладки «Аналитика» в карточку сделки (page_layout_tabs)
-- и очистка технических идентификаторов веб-аналитики из контактов и сделок.

DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    -- Вкладка «Аналитика» в карточку сделки (позиция 22 между timeline 20 и contact-history 25)
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'deal', 'analytics', 'Аналитика', 'BarChart3', 22, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
      SET title = EXCLUDED.title,
          icon = EXCLUDED.icon,
          position = EXCLUDED.position,
          is_active = true;
  END LOOP;
END $$;

-- 1. Очистка контактов: удаление аналитических ID (ym_, ya_, ga_, etc.) из socials
UPDATE contacts
SET socials = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements(socials) AS elem
  WHERE elem->>'value' NOT LIKE 'ym_%'
    AND elem->>'value' NOT LIKE 'ya_%'
    AND elem->>'value' NOT LIKE 'ga_%'
    AND elem->>'value' NOT LIKE 'dfp_%'
    AND elem->>'value' NOT LIKE 'usr_%'
)
WHERE socials IS NOT NULL AND jsonb_typeof(socials) = 'array' AND (
  socials::text LIKE '%ym_%'
  OR socials::text LIKE '%ya_%'
  OR socials::text LIKE '%ga_%'
);

-- 2. Очистка контактов: исправление ошибочного расщепления имени «Посетитель сайта (...)» и «Клиент»
UPDATE contacts
SET first_name = CASE 
      WHEN first_name LIKE 'Посетитель%' AND last_name LIKE 'сайта%' THEN first_name || ' ' || last_name
      ELSE first_name
    END,
    last_name = CASE 
      WHEN last_name LIKE '%сайта%' THEN ''
      ELSE last_name
    END
WHERE last_name LIKE '%сайта%';

-- 3. Исправление названий сделок: при наличии телефона отображать нормальный номер
UPDATE deals
SET title = 'Заявка от ' || c.phone || ' (Онлайн-чат)'
FROM contacts c
WHERE deals.contact_id = c.id
  AND (deals.title LIKE '%сайта%' OR deals.title LIKE 'Заявка от Клиент%')
  AND c.phone IS NOT NULL AND c.phone != '';
