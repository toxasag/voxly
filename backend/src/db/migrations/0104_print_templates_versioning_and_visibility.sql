-- 0104_print_templates_versioning_and_visibility.sql
-- Версионирование шаблонов печати (клиентские копии) и управление видимостью при печати

ALTER TABLE print_templates
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_template_id UUID REFERENCES print_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_custom ON print_templates(tenant_id, is_custom);
CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_hidden ON print_templates(tenant_id, is_hidden);

-- Очистка моковых значений по умолчанию в print_template_settings
ALTER TABLE print_template_settings
  ALTER COLUMN company_name SET DEFAULT '',
  ALTER COLUMN company_address SET DEFAULT '',
  ALTER COLUMN company_phone SET DEFAULT '',
  ALTER COLUMN company_website SET DEFAULT '',
  ALTER COLUMN logo_url SET DEFAULT '';

-- Для существующих тенантов, у которых company_name остался дефолтным моком,
-- обновляем company_name на реальное название тенанта
UPDATE print_template_settings pts
SET company_name = t.name
FROM tenants t
WHERE pts.tenant_id = t.id
  AND (pts.company_name = 'Ремонт инструмента ИП Сагайдак А.Г.' OR pts.company_name = '');
