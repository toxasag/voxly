-- =============================================================================
-- GETVOXLY — Core Schema (PostgreSQL 16)
-- Multi-tenant, RLS-ready, JSONB for extensibility
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Векторный поиск базы знаний AI-агентов (миграция 0015). Требует образа БД с
-- pgvector: `docker/postgres-pgvector.Dockerfile` (postgres:16-alpine + pgvector
-- 0.8.0 из исходников — готового alpine-образа с расширением не существует).
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- 1. TENANT & AUTH
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  -- Персональный поддомен: {slug}.getvoxly.ru. Уникален глобально, а не в
  -- рамках арендатора, потому что адресует хост всей платформы. Формат
  -- проверяется в БД, так как значение попадает в имя хоста.
  slug TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'trial',
  -- Пробный период всего аккаунта. Отдельно от installed_modules.trial_ends_at:
  -- тот считается для каждого модуля, и «осталось X дней» по аккаунту из него не
  -- выводится.
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_format CHECK (
    slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

-- Служебные поддомены, недоступные арендаторам: `api` и `app` заняты
-- реальными хостами, остальные — типовые цели фишинга и путаницы. Список в
-- БД, а не только в коде, чтобы проверка не обходилась прямой вставкой.
CREATE TABLE IF NOT EXISTS reserved_slugs (
  slug TEXT PRIMARY KEY
);

INSERT INTO reserved_slugs (slug) VALUES
  ('api'), ('app'), ('www'), ('admin'), ('superadmin'), ('mail'), ('smtp'),
  ('ftp'), ('ns1'), ('ns2'), ('cdn'), ('static'), ('assets'), ('status'),
  ('help'), ('support'), ('docs'), ('blog'), ('billing'), ('pay'), ('login'),
  ('auth'), ('register'), ('dashboard'), ('test'), ('staging'), ('dev'),
  ('n8n'), ('baserow'), ('nocodb'), ('npm'), ('getvoxly')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- Телефон и пароль отсутствуют у приглашённого сотрудника: их задаёт он сам,
  -- принимая приглашение. Уникальность обеспечивают частичные индексы ниже.
  phone TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  -- Платформенная роль (superadmin-панель), независимая от tenant_id: тенантный
  -- `role` не может служить гейтом админки платформы, иначе владелец любого
  -- арендатора получил бы доступ ко всем данным.
  --
  -- Колонки здесь не было, хотя миграция 0001 её добавляет: `schema.sql`
  -- создаёт свежую БД через initdb, а миграции применялись только к уже
  -- работающей. Расхождение вскрылось при внедрении раннера (M6.2.7) —
  -- `authenticate.ts` выбирает `platform_role` в каждом запросе, поэтому любая
  -- чистая установка падала бы на первой же аутентификации.
  platform_role TEXT,
  password_hash TEXT,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  -- Telegram-привязка для доставки OTP. BIGINT: chat_id выходит за INT32.
  telegram_chat_id BIGINT,
  telegram_username TEXT,
  -- MAX-привязка для доставки OTP. VARCHAR, а не BIGINT: документация MAX не
  -- фиксирует разрядность user_id, строка исключает потерю точности.
  max_user_id VARCHAR(128),
  max_username TEXT,
  -- Аватар как Base64 data-URI. TEXT, а не BYTEA: значение отдаётся клиенту
  -- внутри JSON и подставляется в `<img src>` как есть. Загрузки файлов в
  -- проекте нет (ни multipart, ни S3, ни раздачи статики), поэтому клиент жмёт
  -- изображение в canvas до 256×256 — это ~15–25 КБ.
  avatar_url TEXT,
  -- Приглашение сотрудника. Токен — только SHA-256, как у refresh_tokens.
  -- Статус («Активен» / «Приглашён») выводится из invited_at/activated_at, а не
  -- хранится отдельной колонкой: два источника истины разошлись бы при входе.
  invite_token_hash TEXT,
  invited_at TIMESTAMPTZ,
  invite_expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Мягкое удаление: хард-делит невозможен, на users(id) ссылаются deals,
  -- crm_tasks, invoices, repair_notes и repair_photos без ON DELETE.
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Активная учётная запись обязана иметь пароль: инвариант в схеме, а не
  -- обещание приложения, иначе баг оставил бы аккаунт, в который нельзя войти,
  -- но который занимает место в тарифе.
  CONSTRAINT users_active_needs_password
    CHECK (activated_at IS NULL OR password_hash IS NOT NULL)
);

-- Уникальность только среди живых строк: иначе уволенного сотрудника нельзя
-- было бы пригласить снова под тем же адресом.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email_active
  ON users (tenant_id, lower(email))
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone_active
  ON users (tenant_id, phone)
  WHERE deleted_at IS NULL AND phone <> '';

-- Один Telegram-аккаунт не должен управлять несколькими учётными записями:
-- иначе в один чат приходили бы коды для разных логинов.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat_id
  ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- То же правило для MAX.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_max_user_id
  ON users (max_user_id)
  WHERE max_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token
  ON users (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant_active
  ON users (tenant_id)
  WHERE deleted_at IS NULL;

-- Выражения должны совпадать с запросами в auth-session.service.ts и
-- password-reset.service.ts байт в байт, иначе планировщик индекс не выберет и
-- неаутентифицированные эндпоинты сканируют users целиком.
CREATE INDEX IF NOT EXISTS idx_users_phone_digits
  ON users ((regexp_replace(phone, '\D', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

-- Сессии подтверждения: OTP на этапе регистрации, когда пользователя ещё нет,
-- плюс второй фактор при входе. Отличается от otp_codes тем, что ключуется не
-- по существующему пользователю и хранит канал доставки и deep-link токен.
-- Вне RLS: читается анонимно до появления tenant-контекста.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- `link` — привязка канала уже вошедшим пользователем из /settings/profile.
  -- Отличается от `login` тем, что владелец известен заранее и берётся из
  -- сессии, а не выводится из телефона или e-mail, заданных вызывающим.
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'link')),
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  phone TEXT NOT NULL,
  email TEXT,
  -- Заполняется только для `link`: остальные назначения выполняются до того,
  -- как пользователь известен (регистрация) либо доказан (вход).
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT,
  attempts INT NOT NULL DEFAULT 0,
  telegram_chat_id BIGINT,
  max_user_id VARCHAR(128),
  deep_link_token TEXT,
  delivered_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Инвариант вместо честного слова приложения: сессия привязки обязана знать,
  -- кому привязывать, иначе webhook привязал бы канал в никуда.
  CONSTRAINT auth_sessions_link_needs_user
    CHECK (purpose <> 'link' OR user_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_deep_link
  ON auth_sessions (deep_link_token) WHERE deep_link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
  ON auth_sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_phone
  ON auth_sessions (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);

-- Токены восстановления пароля. Вне RLS по той же причине, что otp_codes:
-- строка ищется по хешу токена анонимным вызовом, до появления tenant-контекста.
-- Хранится только SHA-256, поэтому дамп таблицы нельзя переиграть как переход
-- по ссылке из письма.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS installed_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Число подключённых единиц: агентов или аккаунтов канала. Для модулей с
  -- фиксированной ценой всегда 1.
  quantity INT NOT NULL DEFAULT 1,
  -- Окончание пробного периода. NULL — пробный период не применялся;
  -- активность определяется сравнением с now().
  trial_ends_at TIMESTAMPTZ,
  next_billing_date TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 month'),
  locked_unit_price NUMERIC,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CONSTRAINT installed_modules_quantity_positive CHECK (quantity >= 1)
);

-- One-time login codes.
--
-- Postgres rather than Redis: the project has no Redis dependency yet (M6.2.x),
-- and a code that survives a restart is preferable to one that silently
-- disappears. Only the argon2 hash is stored, so a database read cannot be
-- replayed as a login. Not tenant-scoped: at send time the caller is anonymous
-- and the phone number is what resolves the user.
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at ON otp_codes(expires_at);

-- Refresh tokens, stored as SHA-256 digests so a database dump cannot be
-- replayed. Rotation sets revoked_at and links the successor via replaced_by,
-- which makes token-theft reuse detectable.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_tenant_id ON refresh_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- =============================================================================
-- 2. CORE CRM
-- =============================================================================

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Обязательно только имя: у Twenty на Person нет NOT NULL ни на фамилии, ни на
  -- телефоне, ни на компании (см. person.workspace-entity.ts — все nullable).
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  -- Отчество: русская специфика, в FULL_NAME у Twenty только first/last.
  middle_name TEXT NOT NULL DEFAULT '',
  -- Основной номер = Twenty primaryPhoneNumber. Код страны (ISO-2) и код звонка
  -- хранятся отдельными колонками, как у них: один код звонка принадлежит
  -- нескольким странам (+1), и без ISO-кода не выбрать флаг в селекторе.
  phone TEXT NOT NULL DEFAULT '',
  phone_country_code TEXT NOT NULL DEFAULT '',
  phone_calling_code TEXT NOT NULL DEFAULT '',
  -- Twenty: additionalPhones (RAW_JSON) — [{number, countryCode, callingCode}].
  additional_phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  email TEXT,
  telegram_username TEXT,
  telegram_chat_id BIGINT,
  whatsapp TEXT,
  -- Мессенджеры и соцсети списком: [{kind, value}]. Колонки telegram_username и
  -- whatsapp выше сохранены — по ним ищет транспорт каналов.
  socials JSONB NOT NULL DEFAULT '[]'::jsonb,
  job_title TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  company_id UUID,
  channel TEXT NOT NULL DEFAULT 'phone',
  -- Twenty: person.linkedinLink, группа social на record page.
  linkedin_link TEXT NOT NULL DEFAULT '',
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  -- Twenty: person.createdBy (ActorMetadata), группа system. NULL = система/импорт.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Структура JSONB проверяется в БД: массивы пишет не только API, но и
  -- crm-pipeline с импортом, а битый элемент иначе всплыл бы на отрисовке.
  --
  -- Проверка через jsonb_path_exists, а не подзапросом с jsonb_array_elements:
  -- PostgreSQL отвергает подзапрос в CHECK («cannot use subquery in check
  -- constraint»). Предикат ищет хотя бы один неподходящий элемент, поэтому
  -- условие — его отсутствие.
  CONSTRAINT contacts_additional_phones_shape CHECK (
    jsonb_typeof(additional_phones) = 'array'
    AND NOT jsonb_path_exists(
      additional_phones,
      '$[*] ? (@.type() != "object" || !(exists(@.number ? (@.type() == "string"))))'
    )
  ),
  CONSTRAINT contacts_socials_shape CHECK (
    jsonb_typeof(socials) = 'array'
    AND NOT jsonb_path_exists(
      socials,
      '$[*] ? (@.type() != "object" || !(exists(@.kind ? (@.type() == "string"))) || !(exists(@.value ? (@.type() == "string"))))'
    )
  )
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  inn TEXT NOT NULL DEFAULT '',
  ogrn TEXT NOT NULL DEFAULT '',
  bik TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  legal_address TEXT NOT NULL DEFAULT '',
  manager_name TEXT NOT NULL DEFAULT '',
  manager_id UUID,
  -- Twenty: company.annualRevenue (CurrencyMetadata), группа business.
  -- NUMERIC вместо float — деньгам нужна точность, у Twenty ту же роль играет
  -- amountMicros целым числом.
  annual_revenue NUMERIC(18, 2),
  -- Twenty: company.linkedinLink и company.address (AddressMetadata), группа contact.
  -- legal_address остаётся отдельно: это юридический адрес из реквизитов.
  linkedin_link TEXT NOT NULL DEFAULT '',
  address_city TEXT NOT NULL DEFAULT '',
  address_street TEXT NOT NULL DEFAULT '',
  address_country TEXT NOT NULL DEFAULT '',
  address_postcode TEXT NOT NULL DEFAULT '',
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Twenty: company.createdBy (ActorMetadata), группа system.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_won BOOLEAN NOT NULL DEFAULT false,
  is_lost BOOLEAN NOT NULL DEFAULT false,
  -- Системный этап (миграция 0028): вход в воронку, «успех» и «провал».
  -- Их нельзя переименовать, перекрасить, передвинуть или удалить: на входе
  -- стоит попадание сделки в воронку, на терминальных — семантика закрытия.
  is_system BOOLEAN NOT NULL DEFAULT false,
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id),
  stage_id UUID NOT NULL REFERENCES stages(id),
  contact_id UUID,
  company_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  close_date DATE,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  ai_paused_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  channel_account_id UUID,
  source TEXT NOT NULL DEFAULT 'manager',
  direction TEXT NOT NULL DEFAULT 'neutral',
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'system',
  attachment TEXT,
  attachment_type TEXT,
  -- Доставка исходящего в канал. Хранится на строке сообщения, а не тостом на
  -- фронте: тост исчезает, а неотправленное сообщение осталось бы висеть в
  -- таймлайне как отправленное. `neutral` — доставлять некуда (входящие,
  -- системные), `pending` — принято сервером, `sent` — транспорт подтвердил,
  -- `failed` — отказ, причина в `delivery_error`.
  delivery_status TEXT NOT NULL DEFAULT 'neutral',
  delivery_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deal_messages_delivery_status_valid
    CHECK (delivery_status IN ('neutral', 'pending', 'sent', 'failed'))
);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID,
  company_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  due_date TIMESTAMPTZ,
  assignee_id UUID NOT NULL REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Заметки. Twenty: объект Note + junction NoteTarget, где у цели заполнен ровно
-- один FK. Полиморфизм выражен тремя nullable FK с CHECK на ровно одну цель:
-- пара (target_type, target_id) не даёт ссылочной целостности, а тут её
-- обеспечивает сама БД, и ON DELETE CASCADE убирает заметки вместе с записью.
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT notes_single_target CHECK (
    (contact_id IS NOT NULL)::int
    + (company_id IS NOT NULL)::int
    + (deal_id IS NOT NULL)::int = 1
  )
);

CREATE TABLE IF NOT EXISTS note_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('contact', 'company', 'deal')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_note_target UNIQUE (note_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS task_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES crm_tasks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('contact', 'company', 'deal')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_target UNIQUE (task_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS record_table_layouts (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,
  layout JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, table_id),
  CONSTRAINT record_table_layouts_table_id_valid CHECK (
    table_id IN ('contacts', 'companies', 'deals', 'tasks')
  ),
  CONSTRAINT record_table_layouts_layout_object CHECK (jsonb_typeof(layout) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_record_table_layouts_user
  ON record_table_layouts (tenant_id, user_id);

-- Вкладки карточек как данные (этап 6 плана мобильной вёрстки).
-- Состав/порядок/условия из БД; React-компонент остаётся в коде (фабрика по tab_key).
CREATE TABLE IF NOT EXISTS page_layout_tabs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  module_slug TEXT NULL,
  required_permission TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, object_type, tab_key),
  CONSTRAINT page_layout_tabs_object_type_valid CHECK (
    object_type IN ('contact', 'company', 'deal')
  ),
  CONSTRAINT page_layout_tabs_tab_key_valid CHECK (
    tab_key ~ '^[a-z][a-z0-9_-]*$' AND length(tab_key) BETWEEN 1 AND 64
  )
);

CREATE INDEX IF NOT EXISTS idx_page_layout_tabs_object_active
  ON page_layout_tabs (tenant_id, object_type, is_active);

-- Soft-delete columns (see .cursorrules §10: queries filter deleted_at IS NULL)
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS suppress_deal_creation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE deals      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE crm_tasks  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Companies carry free-form notes alongside their requisites
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- Связь контакта с компанией настоящим внешним ключом. Задаётся здесь, а не в
-- CREATE TABLE: contacts объявлена раньше companies. Без FK в company_id мог
-- остаться идентификатор удалённой компании, и карточка молча показывала бы
-- пустую связь.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_company_id_fkey;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- Deal stage transitions are auditable
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID,
  to_stage_id UUID NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. SERVICE CENTER
-- =============================================================================

CREATE TABLE IF NOT EXISTS repair_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_number TEXT NOT NULL,
  customer_id UUID NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  equipment_brand TEXT NOT NULL,
  equipment_model TEXT NOT NULL,
  equipment_serial TEXT NOT NULL,
  package_contents TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  defect_description TEXT NOT NULL,
  defect_photos TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'intake',
  priority TEXT NOT NULL DEFAULT 'normal',
  master_id UUID NOT NULL,
  master_name TEXT NOT NULL,
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  final_cost NUMERIC,
  notes TEXT NOT NULL DEFAULT '',
  diagnostics JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_works (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  master_id UUID NOT NULL,
  master_name TEXT NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  article TEXT NOT NULL DEFAULT '',
  quantity INT NOT NULL DEFAULT 1,
  retail_price NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing installations created these tables without tenant_id; backfill the
-- column so every service-center query can filter on it directly.
ALTER TABLE repair_works ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Technician notes and status-change log for a repair order
CREATE TABLE IF NOT EXISTS repair_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  author_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photo attachments captured at intake and during work
CREATE TABLE IF NOT EXISTS repair_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference catalogue of serviceable devices
CREATE TABLE IF NOT EXISTS device_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_type TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brand, model)
);

-- Per-tenant document number counters.
--
-- Keyed by (tenant_id, counter_type, year) so each document series advances
-- independently: `repair` builds ЗН-YYYY-NNNN, `invoice` builds СЧ-YYYY-NNNN.
-- Before counter_type existed both series shared one row, which interleaved
-- repair and invoice numbering.
--
-- The table keeps its historical name to avoid a rename migration; it is not
-- repair-specific any more.
CREATE TABLE IF NOT EXISTS repair_counters (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  counter_type TEXT NOT NULL DEFAULT 'repair',
  year INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, counter_type, year)
);

ALTER TABLE repair_counters
  ADD COLUMN IF NOT EXISTS counter_type TEXT NOT NULL DEFAULT 'repair';

-- Widen the primary key on installations created before counter_type existed.
-- Legacy rows are treated as the `repair` series (the column default), and the
-- invoice series is seeded from the same high-water mark so a freshly split
-- counter can never re-issue an invoice number that was already handed out.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'repair_counters_pkey'
      AND conrelid = 'repair_counters'::regclass
      AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE repair_counters DROP CONSTRAINT repair_counters_pkey;
    ALTER TABLE repair_counters
      ADD CONSTRAINT repair_counters_pkey PRIMARY KEY (tenant_id, counter_type, year);

    INSERT INTO repair_counters (tenant_id, counter_type, year, last_number)
    SELECT tenant_id, 'invoice', year, last_number
    FROM repair_counters
    WHERE counter_type = 'repair'
    ON CONFLICT (tenant_id, counter_type, year) DO NOTHING;
  END IF;
END
$$;

-- =============================================================================
-- 4. FINANCE
-- =============================================================================

CREATE TABLE IF NOT EXISTS cash_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  balance NUMERIC NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id UUID REFERENCES finance_categories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- category_id is nullable on purpose: system-generated movements (internal
-- transfers, invoice payments) are not booked against a tenant category. The
-- human-readable category_name below is always populated.
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_account_id UUID NOT NULL REFERENCES cash_accounts(id),
  category_id UUID REFERENCES finance_categories(id),
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  direction TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  counterparty_name TEXT NOT NULL DEFAULT '',
  counterparty_inn TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_name TEXT NOT NULL,
  company_inn TEXT NOT NULL DEFAULT '',
  company_address TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  vat_rate NUMERIC NOT NULL DEFAULT 20,
  vat_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  source_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- УСТАРЕЛО (0014): остаток в штуках токенов. Цена 1k токенов различается между
-- моделями в десятки раз, поэтому «остаток токенов» не отвечает на вопрос, на
-- сколько их хватит. Актуален ai_balance_kopecks ниже. Колонка оставлена:
-- на неё ссылаются платформенные экраны и контракт 03_04.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_tokens_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- Баланс ИИ в КОПЕЙКАХ (см. миграцию 0014). Целое, а не NUMERIC с плавающей
-- точкой: 0.1 + 0.2 ≠ 0.3, и остаток со временем расходился бы с суммой операций.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_balance_kopecks BIGINT NOT NULL DEFAULT 0;

-- Наценка платформы на стоимость токенов, % от цены провайдера. На арендаторе, а
-- не в конфиге: разным клиентам можно дать разные условия. Отрицательная
-- (скидка) допустима, но не ниже -100% — иначе расход пополнял бы баланс.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_markup_percent NUMERIC(6, 2) NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ai_markup_range'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_ai_markup_range
      CHECK (ai_markup_percent >= -100 AND ai_markup_percent <= 1000);
  END IF;
END;
$$;

-- Журнал пополнений баланса ИИ: без него нельзя объяснить, откуда сумма на
-- балансе, и невозможно свести расчёты с клиентом.
CREATE TABLE IF NOT EXISTS ai_balance_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'payment', 'bonus')),
  external_payment_id TEXT,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_balance_topups_tenant
  ON ai_balance_topups (tenant_id, created_at DESC);

-- AI-агенты. До миграции 0014 существовали только в моках фронтенда: карточки
-- были одинаковы у всех арендаторов и исчезали при перезагрузке страницы.
CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'amber'
    CHECK (accent IN ('amber', 'sky', 'emerald', 'orange', 'rose')),
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused')),
  mode TEXT NOT NULL DEFAULT 'suggester'
    CHECK (mode IN ('suggester', 'autoreply', 'disabled')),
  temperature NUMERIC(3, 2) NOT NULL DEFAULT 0.7
    CHECK (temperature >= 0 AND temperature <= 1),
  max_tokens INT NOT NULL DEFAULT 1024 CHECK (max_tokens BETWEEN 128 AND 8192),
  -- Промпт в БД, а не в коде (.cursorrules §13).
  system_prompt TEXT NOT NULL,
  context_entities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agents_unique_name
  ON ai_agents (tenant_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_agents_tenant
  ON ai_agents (tenant_id)
  WHERE deleted_at IS NULL;

-- Журнал вызовов моделей (.cursorrules §13). Хранит и себестоимость, и
-- списанную сумму: наценку могли изменить после вызова, пересчёт задним числом
-- дал бы неверную маржу.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  provider_cost_kopecks BIGINT NOT NULL DEFAULT 0,
  charged_kopecks BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message TEXT NOT NULL DEFAULT '',
  usage_charge_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_created
  ON ai_usage_log (tenant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_log_charge_key
  ON ai_usage_log (usage_charge_key)
  WHERE usage_charge_key IS NOT NULL;

-- Relax the historical NOT NULL on existing installations: internal transfers
-- and invoice payments legitimately carry no tenant category. DROP NOT NULL is
-- idempotent, so a repeated run is a no-op.
ALTER TABLE transactions ALTER COLUMN category_id DROP NOT NULL;

-- Finance links and payment bookkeeping
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS repair_order_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS repair_order_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deal_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_account_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transactions_deal_id ON transactions(deal_id);
CREATE INDEX IF NOT EXISTS idx_transactions_repair_order_id ON transactions(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_repair_order_id ON invoices(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON invoices(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_tenant ON invoices(tenant_id, invoice_number);

-- =============================================================================
-- 4b. SaaS marketplace catalog (platform-owned) and tenant audit log
-- =============================================================================

-- Каталог маркетплейса с тарифной моделью.
--
-- Тариф не сводится к одному числу: базовая CRM считается как пакет + доплата
-- за сотрудников свыше включённых, AI-агенты и каналы — за каждую единицу,
-- сервисные модули — фиксированной суммой. Поэтому модель вынесена в
-- billing_kind и раздельные поля цен: держать формулу только в коде означало бы,
-- что цена в БД и цена в интерфейсе могут разойтись.
CREATE TABLE IF NOT EXISTS marketplace_modules (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Витринная цена «от» — для сортировки и совместимости со старым API.
  price_monthly NUMERIC NOT NULL DEFAULT 0,
  -- flat | per_seat | per_unit
  billing_kind TEXT NOT NULL DEFAULT 'flat',
  base_price NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  included_units INT NOT NULL DEFAULT 0,
  unit_label TEXT NOT NULL DEFAULT '',
  is_multi BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL DEFAULT 'integration',
  icon TEXT NOT NULL DEFAULT 'Puzzle',
  trial_days INT NOT NULL DEFAULT 14,
  features TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 100,
  is_available BOOLEAN NOT NULL DEFAULT true,
  pending_unit_price NUMERIC,
  pending_effective_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_modules_billing_kind
    CHECK (billing_kind IN ('flat', 'per_seat', 'per_unit'))
);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant_id ON tenant_audit_log(tenant_id);

-- Журнал отключений модулей (миграция 0010). Без этой таблицы POST toggle
-- на чистой установке падает: restore() читает её до любой вставки вкладок.
CREATE TABLE IF NOT EXISTS module_data_purges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  affected JSONB NOT NULL DEFAULT '{}',
  purge_after TIMESTAMPTZ NOT NULL,
  restored_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_module_data_purges_pending
  ON module_data_purges (tenant_id, slug)
  WHERE restored_at IS NULL AND purged_at IS NULL;

-- Каталог и цены. Значения совпадают с миграцией 0005_marketplace_pricing.sql:
-- schema.sql применяется только на чистом volume, миграция — на работающей БД.
INSERT INTO marketplace_modules
  (slug, name, description, price_monthly, billing_kind, base_price, unit_price,
   included_units, unit_label, is_multi, category, icon, trial_days, features, sort_order)
VALUES
  ('core_crm', 'Базовая CRM',
   'Контакты, компании, сделки с Kanban-воронкой и хронологией общения.',
   600, 'per_seat', 600, 200, 10, 'пользователь', false, 'crm', 'Users', 14,
   ARRAY['Контакты и компании', 'Воронка сделок', 'Задачи', 'Хронология и чат'], 10),
  ('service_center', 'Сервисный центр',
   'Наряд-заказы, диагностика, учёт работ и запчастей.',
   500, 'flat', 500, 0, 0, '', false, 'service', 'Wrench', 14,
   ARRAY['Приёмка оборудования', 'Диагностика', 'Работы и запчасти', 'Печать квитанций'], 20),
  ('finance', 'Финансы и счета',
   'Управленческий учёт, кассы, счёта и отчёт о прибылях и убытках.',
   500, 'flat', 500, 0, 0, '', false, 'finance', 'Receipt', 14,
   ARRAY['Кассы и переводы', 'Журнал операций', 'Выставление счетов', 'Отчёт P&L'], 30),
  ('ai_bots', 'AI-агенты',
   'AI-ассистенты для переписки: подсказки ответов и автоответы клиентам. Подключаются к Telegram, WhatsApp и MAX.',
   500, 'per_unit', 0, 500, 2, 'агент', true, 'ai', 'Bot', 14,
   ARRAY['Автоответы и подсказки', 'Шаблоны промптов', 'Выбор модели', 'Учёт токенов'], 40),
  ('telegram', 'Telegram',
   'Приём и отправка сообщений Telegram. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 2, 'аккаунт', true, 'integration', 'Send', 14,
   ARRAY['Мульти-аккаунт', 'Вложения и медиа', 'Автоприветствие', 'История в сделке'], 50),
  ('whatsapp', 'WhatsApp',
   'Переписка WhatsApp внутри CRM. Несколько номеров в одном портале.',
   500, 'per_unit', 0, 500, 2, 'аккаунт', true, 'integration', 'MessageCircle', 14,
   ARRAY['Мульти-аккаунт', 'Вложения и медиа', 'Шаблоны сообщений', 'История в сделке'], 60),
  ('max', 'MAX',
   'Мессенджер MAX: приём и отправка сообщений. Несколько аккаунтов.',
   500, 'per_unit', 0, 500, 2, 'аккаунт', true, 'integration', 'Hash', 14,
   ARRAY['Мульти-аккаунт', 'Вложения', 'Автоответы', 'История в сделке'], 70),
  ('avito', 'Avito',
   'Сообщения и объявления Avito. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Store', 14,
   ARRAY['Мульти-аккаунт', 'Чаты по объявлениям', 'Автоответы', 'Лид в сделку'], 80),
  ('instagram', 'Instagram',
   'Direct-переписка Instagram. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Instagram', 14,
   ARRAY['Мульти-аккаунт', 'Direct и комментарии', 'Автоответы', 'Лид в сделку'], 90),
  ('webchat', 'Онлайн-чат на сайт',
   'Виджет чата для сайтов с AI-ассистентом. 1 сайт включен бесплатно, дополнительные сайты — по тарифу.',
   500, 'per_unit', 0, 500, 1, 'сайт', true, 'integration', 'MessageSquareText', 14,
   ARRAY['1 сайт бесплатно в тарифе', 'Дополнительные сайты — 500 ₽/мес', 'Привязка AI-ассистентов', 'Сбор контактов в CRM'], 95),
  ('telegram_bot', 'Telegram-бот компании',
   'Официальный публичный бот компании через Bot API токен (@BotFather).',
   500, 'per_unit', 0, 500, 0, 'бот', true, 'integration', 'Bot', 14,
   ARRAY['Подключение по Bot API токену', 'Неограниченно клиентов', 'Команды и меню', 'Интеграция с AI-агентами'], 55),
  ('max_bot', 'MAX-бот компании',
   'Официальный публичный бот в мессенджере MAX по Bot API токену.',
   500, 'per_unit', 0, 500, 0, 'бот', true, 'integration', 'Hash', 14,
   ARRAY['Подключение по Bot API токену', 'Каналы и группы', 'Интеграция с AI-агентами'], 75)
ON CONFLICT (slug) DO NOTHING;

-- Платформенные настройки квот и цен Базовой CRM
CREATE TABLE IF NOT EXISTS platform_billing_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  base_crm_price NUMERIC(10, 2) NOT NULL DEFAULT 600,
  base_crm_users INT NOT NULL DEFAULT 10,
  base_crm_extra_user_price NUMERIC(10, 2) NOT NULL DEFAULT 200,
  base_crm_included_ai_agents INT NOT NULL DEFAULT 2,
  base_crm_included_telegram INT NOT NULL DEFAULT 2,
  base_crm_included_whatsapp INT NOT NULL DEFAULT 2,
  base_crm_included_max INT NOT NULL DEFAULT 2,
  base_crm_included_webchat INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_billing_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- Платформенные настройки интеграций (Robokassa и LLM)
CREATE TABLE IF NOT EXISTS platform_integrations_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  robokassa_login TEXT,
  robokassa_password_1 TEXT,
  robokassa_password_2 TEXT,
  robokassa_is_test BOOLEAN NOT NULL DEFAULT true,
  robokassa_hash_algo TEXT NOT NULL DEFAULT 'SHA256',
  robokassa_tax TEXT NOT NULL DEFAULT 'none',
  llm_api_base_url TEXT,
  llm_api_key TEXT,
  llm_embedding_model TEXT DEFAULT 'text-embedding-3-small',
  llm_chat_model TEXT DEFAULT 'openai/gpt-4o-mini',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_integrations_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4c. Подключённые аккаунты каналов связи
-- =============================================================================
--
-- Значения совпадают с миграцией 0012_channel_accounts.sql: schema.sql
-- применяется только на чистом volume, миграция — на работающей БД.
--
-- Одна таблица на все пять каналов, а не пять отдельных: набор полей у них
-- совпадает, а различия — в способе авторизации, который лежит в JSONB. Отсюда
-- же следует, что очистка данных при отключении канала обязана фильтровать по
-- `channel` (см. ModuleDataService.channelFilter), иначе отключение Telegram
-- скрыло бы и аккаунты WhatsApp.
CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'max', 'avito', 'instagram', 'webchat', 'telegram_bot', 'max_bot')),
  label TEXT NOT NULL,
  -- Идентификатор на стороне канала: @username, номер телефона, id профиля.
  external_id TEXT NOT NULL,
  -- `pending` — аккаунт создан, авторизация не завершена: исходное состояние,
  -- а не ошибка, поэтому отделено от `error`.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'disabled')),
  status_message TEXT NOT NULL DEFAULT '',
  -- Токены авторизации. Наружу не отдаются: сервис никогда не выбирает эту
  -- колонку в DTO. Шифрование остаётся долгом (ROADMAP M7.5.4).
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Числовой id пользователя на стороне канала. Для Telegram (MTProto) отличает
  -- переподключение того же аккаунта после смены username от нового.
  remote_user_id TEXT,
  -- Зашифрованы ли `credentials` (AES-256-GCM). Строки, созданные до миграции
  -- 0013, секретов не содержали, поэтому признак, а не безусловное шифрование.
  credentials_encrypted BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Временные сессии подключения аккаунта Telegram через MTProto.
-- Значения совпадают с миграцией 0013_telegram_mtproto.sql.
--
-- Состояние клиента между sendCode и signIn обязательно сохранять: MTProto
-- привязывает `phone_code_hash` к auth_key соединения, и новый клиент с пустой
-- сессией получил бы PHONE_CODE_INVALID на верный код.
CREATE TABLE IF NOT EXISTS telegram_auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  label TEXT NOT NULL,
  phone_code_hash TEXT NOT NULL,
  -- Зашифровано: даже незавершённая сессия содержит auth_key соединения.
  session_state TEXT NOT NULL,
  requires_2fa BOOLEAN NOT NULL DEFAULT false,
  password_hint TEXT,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_auth_sessions_tenant
  ON telegram_auth_sessions (tenant_id)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_auth_sessions_expires
  ON telegram_auth_sessions (expires_at);

-- База знаний агентов (RAG, миграция 0015). Документы хранят исходный текст,
-- потому что объектного хранилища в проекте нет, а без текста документ нельзя
-- перевекторизовать при смене модели эмбеддингов.
CREATE TABLE IF NOT EXISTS knowledge_base_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL — документ общий для арендатора, а не для одного агента.
  agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INT NOT NULL CHECK (file_size >= 0),
  content_text TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('processing', 'ready', 'failed')),
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant_agent
  ON knowledge_base_documents (tenant_id, agent_id, created_at DESC);

-- Фрагменты документов с эмбеддингами. `vector(1536)` — размерность
-- `text-embedding-3-small` (проверено живым вызовом провайдера). Размерность
-- зафиксирована в типе: иначе в одной таблице оказались бы несравнимые векторы, и
-- поиск молча возвращал бы мусор.
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_base_chunks_unique_index UNIQUE (document_id, chunk_index)
);

-- HNSW, а не IVFFlat: последний требует обучения на уже существующих данных и на
-- пустой таблице даёт негодный индекс, а база знаний наполняется постепенно.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding
  ON knowledge_base_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant_agent
  ON knowledge_base_chunks (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_document
  ON knowledge_base_chunks (document_id, chunk_index);

-- Привязка агента к подключённому аккаунту канала. `tenant_id` нужен для
-- RLS-политики: оба внешних ключа ведут на таблицы под RLS, и политика не может
-- опираться на их чтение.
CREATE TABLE IF NOT EXISTS ai_agent_channel_bindings (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, channel_account_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_channel_bindings_tenant
  ON ai_agent_channel_bindings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_channel_bindings_account
  ON ai_agent_channel_bindings (channel_account_id)
  WHERE is_enabled;

-- =============================================================================
-- SAAS BILLING & SUBSCRIPTIONS (Robokassa)
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS robokassa_inv_id_seq START 100001;

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  period_months INT NOT NULL DEFAULT 1,
  seats_included INT NOT NULL DEFAULT 10,
  extra_seats INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'past_due')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_ends_at ON subscriptions(ends_at);

CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  robokassa_inv_id INT NOT NULL UNIQUE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  balance_applied_rub NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  product_code TEXT NOT NULL,
  period_months INT DEFAULT 1,
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  fiscal_receipt JSONB DEFAULT NULL,
  paid_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_tenant_id ON billing_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON billing_payments(status);
CREATE INDEX IF NOT EXISTS idx_billing_payments_robokassa_inv_id ON billing_payments(robokassa_inv_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_idempotency_key ON billing_payments(idempotency_key);

CREATE TABLE IF NOT EXISTS story_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'photo',
  text TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  link_text TEXT,
  views_count INT NOT NULL DEFAULT 0,
  reactions_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_posts_tenant_posted ON story_posts(tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_posts_tenant_status ON story_posts(tenant_id, status);

CREATE TABLE IF NOT EXISTS mailing_stage_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES stages(id) ON DELETE CASCADE,
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  name TEXT NOT NULL,
  delay_seconds INT NOT NULL DEFAULT 0,
  template_text TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailing_stage_rules_lookup ON mailing_stage_rules(tenant_id, stage_id, is_active);

CREATE TABLE IF NOT EXISTS ai_sales_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  customer_query TEXT NOT NULL,
  agent_reply TEXT NOT NULL,
  embedding vector(1536),
  source_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_sales_examples_tenant ON ai_sales_examples(tenant_id, created_at DESC);


-- Один аккаунт нельзя привязать дважды: сообщения приходили бы в два
-- подключения, а тариф считал бы два аккаунта. Частичный индекс — удалённое
-- подключение не мешает привязать тот же аккаунт снова.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_unique_external
  ON channel_accounts (tenant_id, channel, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant_channel
  ON channel_accounts (tenant_id, channel)
  WHERE deleted_at IS NULL;

-- tenant isolation indexes
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_tenant_id ON companies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_id ON deals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deal_messages_tenant_id ON deal_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deal_messages_channel_account_id ON deal_messages(channel_account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_telegram_chat_id ON contacts(tenant_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
-- Поиск контакта по любому из его номеров и мессенджеров идёт по JSONB: без GIN
-- crm-pipeline читал бы таблицу целиком на каждое входящее сообщение.
CREATE INDEX IF NOT EXISTS idx_contacts_additional_phones ON contacts USING gin (additional_phones jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_socials ON contacts USING gin (socials jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(tenant_id, company_id) WHERE deleted_at IS NULL AND company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner_id ON deals(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage_position ON deals(tenant_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_companies_domain_name ON companies(tenant_id, domain_name) WHERE domain_name <> '';
CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_id ON crm_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_id ON repair_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_tenant_id ON cash_accounts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_repair_works_tenant_id ON repair_works(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_tenant_id ON repair_parts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repair_notes_tenant_id ON repair_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repair_photos_tenant_id ON repair_photos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_device_models_tenant_id ON device_models(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_tenant_id ON deal_stage_history(tenant_id);

-- foreign-key lookup indexes
CREATE INDEX IF NOT EXISTS idx_repair_works_order_id ON repair_works(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_order_id ON repair_parts(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_notes_order_id ON repair_notes(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_photos_order_id ON repair_photos(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_deal_messages_deal_id ON deal_messages(deal_id);

-- Неудачные доставки — частичным индексом: полный индекс по колонке из четырёх
-- значений планировщику бесполезен.
CREATE INDEX IF NOT EXISTS idx_deal_messages_failed_delivery
  ON deal_messages (tenant_id, deal_id)
  WHERE delivery_status = 'failed';
CREATE INDEX IF NOT EXISTS idx_deals_stage_id ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_ai_paused_until ON deals(tenant_id, ai_paused_until) WHERE ai_paused_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee_id ON crm_tasks(assignee_id);

-- unique ticket number per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_orders_ticket_number
  ON repair_orders(tenant_id, ticket_number);

-- JSONB GIN indexes for custom_fields
CREATE INDEX IF NOT EXISTS idx_contacts_custom_fields_gin ON contacts USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_companies_custom_fields_gin ON companies USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_deals_custom_fields_gin ON deals USING GIN (custom_fields);

-- =============================================================================
-- 6. FULL-TEXT SEARCH
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_contacts_search ON contacts USING GIN (
  to_tsvector('simple', first_name || ' ' || last_name || ' ' || phone || ' ' || company_name)
);

CREATE INDEX IF NOT EXISTS idx_companies_search ON companies USING GIN (
  to_tsvector('simple', name || ' ' || inn || ' ' || manager_name)
);

CREATE INDEX IF NOT EXISTS idx_deals_search ON deals USING GIN (
  to_tsvector('simple', title || ' ' || description)
);

-- =============================================================================
-- 7. updated_at TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
     'tenants', 'users', 'contacts', 'companies', 'deals', 'crm_tasks', 'notes',
     'record_table_layouts', 'page_layout_tabs', 'repair_orders', 'cash_accounts', 'invoices',
     'channel_accounts', 'telegram_auth_sessions', 'ai_agents', 'subscriptions', 'billing_payments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', target_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      target_table
    );
  END LOOP;
END;
$$;

-- =============================================================================
-- 8. ROW-LEVEL SECURITY
-- =============================================================================
--
-- The API sets `app.tenant_id` on every pooled connection it checks out (see
-- db/client.ts — the authenticate hook binds the tenant for the whole request).
-- Policies compare tenant_id against that GUC, so a forgotten WHERE clause
-- cannot leak another tenant's rows. Application queries still filter on
-- tenant_id explicitly — RLS is the second line of defence, not the first.
--
-- Enforcement requires BOTH of the following, which migration
-- 0002_rls_enforce.sql applies to existing installations:
--   * `FORCE ROW LEVEL SECURITY` — without it the table owner ignores policies;
--   * connecting as `app_user`, not the owner/superuser role — a SUPERUSER has
--     `rolbypassrls` and is not stopped even by FORCE.
-- Declaring the policies alone leaves them decorative.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
EXCEPTION
  WHEN invalid_text_representation THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Platform-wide reads for the superadmin panel. Set only by the
-- requirePlatformOwner gate, after it verified users.platform_role.
CREATE OR REPLACE FUNCTION platform_scope() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.platform_scope', true), 'off') = 'on';
END;
$$ LANGUAGE plpgsql STABLE;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
     'contacts', 'companies', 'deals', 'deal_messages', 'deal_stage_history', 'crm_tasks', 'notes',
     'record_table_layouts', 'page_layout_tabs',
    'repair_orders', 'repair_works', 'repair_parts', 'repair_notes', 'repair_photos',
    'device_models', 'cash_accounts', 'finance_categories', 'transactions', 'invoices',
     'installed_modules', 'module_data_purges', 'channel_accounts', 'telegram_auth_sessions',
    'ai_agents', 'ai_usage_log', 'ai_balance_topups',
    'knowledge_base_documents', 'knowledge_base_chunks', 'ai_agent_channel_bindings',
    'subscriptions', 'billing_payments',
    'story_posts', 'mailing_stage_rules', 'ai_sales_examples'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    -- WITH CHECK omits platform_scope() on purpose: the platform panel reads
    -- across tenants but must never write on their behalf.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id() OR platform_scope())
         WITH CHECK (tenant_id = current_tenant_id())',
      target_table
    );
  END LOOP;
END;
$$;

-- otp_codes, refresh_tokens, auth_sessions and password_reset_tokens are
-- deliberately excluded from the policy loop. All are read before a tenant
-- context exists: an OTP is looked up by phone while the caller is still
-- anonymous, a refresh token is resolved by its hash to discover which tenant it
-- belongs to, and a password reset token is resolved the same way from a link in
-- an e-mail. A tenant_id = current_tenant_id() policy would evaluate against a
-- NULL GUC and block the login and recovery paths outright. Isolation is
-- enforced in SQL instead: every read filters on the phone or token hash, and
-- the rows additionally carry tenant_id/user_id.

-- invoice_items has no tenant_id of its own; it inherits scope from its parent.
-- An explicit WITH CHECK is required: with FORCE enabled a policy without one
-- falls back to the USING expression for writes, and since the parent invoice
-- and its items are inserted in the same transaction, that would reject the
-- insert and break invoice creation outright.
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_items;
CREATE POLICY tenant_isolation ON invoice_items
  USING (
    platform_scope() OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_tenant_id()
    )
  );
