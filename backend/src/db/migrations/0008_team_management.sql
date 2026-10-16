-- =============================================================================
-- 0008: Управление сотрудниками и триал на уровне аккаунта
--
-- Закрывает три пробела, без которых экраны /settings/team и /settings/billing
-- были бы декорацией:
--
--   1. Приглашённый сотрудник. `users.password_hash` объявлен NOT NULL, поэтому
--      строку нельзя было создать до того, как человек задал пароль, — статус
--      «Приглашён» негде было хранить. Колонка делается nullable, а состояние
--      выводится из `invited_at`/`activated_at`, а не хранится отдельным
--      полем: два источника истины разошлись бы при первом же входе.
--
--   2. Удаление сотрудника. Хард-делит невозможен: `deals.created_by`,
--      `crm_tasks.assignee_id`, `invoices.created_by`, `repair_notes.author_id`,
--      `repair_photos.uploaded_by` и `deal_stage_history.changed_by` ссылаются
--      на users(id) без ON DELETE, поэтому Postgres отклонил бы удаление
--      сотрудника, успевшего создать хоть одну запись. Вводится `deleted_at`.
--
--   3. Пробный период аккаунта. `trial_ends_at` существовал только у
--      installed_modules, то есть у каждого модуля свой. Показать «осталось X
--      дней» по всему аккаунту было нечем.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Приглашение и деактивация сотрудника
-- -----------------------------------------------------------------------------

-- Токен приглашения — только SHA-256, как у refresh_tokens и
-- password_reset_tokens: дамп таблицы нельзя переиграть как переход по ссылке.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Пароля нет, пока приглашение не принято. NOT NULL снимается только если он
-- ещё стоит: повторный запуск не должен падать.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash' AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL';
  END IF;
END;
$$;

-- Инвариант вместо честного слова приложения: активный пользователь обязан
-- иметь пароль. Без этого баг в коде мог бы оставить учётную запись, в которую
-- нельзя войти, но которая считается активной и занимает место в тарифе.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_needs_password;
ALTER TABLE users ADD CONSTRAINT users_active_needs_password
  CHECK (activated_at IS NULL OR password_hash IS NOT NULL);

-- Существующие пользователи созданы до приглашений — они активны.
UPDATE users SET activated_at = COALESCE(activated_at, created_at)
WHERE activated_at IS NULL AND password_hash IS NOT NULL;

-- Поиск по токену приглашения идёт анонимно, до появления tenant-контекста.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token
  ON users (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

-- Списки сотрудников всегда фильтруют удалённых.
CREATE INDEX IF NOT EXISTS idx_users_tenant_active
  ON users (tenant_id)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Уникальность e-mail и телефона с учётом удалённых
-- -----------------------------------------------------------------------------
-- Прежние UNIQUE (tenant_id, email) / (tenant_id, phone) охватывают и удалённые
-- строки, поэтому уволенного сотрудника нельзя было бы пригласить снова под тем
-- же адресом. Заменяем на частичные индексы по живым строкам.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email_active
  ON users (tenant_id, lower(email))
  WHERE deleted_at IS NULL;

-- Телефон необязателен для приглашённого: его знает только сам сотрудник.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone_active
  ON users (tenant_id, phone)
  WHERE deleted_at IS NULL AND phone <> '';

-- Приглашение создаётся без телефона, поэтому NOT NULL снимается, а пустая
-- строка исключается из индекса выше.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone' AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE users ALTER COLUMN phone DROP NOT NULL';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Индексы под неаутентифицированные выборки (findings M0.12.12)
-- -----------------------------------------------------------------------------
-- `regexp_replace(phone, …)` и `lower(email)` не покрывались индексами, из-за
-- чего /auth/code/request и /auth/forgot-password сканировали users целиком.
-- Выражения должны совпадать с запросами байт в байт, иначе планировщик индекс
-- не выберет.

CREATE INDEX IF NOT EXISTS idx_users_phone_digits
  ON users ((regexp_replace(phone, '\D', '', 'g')));

CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

-- -----------------------------------------------------------------------------
-- 4. Пробный период аккаунта
-- -----------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Действующим арендаторам на плане trial — 14 дней от даты регистрации, чтобы
-- страница биллинга не показывала «осталось 0 дней» уже существующим компаниям.
UPDATE tenants
SET trial_ends_at = created_at + INTERVAL '14 days'
WHERE trial_ends_at IS NULL AND plan = 'trial';

-- -----------------------------------------------------------------------------
-- 5. Права app_user
-- -----------------------------------------------------------------------------
-- app_user — непривилегированная роль пула (миграция 0002), не владелец таблиц,
-- поэтому права на новые колонки выдаются явно.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user';
    EXECUTE 'GRANT SELECT, UPDATE ON tenants TO app_user';
  END IF;
END;
$$;
