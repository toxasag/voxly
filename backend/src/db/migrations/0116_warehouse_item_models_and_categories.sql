-- Migration 0116: Warehouse item models (M:N) and category sync

-- 1. Sync all existing distinct categories from warehouse_items into warehouse_categories
INSERT INTO warehouse_categories (tenant_id, name)
SELECT DISTINCT tenant_id, btrim(category)
FROM warehouse_items
WHERE category IS NOT NULL AND btrim(category) <> '' AND deleted_at IS NULL
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2. Seed default categories if none exist for a tenant
INSERT INTO warehouse_categories (tenant_id, name)
SELECT t.id, c.name
FROM tenants t
CROSS JOIN (
  VALUES
    ('Запчасти'),
    ('Расходники'),
    ('Дисплеи'),
    ('Аккумуляторы'),
    ('Корпуса'),
    ('Шлейфы'),
    ('Инструменты'),
    ('Оборудование'),
    ('Аксессуары'),
    ('Химия и пайка')
) AS c(name)
WHERE NOT EXISTS (
  SELECT 1 FROM warehouse_categories wc WHERE wc.tenant_id = t.id
)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3. M:N table warehouse_item_models
CREATE TABLE IF NOT EXISTS warehouse_item_models (
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, model_id)
);

ALTER TABLE warehouse_item_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_item_models FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_item_models' AND policyname = 'warehouse_item_models_isolation'
  ) THEN
    CREATE POLICY warehouse_item_models_isolation ON warehouse_item_models
      USING (((tenant_id = current_tenant_id()) OR platform_scope()))
      WITH CHECK ((tenant_id = current_tenant_id()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouse_item_models_item ON warehouse_item_models (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_item_models_model ON warehouse_item_models (tenant_id, model_id);
