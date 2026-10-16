-- Вкладка «Счета» на карточке компании для арендаторов с установленным finance.
-- Без этой миграции вкладка появилась бы только после повторного toggle.

INSERT INTO page_layout_tabs
  (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
SELECT
  i.tenant_id,
  'company',
  'invoices',
  'Счета',
  'Receipt',
  20,
  true,
  'finance',
  'finance:read'
FROM installed_modules i
WHERE i.slug = 'finance'
ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;
