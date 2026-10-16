-- =============================================================================
-- 0007: Восстановление пароля по ссылке из письма
--
-- Прежде сбросить пароль было нельзя: при неверном пароле пользователю оставалось
-- только обратиться к администратору. Токен сброса нельзя хранить в auth_sessions
-- — та таблица ключуется по телефону и завязана на доставку кода в бота, тогда
-- как здесь адресатом является e-mail, а допуском — одноразовая ссылка.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- Вне RLS сознательно, как otp_codes и refresh_tokens: строка читается по хешу
-- токена анонимным вызовом, до появления tenant-контекста. Политика
-- `tenant_id = current_tenant_id()` сверялась бы с NULL GUC и заблокировала бы
-- сброс пароля. Изоляция обеспечивается тем, что строка находится только по
-- хешу токена, а сам токен известен лишь получателю письма.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Владелец и его арендатор. tenant_id хранится, чтобы сброс пароля можно было
  -- увидеть в аудите арендатора, но выборка всегда идёт по token_hash.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Только SHA-256 от токена, как у refresh_tokens: дамп таблицы нельзя
  -- переиграть как переход по ссылке. argon2 здесь не нужен — токен содержит
  -- 32 случайных байта, перебор невозможен, а быстрый хеш позволяет искать
  -- строку по индексу.
  token_hash TEXT NOT NULL UNIQUE,

  -- Одноразовость: гасится в той же транзакции, в которой меняется пароль.
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  -- Диагностика попыток подбора адреса: заполняется на запрос сброса.
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

-- app_user — непривилегированная роль пула (миграция 0002), она не владелец
-- таблицы, поэтому права нужны явно.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO app_user';
  END IF;
END;
$$;
