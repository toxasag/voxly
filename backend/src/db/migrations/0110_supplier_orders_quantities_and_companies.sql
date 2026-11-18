-- 0110_supplier_orders_quantities_and_companies.sql
-- Расширение функционала заказов поставщикам: привязка компании-поставщика, разделение количества (в наряд / на склад)

-- 1. Привязка компании-контрагента к заказу поставщику
ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS supplier_company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_orders_company_id ON supplier_orders(supplier_company_id);

-- 2. Разделение количества в позициях заказа: базовое под наряд и дополнительное на склад
ALTER TABLE supplier_order_items
  ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repair_order_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_request_ids UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_supplier_order_items_repair_order ON supplier_order_items(repair_order_id);
