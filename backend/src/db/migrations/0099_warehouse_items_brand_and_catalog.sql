-- 0099_warehouse_items_brand_and_catalog.sql
-- Add brand field to warehouse_items and speed up duplicate lookup by sku and name

ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_warehouse_items_name
  ON warehouse_items(tenant_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_brand
  ON warehouse_items(tenant_id, lower(brand))
  WHERE brand <> '' AND deleted_at IS NULL;
