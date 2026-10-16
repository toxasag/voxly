-- =============================================================================
-- 0009: Личный профиль пользователя
--
-- Закрывает три пробела, без которых страница /settings/profile была бы
-- декорацией:
--
--   1. Аватар. Колонки не существовало вовсе — `tenant.service.ts` отдавал
--      `avatarUrl: null` захардкоженным значением и выводил инициалы. Выбран
--      Base64 data-URI в TEXT: загрузки файлов в проекте нет ни в каком виде
--      (ни multipart-плагина, ни S3/MinIO, ни тома для медиа, ни раздачи
--      статики), а клиентское сжатие в canvas до 256×256 даёт ~15–25 КБ.
--
--   2. Привязка канала уже вошедшим пользователем. `auth_sessions` знала только
--      телефон и e-mail, но не пользователя: оба значения задаёт вызывающий
--      публичного `/auth/code/request`, поэтому связать сессию с конкретной
--      учётной записью было нечем. Добавляется `user_id` — он заполняется
--      только для аутентифицированного сценария `link`.
--
--   3. Назначение `link`. CHECK допускал лишь `register` и `login`, поэтому
--      сессию привязки нельзя было создать даже при наличии user_id.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Аватар
-- -----------------------------------------------------------------------------
-- TEXT, а не BYTEA: значение отдаётся клиенту внутри JSON и подставляется в
-- `<img src>` как есть, поэтому хранить его строкой дешевле, чем кодировать при
-- каждом чтении. Ограничение длины — в Zod-схеме, а не в типе: менять CHECK на
-- живой таблице дороже, чем правило валидации.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- -----------------------------------------------------------------------------
-- 2. Сессия привязки канала
-- -----------------------------------------------------------------------------
-- ON DELETE CASCADE: сессии удалённого пользователя не нужны, а висящая ссылка
-- заблокировала бы удаление учётной записи.
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
  ON auth_sessions (user_id)
  WHERE user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Назначение `link`
-- -----------------------------------------------------------------------------
-- Имя ограничения берётся из pg_constraint, а не угадывается: в schema.sql оно
-- объявлено инлайн, поэтому Postgres присвоил автоимя, которое может отличаться
-- между инсталляциями.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'auth_sessions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%purpose%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE auth_sessions DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_purpose_check
    CHECK (purpose IN ('register', 'login', 'link'));
END;
$$;

-- Инвариант вместо честного слова приложения: сессия привязки обязана знать,
-- кому привязывать. Без этого баг в коде создал бы `link`-сессию без владельца,
-- и webhook привязал бы канал в никуда.
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_link_needs_user;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_link_needs_user
  CHECK (purpose <> 'link' OR user_id IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 4. Права app_user
-- -----------------------------------------------------------------------------
-- Миграция 0008 выдала табличный GRANT на users, поэтому новая колонка правами
-- уже покрыта. auth_sessions подтверждается явно — там 0006 выдавал табличный
-- грант, но повторение идемпотентно и защищает от инсталляций, где его не было.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO app_user';
  END IF;
END;
$$;
