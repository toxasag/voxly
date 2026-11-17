-- =============================================================================
-- 0107: Омниканальные приглашения сотрудников (Email, Телефон, Telegram, WhatsApp)
-- =============================================================================

-- 1. Добавляем поля для хранения исходного invite_token (для шаринга ссылок в мессенджеры)
-- и статуса/ошибки доставки почты
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_delivery_status TEXT DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_delivery_error TEXT;

-- 2. Делаем email nullable для приглашений по номеру телефона
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
  END IF;
END;
$$;

-- Гарантируем, что у пользователя есть либо e-mail, либо телефон
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_or_phone_check;
ALTER TABLE users ADD CONSTRAINT users_email_or_phone_check
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Уникальность активного e-mail только если e-mail задан
DROP INDEX IF EXISTS idx_users_tenant_email_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email_active
  ON users (tenant_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '';

-- 3. Представление workspace_invites для прозрачного аудита приглашений
CREATE OR REPLACE VIEW workspace_invites AS
SELECT
  id,
  tenant_id,
  tenant_id AS workspace_id,
  email,
  phone,
  name,
  role,
  invite_token AS token,
  CASE
    WHEN deleted_at IS NOT NULL THEN 'revoked'
    WHEN activated_at IS NOT NULL THEN 'accepted'
    WHEN invite_expires_at IS NOT NULL AND invite_expires_at < now() THEN 'expired'
    ELSE 'pending'
  END AS status,
  COALESCE(invite_delivery_status, 'pending') AS delivery_status,
  invite_delivery_error AS delivery_error,
  invited_at AS created_at,
  invite_expires_at AS expires_at,
  invited_by
FROM users
WHERE (invited_at IS NOT NULL OR invite_token_hash IS NOT NULL);

-- 4. Права app_user на представление
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT ON workspace_invites TO app_user';
  END IF;
END;
$$;
