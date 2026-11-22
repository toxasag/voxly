-- 0122_deal_items_fifo_and_purchases.sql
-- Партионная себестоимость (FIFO), аллокации партий и заявки на закупку для прямых продаж через сделки CRM (deal_items)

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS cost_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ NULL;

-- Связь движений склада со сделками и их позициями
ALTER TABLE warehouse_movements
  ADD COLUMN IF NOT EXISTS deal_id UUID NULL REFERENCES deals(id) ON DELETE SET NULL;

ALTER TABLE warehouse_movements
  ADD COLUMN IF NOT EXISTS deal_item_id UUID NULL REFERENCES deal_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_deal
  ON warehouse_movements (tenant_id, deal_id)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_deal_item
  ON warehouse_movements (tenant_id, deal_item_id)
  WHERE deal_item_id IS NOT NULL;

-- Связь заявок на закупку со сделками CRM
ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS deal_id UUID NULL REFERENCES deals(id) ON DELETE SET NULL;

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS deal_item_id UUID NULL REFERENCES deal_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_deal
  ON purchase_requests (tenant_id, deal_id)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_deal_item
  ON purchase_requests (tenant_id, deal_item_id)
  WHERE deal_item_id IS NOT NULL;

-- Привязка списания товаров сделки к конкретным складским партиям (FIFO)
CREATE TABLE IF NOT EXISTS deal_item_batch_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deal_item_id UUID NOT NULL REFERENCES deal_items(id) ON DELETE CASCADE,
  warehouse_item_id UUID NULL REFERENCES warehouse_items(id) ON DELETE SET NULL,
  batch_id UUID NULL REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  quantity NUMERIC(10, 2) NOT NULL,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diba_tenant_item
  ON deal_item_batch_allocations (tenant_id, deal_item_id);

CREATE INDEX IF NOT EXISTS idx_diba_tenant_deal
  ON deal_item_batch_allocations (tenant_id, deal_id);

CREATE INDEX IF NOT EXISTS idx_diba_tenant_batch
  ON deal_item_batch_allocations (tenant_id, batch_id)
  WHERE batch_id IS NOT NULL;

ALTER TABLE deal_item_batch_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_item_batch_allocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON deal_item_batch_allocations;
CREATE POLICY tenant_isolation ON deal_item_batch_allocations
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
