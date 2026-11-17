-- =============================================================================
-- Migration 0108: Partner Multilevel Hierarchy & Tenant Separation
-- 1. Расширение check-констрейнта tenant_type (partner, client, superadmin, subpartner)
-- 2. Рекурсивная функция проверки иерархии is_tenant_descendant(ancestor_id, target_id)
-- 3. Выделение velengurin88@yandex.ru (Банкротство) в полноценного партнера
-- 4. Привязка bankir-direct@yandex.ru (Яндекс Еда) напрямую к velengurin88@yandex.ru
-- =============================================================================

-- 1. Расширяем допустимые типы тенантов в check constraint
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_tenant_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_tenant_type_check 
  CHECK (tenant_type::text = ANY (ARRAY['partner'::character varying, 'client'::character varying, 'superadmin'::character varying, 'subpartner'::character varying]::text[]));

-- 2. Рекурсивная функция проверки вхождения тенанта в иерархию партнера с защитой от циклов
CREATE OR REPLACE FUNCTION is_tenant_descendant(ancestor_id UUID, target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  found_descendant BOOLEAN := false;
BEGIN
  IF ancestor_id IS NULL OR target_id IS NULL THEN
    RETURN false;
  END IF;

  IF ancestor_id = target_id THEN
    RETURN true;
  END IF;

  WITH RECURSIVE hierarchy AS (
    -- Прямые потомки исходного тенанта
    SELECT id, parent_tenant_id, owner_partner_id, 1 AS depth
    FROM tenants
    WHERE (parent_tenant_id = ancestor_id OR owner_partner_id = ancestor_id)
      AND id <> ancestor_id

    UNION ALL

    -- Рекурсивный обход последующих уровней иерархии (до 20 уровней вложенности)
    SELECT t.id, t.parent_tenant_id, t.owner_partner_id, h.depth + 1
    FROM tenants t
    INNER JOIN hierarchy h ON (t.parent_tenant_id = h.id OR t.owner_partner_id = h.id)
    WHERE h.depth < 20 AND t.id <> h.id
  )
  SELECT EXISTS (
    SELECT 1 FROM hierarchy WHERE id = target_id
  ) INTO found_descendant;

  RETURN found_descendant;
END;
$$;

-- 3. Выделение тенанта velengurin88@yandex.ru (Банкротство) из-под Валеры (ЭЛЕРОН) в полноценного партнера
UPDATE tenants
SET parent_tenant_id = NULL,
    owner_partner_id = NULL,
    is_partner = true,
    tenant_type = 'partner',
    updated_at = now()
WHERE id = '0d288b40-422e-4b7b-a907-ebc23895d167';

UPDATE users
SET is_partner = true,
    updated_at = now()
WHERE email = 'velengurin88@yandex.ru' 
   OR (tenant_id = '0d288b40-422e-4b7b-a907-ebc23895d167' AND role = 'owner');

-- 4. Привязка тенанта bankir-direct@yandex.ru (Яндекс Еда) как прямого клиента velengurin88@yandex.ru
UPDATE tenants
SET parent_tenant_id = '0d288b40-422e-4b7b-a907-ebc23895d167',
    owner_partner_id = '0d288b40-422e-4b7b-a907-ebc23895d167',
    tenant_type = 'client',
    is_partner = false,
    updated_at = now()
WHERE id = '5fc8f6b5-3068-4421-bdbd-c76238e12fc1';
