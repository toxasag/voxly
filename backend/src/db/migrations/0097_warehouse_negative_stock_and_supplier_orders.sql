-- 0097_warehouse_negative_stock_and_supplier_orders.sql
-- Настройки склада (продажа в минус), заказы поставщикам и связь с кассой

-- 1. Настройки склада тенанта
CREATE TABLE IF NOT EXISTS warehouse_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_warehouse_settings_tenant UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_settings_tenant ON warehouse_settings(tenant_id);

ALTER TABLE warehouse_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_settings_isolation ON warehouse_settings;
CREATE POLICY warehouse_settings_isolation ON warehouse_settings
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 2. Заказы поставщикам
CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cash_account_id UUID REFERENCES cash_accounts(id) ON DELETE SET NULL,
  finance_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_created ON supplier_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_status ON supplier_orders(tenant_id, status);

ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_orders_isolation ON supplier_orders;
CREATE POLICY supplier_orders_isolation ON supplier_orders
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 3. Позиции заказов поставщикам
CREATE TABLE IF NOT EXISTS supplier_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  purchase_request_id UUID REFERENCES purchase_requests(id) ON DELETE SET NULL,
  item_id UUID REFERENCES warehouse_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'шт',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_items_order_id ON supplier_order_items(supplier_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_order_items_tenant ON supplier_order_items(tenant_id);

ALTER TABLE supplier_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_order_items_isolation ON supplier_order_items;
CREATE POLICY supplier_order_items_isolation ON supplier_order_items
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4. Связка заявок на закупку с заказом поставщику
ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS supplier_order_id UUID REFERENCES supplier_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_supplier_order_id ON purchase_requests(supplier_order_id);

-- 5. Триггеры обновления updated_at
DROP TRIGGER IF EXISTS trg_warehouse_settings_updated_at ON warehouse_settings;
CREATE TRIGGER trg_warehouse_settings_updated_at
  BEFORE UPDATE ON warehouse_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_supplier_orders_updated_at ON supplier_orders;
CREATE TRIGGER trg_supplier_orders_updated_at
  BEFORE UPDATE ON supplier_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
