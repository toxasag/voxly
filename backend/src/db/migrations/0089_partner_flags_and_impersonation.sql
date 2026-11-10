-- ---------------------------------------------------------------------------
-- 0088_partner_flags_and_impersonation.sql
--
-- 1. Добавление флага is_partner и owner_partner_id в tenants
-- 2. Добавление флага is_partner в users
-- 3. Создание индексов для быстрой выборки партнерских и дочерних пространств
-- 4. Инициализация существующих партнерских связей
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_partner_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenants_is_partner ON tenants(is_partner);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_partner_id ON tenants(owner_partner_id);
CREATE INDEX IF NOT EXISTS idx_users_is_partner ON users(is_partner);

-- Связываем дочерние тенанты с их партнерами
UPDATE tenants
SET owner_partner_id = parent_tenant_id
WHERE parent_tenant_id IS NOT NULL AND owner_partner_id IS NULL;

-- Назначаем статус партнера для bugy2000@mail.ru и его тенанта (ЭЛЕРОН / valera)
UPDATE users
SET is_partner = true
WHERE lower(email) = 'bugy2000@mail.ru';

UPDATE tenants
SET is_partner = true
WHERE id IN (
  SELECT tenant_id FROM users WHERE lower(email) = 'bugy2000@mail.ru'
);

-- Назначаем статус партнера для платформенного владельца (anton@genadich.com / voxly)
UPDATE users
SET is_partner = true
WHERE lower(email) = 'anton@genadich.com' OR platform_role = 'platform_owner';

UPDATE tenants
SET is_partner = true
WHERE slug = 'voxly' OR id = 'c0000000-0000-0000-0000-000000000001';

-- Обновляем представление tenant_users, чтобы оно учитывало и owner_partner_id
CREATE OR REPLACE VIEW tenant_users AS
SELECT 
  u.id AS id,
  u.id AS user_id,
  u.tenant_id,
  u.role,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.deleted_at IS NULL
UNION ALL
SELECT 
  md5(parent_u.id::text || child_t.id::text)::uuid AS id,
  parent_u.id AS user_id,
  child_t.id AS tenant_id,
  'partner' AS role,
  child_t.created_at,
  child_t.updated_at
FROM tenants child_t
JOIN users parent_u ON parent_u.tenant_id = COALESCE(child_t.owner_partner_id, child_t.parent_tenant_id)
  AND (parent_u.role IN ('owner', 'admin', 'partner') OR parent_u.is_partner = true)
  AND parent_u.deleted_at IS NULL
WHERE child_t.parent_tenant_id IS NOT NULL OR child_t.owner_partner_id IS NOT NULL;
