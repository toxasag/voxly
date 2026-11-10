-- 0072: service center dictionaries, equipment history, and additional contacts
--
-- Dictionaries for equipment types, brands, models, accessories and malfunctions
-- with strict Row-Level Security per tenant_id. Also adds additional_contacts JSONB
-- and multi-value arrays to repair_orders with serial lookup index.

-- 1. Equipment Types
CREATE TABLE IF NOT EXISTS equipment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE equipment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_types;
CREATE POLICY tenant_isolation ON equipment_types
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 2. Equipment Brands
CREATE TABLE IF NOT EXISTS equipment_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE equipment_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_brands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_brands;
CREATE POLICY tenant_isolation ON equipment_brands
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 3. Equipment Models
CREATE TABLE IF NOT EXISTS equipment_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brand_name, name)
);

ALTER TABLE equipment_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_models FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_models;
CREATE POLICY tenant_isolation ON equipment_models
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4. Equipment Accessories (комплектация)
CREATE TABLE IF NOT EXISTS equipment_accessories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE equipment_accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_accessories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_accessories;
CREATE POLICY tenant_isolation ON equipment_accessories
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 5. Equipment Malfunctions (заявленные неисправности)
CREATE TABLE IF NOT EXISTS equipment_malfunctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE equipment_malfunctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_malfunctions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_malfunctions;
CREATE POLICY tenant_isolation ON equipment_malfunctions
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 6. Update repair_orders: additional_contacts, package_contents_items, malfunctions
ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS additional_contacts JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS package_contents_items TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS malfunctions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_repair_orders_equipment_serial
  ON repair_orders (tenant_id, lower(equipment_serial))
  WHERE equipment_serial <> '';

-- 7. Seed initial dictionary data for existing tenants
INSERT INTO equipment_types (tenant_id, name)
SELECT t.id, type_name
FROM tenants t
CROSS JOIN (
  VALUES
    ('Монтажный пистолет'),
    ('Электроинструмент'),
    ('Смартфон'),
    ('Ноутбук'),
    ('Планшет'),
    ('Компьютер (ПК)'),
    ('Принтер / МФУ'),
    ('Бытовая техника'),
    ('Другое')
) AS v(type_name)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO equipment_brands (tenant_id, name)
SELECT t.id, brand_name
FROM tenants t
CROSS JOIN (
  VALUES
    ('Toua'),
    ('Hilti'),
    ('Makita'),
    ('Bosch'),
    ('DeWalt'),
    ('Apple'),
    ('Samsung'),
    ('Xiaomi')
) AS v(brand_name)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO equipment_accessories (tenant_id, name)
SELECT t.id, acc_name
FROM tenants t
CROSS JOIN (
  VALUES
    ('Обойма'),
    ('2 АКБ'),
    ('1 АКБ'),
    ('Кейс'),
    ('Зарядное устройство'),
    ('Кабель питания'),
    ('Оригинальная упаковка'),
    ('Без комплекта')
) AS v(acc_name)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO equipment_malfunctions (tenant_id, name)
SELECT t.id, mal_name
FROM tenants t
CROSS JOIN (
  VALUES
    ('Не стреляет'),
    ('Не включается'),
    ('Заклинил механизм'),
    ('Не заряжается'),
    ('Быстро садится АКБ'),
    ('Греется / искрит'),
    ('Разбит корпус / дисплей'),
    ('Попадание влаги / грязи')
) AS v(mal_name)
ON CONFLICT (tenant_id, name) DO NOTHING;
