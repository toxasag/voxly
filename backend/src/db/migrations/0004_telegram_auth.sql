-- =============================================================================
-- 0004: Авторизация через Telegram-бота и OTP до создания пользователя
--
-- Две новые потребности, которых не было в прежней схеме:
--
--   1. Привязка Telegram. Код доставляется в чат с ботом, поэтому нужен
--      users.telegram_chat_id.
--   2. OTP на этапе регистрации. Прежняя таблица otp_codes ключуется только по
--      phone и годится лишь для входа существующего пользователя. При
--      регистрации пользователя ещё нет, а подтвердить нужно связку
--      «телефон + e-mail + канал» и запомнить, куда доставлен код.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Привязка Telegram к пользователю
-- -----------------------------------------------------------------------------
-- BIGINT: идентификаторы чатов Telegram выходят за пределы INT32.
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;

-- Один Telegram-аккаунт не должен управлять несколькими учётными записями:
-- иначе владелец чата получал бы коды сразу для нескольких пользователей и было
-- бы неясно, к какому логину относится присланный код.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat_id
  ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Сессии подтверждения (OTP до создания пользователя)
-- -----------------------------------------------------------------------------
-- Отдельная таблица, а не расширение otp_codes: у otp_codes ключ — телефон
-- существующего пользователя, здесь же строка живёт до появления пользователя и
-- дополнительно хранит канал доставки, целевой e-mail и признак доставки.
--
-- Вне RLS сознательно: читается анонимным вызовом до появления tenant-контекста,
-- политика `tenant_id = current_tenant_id()` сверялась бы с NULL GUC и
-- заблокировала бы регистрацию.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Назначение сессии: регистрация нового арендатора или второй фактор входа.
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),

  -- Канал доставки кода. `max` (RuMAX) заявлен в UI, но транспорт ещё не
  -- подключён, поэтому значение допускается, а отправка возвращает ошибку.
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),

  -- Нормализованный телефон (только цифры) и e-mail, к которым привязан код.
  phone TEXT NOT NULL,
  email TEXT,

  -- Код хранится только как argon2-хеш, как и в otp_codes.
  code_hash TEXT,
  attempts INT NOT NULL DEFAULT 0,

  -- Telegram: chat_id, если он уже известен; иначе заполняется хуком /start.
  telegram_chat_id BIGINT,

  -- Токен для deep-link `?start=auth_<token>`. Отдельный от id, чтобы
  -- внутренний идентификатор строки не попадал в публичную ссылку.
  deep_link_token TEXT,

  -- Код сгенерирован и отправлен: до привязки chat_id отправлять некуда.
  delivered_at TIMESTAMPTZ,
  -- Код успешно проверен; используется register/login как допуск.
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,

  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_deep_link
  ON auth_sessions (deep_link_token)
  WHERE deep_link_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_phone
  ON auth_sessions (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);

-- app_user — непривилегированная роль пула (миграция 0002), она не владелец
-- таблицы, поэтому права нужны явно.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO app_user';
  END IF;
END;
$$;

-- Триггер updated_at — функция set_updated_at() определена в schema.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_auth_sessions_updated_at ON auth_sessions;
    CREATE TRIGGER trg_auth_sessions_updated_at
      BEFORE UPDATE ON auth_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
