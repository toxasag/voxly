-- ---------------------------------------------------------------------------
-- 0061_partner_tenants_and_auth_settings.sql
--
-- 1. Добавление parent_tenant_id в tenants (иерархия партнер -> дочерние тенанты)
-- 2. Добавление auth_settings JSONB в tenants (политики аутентификации: вход по паролю / Telegram 2FA)
-- 3. Добавление custom_pricing JSONB в tenants (партнерские тарифные сетки и условия)
-- 4. Создание индекса idx_tenants_parent
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auth_settings JSONB NOT NULL DEFAULT '{"require_telegram_auth": true, "allow_password_auth": true}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_pricing JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id);

-- Для существующих тенантов подтверждаем флаг require_telegram_auth = true (стандартная политика платформы)
UPDATE tenants
SET auth_settings = '{"require_telegram_auth": true, "allow_password_auth": true}'::jsonb
WHERE auth_settings IS NULL;
