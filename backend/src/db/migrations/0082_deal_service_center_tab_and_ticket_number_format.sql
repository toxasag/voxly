-- 0082_deal_service_center_tab_and_ticket_number_format.sql
-- 1. Вкладка «Сервисный центр» (position 18, строго между «Чат» и «Активность») в сделке (page_layout_tabs)
INSERT INTO page_layout_tabs
  (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
SELECT
  t.id,
  'deal',
  'repairs',
  'Сервисный центр',
  'Wrench',
  18,
  true,
  'service_center',
  'service_center:read'
FROM tenants t
WHERE EXISTS (
  SELECT 1 FROM installed_modules i
  WHERE i.tenant_id = t.id AND i.slug = 'service_center'
)
ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
SET title = 'Сервисный центр',
    icon = 'Wrench',
    position = 18,
    is_active = true,
    module_slug = 'service_center',
    required_permission = 'service_center:read';

-- 2. Перевод существующих сделок по ремонтам с этапа «Первый контакт» на стартовый этап «Новый лид»
UPDATE deals d
SET stage_id = s_new.id, updated_at = now()
FROM stages s_old, stages s_new
WHERE d.stage_id = s_old.id
  AND s_old.pipeline_id = d.pipeline_id
  AND (s_old.name = 'Первый контакт' OR s_old.name ILIKE '%первый контакт%')
  AND s_new.pipeline_id = d.pipeline_id
  AND (s_new.name = 'Новый лид' OR s_new.name ILIKE '%новый лид%')
  AND EXISTS (SELECT 1 FROM repair_orders ro WHERE ro.deal_id = d.id);

-- 3. Приведение формата существующих номеров нарядов к компактному виду №XXXX
UPDATE repair_orders
SET ticket_number = '№' || substring(ticket_number from '\d+$')
WHERE ticket_number LIKE 'ЗН-%';
