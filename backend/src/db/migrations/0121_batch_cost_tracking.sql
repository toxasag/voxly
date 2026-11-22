-- 0121_batch_cost_tracking.sql
-- Партионная себестоимость списания (FIFO): привязка запчастей наряда к партиям,
-- идемпотентность списания (consumed_at) и сквозная трассировка для финансов (COGS).

ALTER TABLE repair_parts
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cost_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE warehouse_movements
  ADD COLUMN IF NOT EXISTS repair_part_id UUID NULL REFERENCES repair_parts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_type_created
  ON warehouse_movements (tenant_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_repair_part
  ON warehouse_movements (tenant_id, repair_part_id)
  WHERE repair_part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS repair_part_batch_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  repair_part_id UUID NOT NULL REFERENCES repair_parts(id) ON DELETE CASCADE,
  warehouse_item_id UUID NULL REFERENCES warehouse_items(id) ON DELETE SET NULL,
  batch_id UUID NULL REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  quantity NUMERIC(10, 2) NOT NULL,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rpba_tenant_part
  ON repair_part_batch_allocations (tenant_id, repair_part_id);

CREATE INDEX IF NOT EXISTS idx_rpba_tenant_order
  ON repair_part_batch_allocations (tenant_id, repair_order_id);

CREATE INDEX IF NOT EXISTS idx_rpba_tenant_created
  ON repair_part_batch_allocations (tenant_id, created_at DESC);

ALTER TABLE repair_part_batch_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_part_batch_allocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON repair_part_batch_allocations;
CREATE POLICY tenant_isolation ON repair_part_batch_allocations
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
