-- 0094_visual_print_templates.sql
-- Расширение таблицы print_templates для визуального конструктора:
-- document_type, layout_config JSONB, частичный уникальный индекс на дефолтный шаблон.

ALTER TABLE print_templates 
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(64) NOT NULL DEFAULT 'work_order',
  ADD COLUMN IF NOT EXISTS layout_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Для существующих строк проставляем document_type равным slug
UPDATE print_templates
SET document_type = slug
WHERE document_type = 'work_order' AND slug IN ('work_order', 'completion_act', 'warranty_ticket', 'receipt');

-- Снимаем жесткое ограничение UNIQUE (tenant_id, slug), чтобы тенант мог иметь несколько версий шаблонов
ALTER TABLE print_templates DROP CONSTRAINT IF EXISTS uq_print_templates_tenant_slug;

-- Уникальный частичный индекс: только один дефолтный шаблон на тип документа для каждого тенанта
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_templates_tenant_doctype_default
  ON print_templates(tenant_id, document_type)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_doctype
  ON print_templates(tenant_id, document_type);
