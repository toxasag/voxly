-- 0133_transactions_supplier_order_id.sql
-- Add supplier_order_id to transactions to link financial expense records to supplier orders

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS supplier_order_id UUID NULL REFERENCES supplier_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_supplier_order_id
  ON transactions (tenant_id, supplier_order_id)
  WHERE supplier_order_id IS NOT NULL;
