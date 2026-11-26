-- 0139_warehouse_search_trgm_indexes.sql
-- Ускорение многословного подстрочного поиска (`ILIKE '%token%'`) по складу и моделям СЦ.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_trgm extension requires superuser, skipping CREATE EXTENSION';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_warehouse_items_name_trgm
      ON warehouse_items USING gin (name gin_trgm_ops)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_warehouse_items_sku_trgm
      ON warehouse_items USING gin (sku gin_trgm_ops)
      WHERE deleted_at IS NULL AND sku <> '';

    CREATE INDEX IF NOT EXISTS idx_warehouse_items_brand_trgm
      ON warehouse_items USING gin (brand gin_trgm_ops)
      WHERE deleted_at IS NULL AND brand <> '';

    CREATE INDEX IF NOT EXISTS idx_equipment_models_name_trgm
      ON equipment_models USING gin (name gin_trgm_ops);
  END IF;
END $$;
