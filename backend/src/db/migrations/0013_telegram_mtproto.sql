-- =============================================================================
-- 0013: Временные сессии подключения аккаунта Telegram (MTProto) + шифрование
--
-- Подключение пользовательского аккаунта через MTProto — двухшаговый процесс:
-- сначала `auth.sendCode`, затем `auth.signIn` с кодом из приложения Telegram.
-- Между шагами обязательно сохранить состояние клиента GramJS: MTProto привязан
-- к auth_key конкретного соединения, и новый клиент с пустой сессией получил бы
-- `PHONE_CODE_INVALID` на верный код, потому что `phone_code_hash` выдан другому
-- ключу.
--
-- Состояние хранится в БД, а не в памяти процесса: контейнер перезапускается и
-- масштабируется, а незавершённая авторизация не должна ломаться при рестарте.
-- Redis в проекте нет (M6.2.x), поэтому используется тот же подход, что у
-- `auth_sessions` — таблица с `expires_at` и чисткой по TTL.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

CREATE TABLE IF NOT EXISTS telegram_auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Кто начал подключение: аккаунт привязывается к арендатору, но знать
  -- инициатора нужно для разбора «кто подключил чужой номер».
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  phone TEXT NOT NULL,
  -- Название, введённое на первом шаге мастера. Хранится здесь, чтобы второй
  -- запрос не принимал его повторно от клиента: иначе подменой значения можно
  -- было бы записать аккаунт под чужим названием.
  label TEXT NOT NULL,

  -- Выдаётся Telegram в ответ на sendCode и предъявляется при signIn.
  phone_code_hash TEXT NOT NULL,

  -- Сериализованное состояние клиента GramJS (StringSession) между шагами.
  -- ЗАШИФРОВАНО (AES-256-GCM, services/credentials-cipher.ts): даже
  -- незавершённая сессия содержит auth_key соединения с Telegram.
  session_state TEXT NOT NULL,

  -- Требуется ли облачный пароль. Выставляется, когда Telegram отвечает
  -- SESSION_PASSWORD_NEEDED: код уже принят, остался второй фактор.
  requires_2fa BOOLEAN NOT NULL DEFAULT false,
  -- Подсказка к паролю от Telegram — показывается пользователю на шаге 2FA.
  password_hint TEXT,

  -- Ограничение попыток ввода кода: без него эндпоинт превращается в
  -- перебор 5-значного кода.
  attempts INT NOT NULL DEFAULT 0,

  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_auth_sessions_tenant
  ON telegram_auth_sessions (tenant_id)
  WHERE consumed_at IS NULL;

-- Чистка просроченных: индекс по времени, чтобы удаление не сканировало таблицу.
CREATE INDEX IF NOT EXISTS idx_telegram_auth_sessions_expires
  ON telegram_auth_sessions (expires_at);

DROP TRIGGER IF EXISTS trg_telegram_auth_sessions_updated_at ON telegram_auth_sessions;
CREATE TRIGGER trg_telegram_auth_sessions_updated_at
  BEFORE UPDATE ON telegram_auth_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- В отличие от `auth_sessions`, эта таблица под политикой: она читается уже
-- аутентифицированным пользователем внутри арендатора, поэтому tenant-контекст
-- на момент запроса всегда установлен.
ALTER TABLE telegram_auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_auth_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON telegram_auth_sessions;
CREATE POLICY tenant_isolation ON telegram_auth_sessions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- -----------------------------------------------------------------------------
-- Учёт аккаунта Telegram в channel_accounts
-- -----------------------------------------------------------------------------
-- Реальный аккаунт приносит данные, которых не было у ботов: числовой id
-- пользователя Telegram. Он нужен, чтобы отличить переподключение того же
-- аккаунта после смены username от привязки нового.
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS remote_user_id TEXT;

-- Признак того, что `credentials` зашифрованы. Нужен на время сосуществования
-- форматов: строки, созданные до этой миграции (боты, без секретов), остаются
-- читаемыми, а новые всегда шифруются.
ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS credentials_encrypted BOOLEAN NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- Права app_user
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_auth_sessions TO app_user';
  END IF;
END;
$$;
