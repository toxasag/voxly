-- Вкладка «Ремонты» на карточке контакта для арендаторов, у которых
-- service_center уже установлен. Без этой миграции вкладка появилась бы только
-- после повторного toggle: applyModuleInstall вызывается при установке, а не
-- при старте сервера.
--
-- ON CONFLICT DO NOTHING: если арендатор уже правил строку (title/position),
-- сид её не затирает.

INSERT INTO page_layout_tabs
  (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
SELECT
  i.tenant_id,
  'contact',
  'repairs',
  'Ремонты',
  'Wrench',
  20,
  true,
  'service_center',
  'service_center:read'
FROM installed_modules i
WHERE i.slug = 'service_center'
ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;
