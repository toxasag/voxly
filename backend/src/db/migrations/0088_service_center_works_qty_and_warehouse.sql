-- ---------------------------------------------------------------------------
-- 0088_service_center_works_qty_and_warehouse.sql
--
-- 1. Выполненные работы: добавление количества (quantity NUMERIC(10,2)) и цены за ед. (unit_price)
-- 2. Складской учет: номенклатура, партии (FIFO), резервирование и заявки на закупку
-- 3. Финансы ДДС: привязка транзакций к нарядам
-- 4. Конструктор печатных форм: шаблоны документов (Заказ-наряд, Акт, Чек)
-- ---------------------------------------------------------------------------

-- 1. РАСШИРЕНИЕ REPAIR_WORKS (Количество и цена за единицу)
ALTER TABLE repair_works
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

UPDATE repair_works
  SET unit_price = cost, quantity = 1
  WHERE (unit_price = 0 OR unit_price IS NULL) AND cost > 0;

-- 2. РАСШИРЕНИЕ REPAIR_PARTS
ALTER TABLE repair_parts
  ADD COLUMN IF NOT EXISTS warehouse_item_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'used';

-- 3. ПРИВЯЗКА ТРАНЗАКЦИЙ К НАРАД-ЗАКАЗАМ ДДС
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS repair_order_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_repair_order_id
  ON transactions (tenant_id, repair_order_id)
  WHERE repair_order_id IS NOT NULL;

-- 4. СКЛАДСКОЙ УЧЕТ: НОМЕНКЛАТУРА ТОВАРОВ И ЗАПЧАСТЕЙ
CREATE TABLE IF NOT EXISTS warehouse_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'шт',
  min_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_id ON warehouse_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_sku ON warehouse_items(tenant_id, lower(sku)) WHERE sku <> '';

ALTER TABLE warehouse_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_items_isolation ON warehouse_items;
CREATE POLICY warehouse_items_isolation ON warehouse_items
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 5. СКЛАДСКОЙ УЧЕТ: ПАРТИИ ПОСТУПЛЕНИЯ (FIFO)
CREATE TABLE IF NOT EXISTS warehouse_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  purchase_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  initial_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  remaining_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_batches_tenant_item ON warehouse_batches(tenant_id, item_id, received_at);

ALTER TABLE warehouse_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_batches_isolation ON warehouse_batches;
CREATE POLICY warehouse_batches_isolation ON warehouse_batches
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 6. СКЛАДСКОЙ УЧЕТ: РЕЗЕРВЫ ПОД НАРЯДЫ
CREATE TABLE IF NOT EXISTS warehouse_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved', -- 'reserved', 'consumed', 'released'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_reservations_order ON warehouse_reservations(tenant_id, repair_order_id);

ALTER TABLE warehouse_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_reservations_isolation ON warehouse_reservations;
CREATE POLICY warehouse_reservations_isolation ON warehouse_reservations
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 7. СКЛАДСКОЙ УЧЕТ: ЖУРНАЛ ДВИЖЕНИЙ
CREATE TABLE IF NOT EXISTS warehouse_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  repair_order_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL, -- 'intake', 'reserve', 'write_off', 'release', 'adjustment'
  quantity NUMERIC(10, 2) NOT NULL,
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_tenant ON warehouse_movements(tenant_id, created_at DESC);

ALTER TABLE warehouse_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_movements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_movements_isolation ON warehouse_movements;
CREATE POLICY warehouse_movements_isolation ON warehouse_movements
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 8. СКЛАДСКОЙ УЧЕТ: ЗАЯВКИ НА ЗАКУПКУ
CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL,
  item_id UUID REFERENCES warehouse_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'шт',
  estimated_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'ordered', 'received', 'cancelled'
  comment TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_tenant ON purchase_requests(tenant_id, status);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_requests_isolation ON purchase_requests;
CREATE POLICY purchase_requests_isolation ON purchase_requests
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 9. КОНСТРУКТОР ПЕЧАТНЫХ ДОКУМЕНТОВ
CREATE TABLE IF NOT EXISTS print_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, -- 'work_order', 'intake_act', 'completion_act', 'warranty_ticket', 'receipt'
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  page_size TEXT NOT NULL DEFAULT 'A4', -- 'A4', 'A5', 'thermal_80mm'
  orientation TEXT NOT NULL DEFAULT 'portrait', -- 'portrait', 'landscape'
  body_template TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_templates_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_print_templates_tenant ON print_templates(tenant_id);

ALTER TABLE print_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS print_templates_isolation ON print_templates;
CREATE POLICY print_templates_isolation ON print_templates
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
