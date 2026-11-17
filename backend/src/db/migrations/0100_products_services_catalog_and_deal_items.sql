-- 0100: Products & Services catalog extension and deal items
--
-- 1. Extend repair_services_catalog with description, unit, and duration_minutes
-- 2. Create deal_items table for attaching products and services to deals
-- 3. Register 'products_services' in marketplace_modules (included in basic CRM, 0 RUB)
-- 4. Install 'products_services' for all existing tenants
-- 5. Seed 'products_services' tab in page_layout_tabs for deals

-- 1. Services Catalog extension
ALTER TABLE repair_services_catalog
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'усл',
  ADD COLUMN IF NOT EXISTS duration_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Deal Items table
CREATE TABLE IF NOT EXISTS deal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'service')),
  item_id UUID NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'шт',
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON deal_items;
CREATE POLICY tenant_isolation ON deal_items
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_deal_items_tenant_deal
  ON deal_items (tenant_id, deal_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_deal_items_item_id
  ON deal_items (tenant_id, item_id)
  WHERE item_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_items TO app_user;

-- 3. Register 'products_services' in marketplace_modules
INSERT INTO marketplace_modules
  (slug, name, description, price_monthly, billing_kind, base_price, unit_price,
   included_units, unit_label, is_multi, category, icon, trial_days, features, sort_order, is_available)
VALUES
  ('products_services', 'Услуги/Товары',
   'Единый каталог товаров и справочник услуг, остатки и номенклатура, прикрепление позиций к сделкам с авторасчётом бюджета.',
   0, 'flat', 0, 0, 0, '', false, 'crm', 'PackagePlus', 0,
   ARRAY['Справочник услуг с описанием', 'Складской учёт товаров', 'Позиции в сделках', 'Авторасчёт бюджета сделки'], 15, true)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = 0,
    base_price = 0,
    unit_price = 0,
    features = EXCLUDED.features,
    icon = 'PackagePlus',
    category = 'crm',
    is_available = true;

-- 4. Install 'products_services' for all existing tenants (included in basic plan)
INSERT INTO installed_modules (tenant_id, slug, name, quantity)
SELECT t.id, 'products_services', 'Услуги/Товары', 1
FROM tenants t
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 5. Seed 'products_services' tab in page_layout_tabs for deals
INSERT INTO page_layout_tabs
  (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
SELECT
  t.id,
  'deal',
  'products_services',
  'Услуги/Товары',
  'PackagePlus',
  19,
  true,
  'products_services',
  'deals:read'
FROM tenants t
ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
SET title = 'Услуги/Товары',
    icon = 'PackagePlus',
    position = 19,
    is_active = true,
    module_slug = 'products_services';
