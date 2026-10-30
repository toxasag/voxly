-- ---------------------------------------------------------------------------
-- 0051_refresh_tokens_metadata.sql
--
-- Добавление полей user_agent и ip в refresh_tokens для сессионного трекинга
-- и долгоживущих защищенных сессий (Remember Me).
-- ---------------------------------------------------------------------------

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip TEXT;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id_active
  ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL;
