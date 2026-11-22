-- 0123_warehouse_batch_supplier_order_link.sql
-- Прямая привязка партий к заказам поставщикам для гарантированной транзакционной очистки при удалении заказа

ALTER TABLE warehouse_batches
  ADD COLUMN IF NOT EXISTS supplier_order_id UUID NULL REFERENCES supplier_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_batches_supplier_order
  ON warehouse_batches (tenant_id, supplier_order_id)
  WHERE supplier_order_id IS NOT NULL;

-- Бэкфилл существующих партий, созданных из заказов поставщикам по совпадению номера заказа и поставщика
UPDATE warehouse_batches b
SET supplier_order_id = o.id
FROM supplier_orders o
WHERE b.supplier_order_id IS NULL
  AND b.tenant_id = o.tenant_id
  AND b.batch_number <> ''
  AND b.batch_number = o.order_number
  AND b.supplier_name = o.supplier_name;
