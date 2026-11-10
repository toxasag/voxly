-- ---------------------------------------------------------------------------
-- 0090_tenant_type_and_hierarchy.sql
--
-- 1. Добавление колонки tenant_type ('partner' | 'client') в таблицу tenants
-- 2. Фиксация партнерской иерархии:
--    - Единственный партнер: valera (ЭЛЕРОН)
--    - Субклиенты партнера valera: bankrotstvo, stolichnoe-pravo
--    - Разделение тарифов: 'Партнёрский тариф' vs 'Бесплатный (Клиент)'
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_type VARCHAR(20) NOT NULL DEFAULT 'client';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_tenant_type_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_tenant_type_check CHECK (tenant_type IN ('partner', 'client'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_tenant_type ON tenants (tenant_type);

-- 1. Партнер: только valera (и корневая платформа voxly)
UPDATE tenants
SET is_partner = true,
    tenant_type = 'partner',
    parent_tenant_id = NULL,
    owner_partner_id = NULL,
    custom_plan_name = 'Партнёрский тариф'
WHERE slug = 'valera';

UPDATE tenants
SET is_partner = true,
    tenant_type = 'partner',
    parent_tenant_id = NULL,
    owner_partner_id = NULL,
    custom_plan_name = 'Платформа (0 ₽)'
WHERE slug = 'voxly' OR id = 'c0000000-0000-0000-0000-000000000001';

-- 2. Клиенты партнера valera: bankrotstvo и stolichnoe-pravo
UPDATE tenants
SET is_partner = false,
    tenant_type = 'client',
    parent_tenant_id = (SELECT id FROM tenants WHERE slug = 'valera' LIMIT 1),
    owner_partner_id = (SELECT id FROM tenants WHERE slug = 'valera' LIMIT 1),
    custom_price_rubles = 0,
    custom_plan_name = 'Бесплатный (Клиент)'
WHERE slug IN ('bankrotstvo', 'stolichnoe-pravo');

-- 3. Прямые клиенты платформы (mpro, remtoua)
UPDATE tenants
SET is_partner = false,
    tenant_type = 'client',
    custom_plan_name = CASE WHEN custom_price_rubles = 0 THEN 'Бесплатный (Клиент)' ELSE custom_plan_name END
WHERE slug IN ('mpro', 'remtoua');

-- 4. Все остальные тенанты кроме valera и voxly строго являются клиентами
UPDATE tenants
SET is_partner = false,
    tenant_type = 'client'
WHERE slug NOT IN ('valera', 'voxly');

-- Синхронизируем пользователей
UPDATE users
SET is_partner = false
WHERE tenant_id NOT IN (
  SELECT id FROM tenants WHERE is_partner = true
) AND platform_role IS DISTINCT FROM 'platform_owner';

UPDATE users
SET is_partner = true
WHERE tenant_id IN (
  SELECT id FROM tenants WHERE slug = 'valera'
);
