-- 0136_supplier_order_partial_receipts_and_landed_cost.sql
-- Частичное оприходование заказов поставщикам, история приёмок и распределение доп. расходов (Landed Cost)

-- 1. Принятое количество по строкам заказа поставщику
ALTER TABLE supplier_order_items
  ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Бэкфилл для уже полностью оприходованных заказов
UPDATE supplier_order_items soi
SET received_quantity = soi.quantity
FROM supplier_orders so
WHERE so.id = soi.supplier_order_id
  AND so.tenant_id = soi.tenant_id
  AND so.status = 'received'
  AND soi.received_quantity = 0;

-- 2. История приёмок по заказам поставщикам
CREATE TABLE IF NOT EXISTS supplier_order_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  allocation_method VARCHAR(24) NOT NULL DEFAULT 'by_value',
  extra_costs_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_receipts_tenant_order
  ON supplier_order_receipts (tenant_id, supplier_order_id, created_at DESC);

ALTER TABLE supplier_order_receipts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'supplier_order_receipts' AND policyname = 'tenant_isolation_supplier_order_receipts'
  ) THEN
    CREATE POLICY tenant_isolation_supplier_order_receipts ON supplier_order_receipts
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 3. Позиции каждой приёмки с базовой ценой, долей доп. расхода и итоговой себестоимостью
CREATE TABLE IF NOT EXISTS supplier_order_receipt_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL REFERENCES supplier_order_receipts(id) ON DELETE CASCADE,
  supplier_order_item_id UUID NOT NULL REFERENCES supplier_order_items(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  item_id UUID REFERENCES warehouse_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL,
  base_unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allocated_extra_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unit_landed_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  effective_unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_receipt_items_tenant_receipt
  ON supplier_order_receipt_items (tenant_id, receipt_id);

ALTER TABLE supplier_order_receipt_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'supplier_order_receipt_items' AND policyname = 'tenant_isolation_supplier_order_receipt_items'
  ) THEN
    CREATE POLICY tenant_isolation_supplier_order_receipt_items ON supplier_order_receipt_items
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 4. Дополнительные расходы приёмки (доставка, курьер и др.), связанные с транзакциями в Финансах
CREATE TABLE IF NOT EXISTS supplier_order_receipt_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL REFERENCES supplier_order_receipts(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(12, 2) NOT NULL,
  category_id UUID REFERENCES finance_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL DEFAULT '',
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_receipt_costs_tenant_receipt
  ON supplier_order_receipt_costs (tenant_id, receipt_id);

ALTER TABLE supplier_order_receipt_costs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'supplier_order_receipt_costs' AND policyname = 'tenant_isolation_supplier_order_receipt_costs'
  ) THEN
    CREATE POLICY tenant_isolation_supplier_order_receipt_costs ON supplier_order_receipt_costs
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 5. Расширение партий warehouse_batches полями базовой цены и landed cost
ALTER TABLE warehouse_batches
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES supplier_order_receipts(id) ON DELETE SET NULL;
ALTER TABLE warehouse_batches
  ADD COLUMN IF NOT EXISTS base_purchase_price NUMERIC(12, 2);
ALTER TABLE warehouse_batches
  ADD COLUMN IF NOT EXISTS landed_cost_per_unit NUMERIC(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE warehouse_batches
  ADD COLUMN IF NOT EXISTS landed_cost_total NUMERIC(12, 2) NOT NULL DEFAULT 0;

UPDATE warehouse_batches
SET base_purchase_price = purchase_price
WHERE base_purchase_price IS NULL;

-- 6. Расширение transactions для связи с приёмкой и исключения двойного списания в P&L
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS supplier_order_receipt_id UUID REFERENCES supplier_order_receipts(id) ON DELETE SET NULL;
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_capitalized_cost BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_transactions_supplier_order_receipt_id
  ON transactions (tenant_id, supplier_order_receipt_id)
  WHERE supplier_order_receipt_id IS NOT NULL;
