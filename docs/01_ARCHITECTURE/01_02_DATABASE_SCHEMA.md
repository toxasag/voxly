# 01_02 — Схема базы данных

> Источник: `backend/src/db/schema.sql`. PostgreSQL 16 + **pgvector 0.8.0**.
>
> Фактическое количество таблиц — **38** (сверено с развёрнутой схемой в
> контейнере; `pgmigrations` служебная, её создаёт раннер миграций).
> Обновлено 2026-08-24: добавлены `knowledge_base_documents`,
> `knowledge_base_chunks` и `ai_agent_channel_bindings` (`0015`), число таблиц
> приведено к фактическому.
> Ранее: `channel_accounts` (`0012`), `telegram_auth_sessions` (`0013`),
> `ai_agents`, `ai_usage_log`, `ai_balance_topups` (`0014`), `module_data_purges`
> (`0010`).
>
> Расширения: `uuid-ossp`, `pgcrypto`, `vector`. Последнее требует образа БД с
> pgvector — см. `docker/postgres-pgvector.Dockerfile`.

---

## 1. Общие соглашения

- Первичные ключи: `UUID DEFAULT uuid_generate_v4()`.
- Имена таблиц: `snake_case`, множественное число.
- Метки времени: `created_at`, `updated_at` (`TIMESTAMPTZ NOT NULL DEFAULT now()`), UTC.
- Мягкое удаление: `deleted_at TIMESTAMPTZ`, все чтения фильтруют `deleted_at IS NULL`.
- Расширяемость: `custom_fields JSONB DEFAULT '{}'` вместо колонок на лету.
- Каждая арендуемая таблица несёт `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.

---

## 2. Таблицы

### Блок 1 — Арендаторы и доступ

**`tenants`** — арендатор.
`id`, `name`, `slug`, `plan`, `status` (`trial|active|past_due|suspended`), `ai_tokens_balance BIGINT`, `subscription_expires_at`, `created_at`, `updated_at`.

`slug` — личный поддомен (`{slug}.getvoxly.ru`). Уникален **глобально** (`idx_tenants_slug`), а не в пределах арендатора, как почти всё остальное: поддомен — ресурс всей платформы. Формат ограничен `CHECK tenants_slug_format` (`^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$`), потому что значение попадает в имя хоста и не должно зависеть только от валидации в UI.

**`reserved_slugs`** — служебные поддомены, недоступные арендаторам.
`slug PRIMARY KEY`. 32 записи: `api` и `app` заняты реальными хостами, остальные (`www`, `admin`, `superadmin`, `n8n`, `baserow`, `login`, `billing` и др.) — типовые цели фишинга и путаницы. Список в БД, а не только в коде, чтобы правило не обходилось прямой вставкой. Вне RLS: читается при регистрации, когда tenant-контекста ещё нет.

**`users`** — пользователи арендатора.
`id`, `tenant_id`, `email`, `phone`, `name`, `role`, `platform_role`, `password_hash`, `permissions TEXT[]`, `telegram_chat_id BIGINT`, `telegram_username`, метки времени.
Ограничения: `UNIQUE (tenant_id, email)`, `UNIQUE (tenant_id, phone)` — один e-mail может существовать в разных арендаторах.

`telegram_chat_id` — привязка для доставки кодов подтверждения. `BIGINT`, потому что идентификаторы чатов Telegram выходят за пределы `INT32`. Частичный уникальный индекс `idx_users_telegram_chat_id` (`WHERE telegram_chat_id IS NOT NULL`) не даёт одному Telegram-аккаунту управлять несколькими учётными записями: иначе в один чат приходили бы коды для разных логинов и было бы неясно, к какому относится присланный код.

**`auth_sessions`** — сессии подтверждения (OTP) для регистрации и второго фактора входа.
`id`, `purpose` (`register|login`), `channel` (`telegram|max`), `phone`, `email`, `code_hash`, `attempts`, `telegram_chat_id`, `deep_link_token`, `delivered_at`, `verified_at`, `consumed_at`, `expires_at`, метки времени.

Отдельная таблица, а не расширение `otp_codes`: та ключуется по телефону **существующего** пользователя, а при регистрации пользователя ещё нет. Здесь строка живёт до его создания и дополнительно хранит канал доставки, целевой e-mail и признак доставки.

Хранение в PostgreSQL, а не в памяти процесса: при перезапуске контейнера все ожидающие подтверждения сессии обнулились бы. Redis в стек не развёрнут.

Вне RLS сознательно — читается анонимным вызовом до появления tenant-контекста; политика `tenant_id = current_tenant_id()` сверялась бы с NULL GUC и заблокировала бы регистрацию. Права для `app_user` выданы явно, так как эта роль не владелец таблицы.

Просроченные строки пока не чистятся автоматически (нужен cron или BullMQ).

**`installed_modules`** — какие модули включены арендатору.
`id`, `tenant_id`, `slug`, `name`, `quantity`, `trial_ends_at`, `installed_at`, `UNIQUE (tenant_id, slug)`, `CHECK (quantity >= 1)`.
Читается хуком `authenticate` и питает `requireModule`.

`quantity` — число подключённых единиц (AI-агентов, аккаунтов канала); для модулей с фиксированной ценой всегда 1. `trial_ends_at` — окончание пробного периода; `NULL` означает, что период не начислялся, активность определяется сравнением с `now()`.

Пробный период начисляется только при **первой** установке. Строка удаляется при отключении, поэтому историю нельзя проверить по самой таблице — факт прошлой установки ищется в `tenant_audit_log` (`action = 'module.install'`), иначе цикл «отключить → включить» выдавал бы новые 14 дней бесконечно.

**`otp_codes`** — одноразовые коды входа.
`id`, `phone`, `code_hash`, `attempts`, `consumed_at`, `expires_at`, `created_at`.
Хранится только argon2-хеш, поэтому чтение таблицы нельзя переиграть как вход. Не привязана к арендатору: на момент запроса кода вызывающий анонимен, и пользователя определяет номер телефона. Индексы: `(phone, created_at DESC)`, `expires_at`.

**`refresh_tokens`** — сессии обновления.
`id`, `tenant_id`, `user_id`, `token_hash UNIQUE`, `expires_at`, `revoked_at`, `replaced_by → refresh_tokens`, `created_at`.
Хранятся SHA-256-дайджесты. Ротация выставляет `revoked_at` и связывает преемника через `replaced_by` — самоссылка, которая делает повторное использование украденного токена обнаружимым. Индексы: `user_id`, `tenant_id`, `expires_at`.

### Блок 2 — Ядро CRM

**`contacts`** — физические лица.
`first_name`, `last_name`, `middle_name`, `phone`, `phone_country_code`, `phone_calling_code`, **`additional_phones JSONB`**, `email`, `telegram_username`, `whatsapp`, **`socials JSONB`**, `job_title`, `company_name`, `company_id → companies ON DELETE SET NULL`, `channel`, `linkedin_link`, **`custom_fields JSONB`**, `notes`, `created_by → users`, `deleted_at`.

Обязательно только `first_name`: миграция `0020` снимает `NOT NULL` с `last_name`,
`phone` и `company_name` по образцу `Person` у Twenty, где nullable всё, кроме
идентификатора. `middle_name` — наша специфика, в их `FULL_NAME` отчества нет.

Телефоны повторяют их composite-тип `PHONES`: основной номер в трёх колонках
(`phone` — E.164, `phone_country_code` — ISO-2, `phone_calling_code` — префикс со
знаком плюс), дополнительные — в `additional_phones` массивом
`{number, countryCode, callingCode}`. Раздельно, потому что по основному номеру
ищет транспорт каналов — по индексируемой колонке, а не по JSONB. Код страны и код
звонка хранятся отдельно: один код звонка принадлежит нескольким странам (`+1` —
США и Канада), и по нему нельзя выбрать флаг.

`socials` — массив `{kind, value}`, где `kind` ∈
`telegram|whatsapp|max|viber|vk|instagram|other`. Колонки `telegram_username` и
`whatsapp` сохранены и синхронизируются сервисом при каждой записи: по ним ищет
`crm-pipeline` и запросы интеграций каналов.

**`channel` и слаги каналов расходятся, и это нужно знать при правках.** Колонка
принимает `telegram|whatsapp|rumax|phone|email` (`contactChannelSchema`), а в
`channel_accounts.channel` тот же мессенджер MAX называется `max`
(`CHANNEL_SLUGS`). `CHECK` на колонке нет, поэтому расхождение ничем не
удерживается: `crm-pipeline` до `M7.8.11` приводил слаг типом (`as`) и писал в
`contacts.channel` значение `max`, которого нет в перечислении фронта — метка
канала теряла цвет. Теперь перевод идёт таблицей `CONTACT_CHANNEL_BY_SLUG`
(`modules/crm/channel-identity.ts`), а каналы без своего значения (`avito`,
`instagram`) остаются `phone`: канал переписки видно в самих сообщениях.

Структура обоих JSONB проверяется ограничениями `contacts_additional_phones_shape`
и `contacts_socials_shape` на `jsonb_path_exists`. Подзапрос с
`jsonb_array_elements` в `CHECK` PostgreSQL не принимает («cannot use subquery in
check constraint»).

**`companies`** — организации с реквизитами РФ.
`name`, `phone`, `email`, `inn`, `ogrn`, `bik`, `account_number`, `legal_address`, `manager_name`, `manager_id`, `notes`, **`custom_fields JSONB`**, `deleted_at`.

**`pipelines`** — воронки продаж. `name`, `sort_order`.

Миграция `0018` добавила поля по образцу стандартных объектов Twenty: `deals.owner_id` (ответственный отдельно от `created_by` — сделку может завести AI-агент, а вести менеджер), `deals.close_date` (прогнозная дата закрытия), `deals.position DOUBLE PRECISION` (порядок карточки внутри колонки канбана; дробный, чтобы вставка считалась средним между соседями без перенумерации колонки), `contacts.job_title`, `companies.domain_name` (ключ дедупликации компаний).

Миграция `0020` дополнительно **создала компании из названий у контактов**:
`company_name` лежал строкой и записи в `companies` не создавал, поэтому список
компаний был пуст при заполненных компаниях в контактах. Для каждого непустого
названия без связи создаётся компания, `company_id` проставляется. Дедупликация по
`lower(btrim(name))` через `DISTINCT ON` — «ООО ТехКорп» и «ооо техкорп» это одна
организация.

**`stages`** — этапы воронки. `pipeline_id → pipelines`, `name`, `sort_order`, `is_won`, `is_lost`, **`color TEXT DEFAULT 'slate'`** (миграция `0017`: ключ пресета — `amber|emerald|sky|rose|violet|orange|cyan|slate`; фронт маппит ключ в готовые классы Tailwind, произвольный CSS не хранится).
Флаги `is_won`/`is_lost` определяют терминальность: при переходе на такой этап сделке ставится `closed_at`.

**`deals`** — сделки.
`pipeline_id → pipelines`, `stage_id → stages`, `contact_id`, `company_id`, `title`, `description`, `budget NUMERIC`, `currency`, **`custom_fields JSONB`**, `created_by → users`, `closed_at`, `deleted_at`.

**`deal_messages`** — таймлайн переписки по сделке.
`deal_id → deals ON DELETE CASCADE`, `channel_account_id`, `source`, `direction`, `sender_name`, `content`, `channel`, `attachment`, `attachment_type`, **`delivery_status TEXT DEFAULT 'neutral'`**, **`delivery_error TEXT`** (миграция `0022`).

Статус доставки хранится на строке сообщения, а не показывается тостом: тост
исчезает, а неотправленное сообщение осталось бы висеть в таймлайне как
отправленное, и менеджер ждал бы ответа на то, что до клиента не дошло.
Значения (`CHECK`): `neutral` — доставлять некуда (входящее от клиента,
системная запись), `pending` — строка записана, транспорт ещё не подтвердил,
`sent` — подтверждено, `failed` — отказ, причина в `delivery_error`.
Частичный индекс `idx_deal_messages_failed_delivery` только по `failed`: полный
индекс по колонке из четырёх значений планировщику бесполезен.

**`deal_stage_history`** — аудит перемещений по воронке.
`deal_id`, `from_stage_id`, `to_stage_id`, `changed_by → users`, `created_at`.

**`crm_tasks`** — задачи.
`deal_id`, `contact_id`, `company_id` (заполнена максимум одна — логическая привязка к одной сущности), `title`, `description`, `priority`, `status`, `due_date`, `assignee_id → users`, `completed_at`, `deleted_at`.

### Блок 3 — Сервисный центр

**`repair_orders`** — заказ-наряды.
`ticket_number` (формат `ЗН-YYYY-NNNN`), `customer_id`, `customer_name`, `customer_phone`, оборудование (`equipment_type`, `equipment_brand`, `equipment_model`, `equipment_serial`), `package_contents`, `appearance`, `defect_description`, `defect_photos TEXT[]`, `status`, `priority`, `master_id`, `master_name`, `estimated_cost`, `final_cost`, `notes`, **`diagnostics JSONB`**, `received_at`, `completed_at`, `delivered_at`, `deleted_at`.

**`repair_works`** — выполненные работы. `tenant_id`, `repair_order_id`, `description`, `master_id`, `master_name`, `cost NUMERIC`.

**`repair_parts`** — списанные запчасти. `tenant_id`, `repair_order_id`, `name`, `article`, `quantity INT`, `retail_price`, `cost_price`.
Разделение розничной и закупочной цены даёт расчёт маржи.

**`repair_notes`** — заметки и журнал смены статусов.
`author_id → users`, `author_name`, `kind` (`note|status`), `content`, `from_status`, `to_status`.

**`repair_photos`** — вложения. `url`, `caption`, `uploaded_by → users`.

**`device_models`** — справочник обслуживаемой техники. `equipment_type`, `brand`, `model`, `notes`, `UNIQUE (tenant_id, brand, model)`. Пополняется автоматически при приёмке.

**`repair_counters`** — счётчики номеров документов. `PRIMARY KEY (tenant_id, counter_type, year)`, `last_number INT`, `counter_type TEXT DEFAULT 'repair'`.
Upsert сериализует параллельные обращения, поэтому номера не дублируются. `counter_type` разделяет серии: `repair` даёт `ЗН-YYYY-NNNN`, `invoice` — `СЧ-YYYY-NNNN`. До появления этой колонки обе серии инкрементировали одну строку, из-за чего нумерация нарядов и счетов перемешивалась.
Имя таблицы историческое: она больше не относится только к ремонтам. Для инсталляций, созданных до разделения, `schema.sql` расширяет первичный ключ и засевает серию `invoice` от того же значения, чтобы уже выданный номер счёта не мог быть выдан повторно.

### Блок 4 — Финансы

**`cash_accounts`** — кассы и счёты. `name`, `currency`, `balance NUMERIC`, `is_default`.

**`finance_categories`** — статьи доходов/расходов. `name`, `type`, `parent_id → finance_categories` (самоссылка, иерархия).

**`transactions`** — движение денег.
`cash_account_id → cash_accounts`, `category_id → finance_categories` (**nullable**), `category_name`, `amount`, `currency`, `direction` (`income|expense`), `description`, `counterparty_name`, `counterparty_inn`, `deal_id`, `repair_order_id`, `invoice_id`, `occurred_at`.
Три поля привязки связывают деньги со сделкой, ремонтом или счётом.
`category_id` допускает `NULL` осознанно: системные движения — внутренние переводы (`Internal transfer`) и оплата счёта (`Invoice payment`) — не относятся к пользовательской статье расходов. `category_name` заполняется всегда, поэтому отчёт P&L группирует и такие записи. Ранее колонка была `NOT NULL`, и три операции записи гарантированно падали на `not-null violation`.

**`invoices`** — счета на оплату.
`invoice_number` (`СЧ-YYYY-NNNN`), `status` (`draft|sent|paid|overdue|cancelled`), `issue_date`, `due_date`, `company_id`, `company_name`, `company_inn`, `company_address`, `contact_name`, `contact_phone`, `deal_id`, `repair_order_id`, `subtotal`, `vat_rate`, `vat_amount`, `total`, `currency`, `notes`, `paid_at`, `paid_account_id`, `created_by → users`, `deleted_at`.

**`invoice_items`** — позиции счёта.
`invoice_id → invoices ON DELETE CASCADE`, `description`, `quantity`, `unit_price`, `total`, `source` (`manual|repair_work|repair_part|deal`), `source_label`.
Своего `tenant_id` нет — область наследуется от `invoices`.

### Блок 5 — Платформа

**`marketplace_modules`** — каталог модулей платформы (не арендуемый).
`slug PRIMARY KEY`, `name`, `description`, `price_monthly`, `billing_kind`, `base_price`, `unit_price`, `included_units`, `unit_label`, `is_multi`, `category`, `icon`, `trial_days`, `features TEXT[]`, `sort_order`, `is_available`.

Тариф не сводится к одному числу, поэтому модель вынесена в `billing_kind` (`CHECK` на три значения):

| Модель | Расчёт | Модули |
|---|---|---|
| `flat` | `base_price` | Сервисный центр, Финансы — 500 ₽ |
| `per_seat` | `base_price + max(0, users − included_units) × unit_price` | Базовая CRM — 600 ₽ за 10 пользователей, далее +200 ₽ |
| `per_unit` | `unit_price × quantity` | AI-агенты и 5 каналов — 500 ₽ за единицу |

Хранение в БД, а не только в коде: иначе цена в каталоге и цена, по которой считается счёт, могли бы разойтись. Число пользователей для `per_seat` считается по таблице `users` на сервере — иначе стоимость подписки задавал бы клиент.

`icon` хранит имя иконки lucide, поэтому новый канал добавляется одной строкой без правки фронтенда.

Засеяно 9 модулей: `core_crm`, `service_center`, `finance`, `ai_bots`, `telegram`, `whatsapp`, `max`, `avito`, `instagram`.

Слаг `ai_bots` отображается как «AI-агенты», но **не переименован**: он используется типом `ModuleSlug`, гейтом `requireModule`, компонентом `<Guard>` и строками `installed_modules` существующих арендаторов.

### Блок 5a — ИИ: агенты, баланс, расход

**`ai_agents`** — AI-агенты арендатора (миграция `0014`).
`tenant_id`, `name`, `description`, `accent`, `model`, `status` (`active|paused`), `mode` (`suggester|autoreply|disabled`), `temperature`, `max_tokens`, **`system_prompt`**, `context_entities TEXT[]`, `created_at`, `updated_at`, `deleted_at`.

До этой миграции агенты существовали только в моках фронтенда: карточки «Помощник по продажам» и «Статус ремонта» были захардкожены, одинаковы у всех арендаторов и исчезали при перезагрузке страницы. Промпт хранится в БД по требованию `.cursorrules` §13.

`idx_ai_agents_unique_name` — частичный уникальный индекс по `(tenant_id, lower(name)) WHERE deleted_at IS NULL`: два агента с одним именем в списке неразличимы, но удалённое имя можно использовать снова.

**`ai_usage_log`** — журнал вызовов моделей (`.cursorrules` §13).
`tenant_id`, `agent_id → ai_agents`, `user_id → users`, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `provider_cost_kopecks`, `charged_kopecks`, `status`, `error_message`, `created_at`.

Хранит **и** себестоимость у провайдера, **и** списанную сумму: по разнице считается маржа платформы, а пересчёт задним числом невозможен — наценку могли изменить после вызова. Пока пуст: ключей LLM-провайдера на платформе нет.

**`ai_balance_topups`** — журнал пополнений баланса ИИ.
`tenant_id`, `created_by → users`, `amount_kopecks`, `source` (`manual|payment|bonus`), `external_payment_id`, `comment`, `created_at`.

Нужен, чтобы объяснить, откуда сумма на балансе, и свести расчёты с клиентом. Платёжного провайдера нет, поэтому по факту используется `manual`.

**Деньги хранятся в копейках** (`BIGINT`), а не в рублях с плавающей точкой: `0.1 + 0.2 ≠ 0.3`, и остаток со временем расходился бы с суммой операций. Тот же подход применён в модуле финансов.

Колонки арендатора: `tenants.ai_balance_kopecks` (баланс) и `tenants.ai_markup_percent` (наценка платформы, `CHECK` −100…1000 %). Наценка живёт на арендаторе, а не в конфиге: разным клиентам можно дать разные условия.

Прежняя `tenants.ai_tokens_balance` (остаток **в штуках токенов**) помечена устаревшей и оставлена — на неё ссылаются платформенные экраны и контракт `03_04`. Как основной счётчик она не годится: цена 1000 токенов различается между моделями в десятки раз, поэтому «остаток токенов» не отвечает на вопрос, на сколько их хватит.

### Блок 5b — База знаний агентов (RAG, миграция `0015`)

Требует расширения **`pgvector` 0.8.0**. Образ БД собирается из
`docker/postgres-pgvector.Dockerfile` (`postgres:16-alpine` + компиляция из
исходников): готового alpine-образа с расширением не существует, а переход на
Debian-образ сменил бы libc с musl на glibc, то есть библиотеку сортировки строк —
все 66 текстовых индексов существующего тома, включая UNIQUE по `lower(email)` и
`slug`, разошлись бы с данными до полного `REINDEX DATABASE`.

**`knowledge_base_documents`** — загруженные материалы агента.
`tenant_id`, `agent_id → ai_agents` (nullable), `filename`, `mime_type`,
`file_size`, `content_text`, `status` (`processing|ready|failed`),
`error_message`, `created_at`.

`agent_id NULL` — документ общий для арендатора: регламент компании одинаков для
всех агентов, и дублировать его означало бы платить за векторизацию столько раз,
сколько агентов.

`content_text` хранит исходный текст целиком: без него документ нельзя
перевекторизовать при смене модели эмбеддингов, а исходный файл не сохраняется —
объектного хранилища в проекте нет (см. `M0.13.19`).

**`knowledge_base_chunks`** — фрагменты с векторами.
`tenant_id`, `document_id → knowledge_base_documents ON DELETE CASCADE`,
`agent_id → ai_agents`, `chunk_index`, `content`, **`embedding vector(1536)`**,
`created_at`, `UNIQUE (document_id, chunk_index)`.

Размерность соответствует `text-embedding-3-small` (подтверждено живым вызовом
провайдера) и зафиксирована в типе: иначе в одной таблице оказались бы
несравнимые векторы, и поиск молча возвращал бы мусор. Смена модели требует
миграции.

`tenant_id` дублируется, хотя выводится через `document_id`: поиск фильтрует по
нему напрямую, и JOIN ради изоляции на каждом обращении к векторному индексу
лишний. Он же несёт RLS-политику.

`idx_kb_chunks_embedding` — **HNSW** (`vector_cosine_ops`, оператор `<=>`), а не
IVFFlat: последний требует обучения на уже существующих данных (`lists`
подбирается по их количеству) и на пустой таблице даёт негодный индекс, а база
знаний наполняется постепенно. Рядом обычный btree по `(tenant_id, agent_id)` —
без него фильтр перед сравнением векторов читал бы таблицу целиком.

**`ai_agent_channel_bindings`** — в каких аккаунтах каналов отвечает агент.
`tenant_id`, `agent_id → ai_agents`, `channel_account_id → channel_accounts`,
`is_enabled`, `created_at`, `PRIMARY KEY (agent_id, channel_account_id)`.

`tenant_id` добавлен к структуре из задания: без него RLS-политика невыразима —
оба внешних ключа ведут на таблицы под RLS, и политика не может опираться на их
чтение, потому что вне tenant-контекста оно вернуло бы ноль строк.

Составной первичный ключ, а не суррогатный: один агент подключается к нескольким
аккаунтам, один аккаунт может обслуживаться несколькими агентами, и повторная
вставка той же пары должна отклоняться. `is_enabled` вместо удаления строки —
отключение сохраняет настройку.

Все три таблицы под RLS с `FORCE`, политика сверяется через `current_tenant_id()`,
а не прямым кастом `current_setting('app.tenant_id')::uuid`: функция приводит
пустую строку к NULL и перехватывает `invalid_text_representation`, тогда как
прямой каст падал бы с `22P02` на любом запросе вне контекста.

**`record_table_layouts`** — персональная раскладка RecordTable.
`tenant_id`, `user_id → users`, `table_id` (`contacts|companies|deals|tasks`),
`layout JSONB`, timestamps, составной ключ `(tenant_id, user_id, table_id)`.

Строка принадлежит пользователю, а не всему тенанту: ширина и скрытые колонки —
личная настройка. Уникальный составной ключ делает запись атомарным upsert и
не даёт двум снимкам одной таблицы расходиться между браузерами. Таблица в RLS
с `FORCE`; сервис дополнительно фильтрует по tenant и user в каждом запросе.

**`page_layout_tabs`** — вкладки карточек как данные (миграции `0024`, `0025`).
`tenant_id`, `object_type` (`contact|company|deal`), `tab_key`, `title`, `icon`,
`position double precision`, `is_active`, `module_slug NULL`,
`required_permission NULL`, timestamps. PK `(tenant_id, object_type, tab_key)`.

Состав и порядок вкладок живут в БД; React-компонент остаётся в коде (фабрика
`tab_key → содержимое`). `module_slug` прячет вкладку при отключённом модуле без
правки фронта; `required_permission` сохраняет права вроде `deals:write` у чата.
`visibility_rule JSONB` намеренно нет — у нас вкладка = один компонент, не сетка
виджетов. Сид: контакт/компания `home 10 / tasks 30 / notes 40`; сделка
`home 10 / chat 15 / tasks 30 / notes 40 / files 50` (`files` с `is_active=false`).
Новый арендатор получает те же строки через `ensureTenantDefaults`. RLS с `FORCE`.

**`tenant_audit_log`** — аудит действий.
`tenant_id`, `actor_user_id → users`, `action`, `entity_type`, `entity_id`, **`details JSONB`**, `created_at`.

Для модулей `entity_id` хранит слаг, а `action` — `module.install` / `module.uninstall` / `module.quantity`. По наличию `module.install` определяется, начислялся ли уже пробный период: строка `installed_modules` при отключении удаляется, поэтому историю хранит только журнал.

**`module_data_purges`** — журнал отключений модулей (миграция `0010`). Таблица есть и в `schema.sql`: без неё `POST /marketplace/modules/:slug/toggle` на чистой установке падал (`relation does not exist`), потому что `restore()` читает журнал до любой вставки.
`tenant_id`, `slug`, `performed_by → users`, **`affected JSONB`** (`{"repair_orders": 128}`), `purge_after`, `restored_at`, `purged_at`, `created_at`.

Нужен, чтобы повторное включение вернуло **ровно те** строки, которые скрыло отключение: сверка идёт по моменту из журнала, иначе включение «оживило» бы и записи, удалённые пользователем вручную задолго до этого. Окончательная очистка после `purge_after` пока не выполняется — воркера нет (`M0.14.5`).

### Блок 6 — Каналы связи

**`channel_accounts`** — подключённые аккаунты каналов (миграция `0012`).
`tenant_id`, `channel` (`CHECK` на пять значений), `label`, `external_id`, `status` (`pending|connected|error|disabled`), `status_message`, **`credentials JSONB`**, `last_sync_at`, `connected_at`, `created_at`, `updated_at`, `deleted_at`.

Одна таблица на все пять каналов, а не пять отдельных: набор полей совпадает, различается только способ авторизации, который лежит в `credentials`. Пять таблиц с одинаковой структурой означали бы пять почти идентичных сервисов.

Следствие общей таблицы: очистка данных при отключении модуля **обязана** фильтровать по `channel` (`ModuleDataService.channelFilter`) — иначе отключение Telegram скрыло бы и аккаунты WhatsApp.

`credentials` наружу не отдаётся: в выборках вместо колонки идёт признак `(credentials <> '{}') AS has_credentials`. Значения хранятся в открытом виде — шифрование требует управления ключом и остаётся открытой задачей (`M7.5.4`).

`idx_channel_accounts_unique_external` — частичный уникальный индекс по `(tenant_id, channel, external_id) WHERE deleted_at IS NULL`: повторная привязка того же аккаунта означала бы двойную доставку сообщений и двойной счёт, но удалённое подключение не должно мешать привязать его снова.

Миграция `0013` добавила `remote_user_id` (числовой id аккаунта на стороне канала — отличает переподключение того же аккаунта после смены username от нового) и `credentials_encrypted`.

**`credentials` шифруются** (AES-256-GCM, `services/credentials-cipher.ts`, конверт `v1:<iv>:<tag>:<ciphertext>`). Для Telegram там лежит MTProto-сессия, дающая полный доступ к аккаунту: чтение всех личных чатов и отправку от имени владельца. Открытое хранение раскрывалось бы дампом БД или резервной копией, и RLS от этого не защищает — она ограничивает запросы приложения, а не доступ к файлам.

**`telegram_auth_sessions`** — незавершённые подключения аккаунта Telegram (миграция `0013`).
`tenant_id`, `created_by → users`, `phone`, `label`, `phone_code_hash`, **`session_state`** (зашифровано), `requires_2fa`, `password_hint`, `attempts`, `consumed_at`, `expires_at`.

Нужна потому, что MTProto привязывает `phone_code_hash` к auth_key конкретного соединения: новый клиент с пустой сессией получил бы `PHONE_CODE_INVALID` на верный код. TTL 10 минут, лимит 5 попыток; после успеха `session_state` затирается. В отличие от `auth_sessions`, таблица под RLS — она читается уже аутентифицированным пользователем, и tenant-контекст на момент запроса всегда установлен.

---

## 3. Связи

```
tenants ─┬─< users ─┬─< deals.created_by
         │          ├─< crm_tasks.assignee_id
         │          ├─< invoices.created_by
         │          ├─< refresh_tokens.user_id
         │          └─< repair_notes.author_id / repair_photos.uploaded_by
         ├─< installed_modules
         ├─< refresh_tokens ──< refresh_tokens.replaced_by (самоссылка)
         ├─< contacts, companies
         ├─< pipelines ──< stages ──< deals ─┬─< deal_messages
         │                                   ├─< deal_stage_history
         │                                   └─< crm_tasks.deal_id
         ├─< repair_orders ─┬─< repair_works
         │                  ├─< repair_parts
         │                  ├─< repair_notes
         │                  └─< repair_photos
         ├─< device_models, repair_counters
         ├─< cash_accounts ──< transactions
         ├─< finance_categories ──< transactions
         ├─< invoices ──< invoice_items
         └─< tenant_audit_log
```

`transactions.deal_id`, `transactions.repair_order_id`, `transactions.invoice_id`, `invoices.repair_order_id`, `invoices.deal_id` — «мягкие» ссылки без FK-ограничения, чтобы удаление одной сущности не каскадило на финансовые записи.

`contacts.company_id` из этого списка выведён миграцией `0020`: он получил
`FOREIGN KEY ... ON DELETE SET NULL`. Без ограничения в колонке оставался
идентификатор удалённой компании, и карточка молча показывала пустую связь;
каскада финансовых записей здесь нет, поэтому причина держать ссылку «мягкой»
отсутствовала.

`otp_codes` стоит вне графа: у неё нет `tenant_id`, поскольку код запрашивается до аутентификации и пользователя определяет номер телефона.

---

## 4. JSONB-поля

| Таблица | Поле | Содержимое |
|---|---|---|
| `contacts` | `custom_fields` | произвольные поля арендатора |
| `companies` | `custom_fields` | произвольные поля арендатора |
| `deals` | `custom_fields` | произвольные поля арендатора |
| `repair_orders` | `diagnostics` | `performed_at`, `performed_by`, `findings`, `recommended_action`, `condition_notes` |
| `tenant_audit_log` | `details` | снимок изменения |

`PATCH` сливает `custom_fields` оператором `||`, чтобы частичный запрос не терял ключи. Полная замена — отдельный `PUT /:id/custom-fields`.

---

## 5. Индексы

**GIN по JSONB:**
`idx_contacts_custom_fields_gin`, `idx_companies_custom_fields_gin`, `idx_deals_custom_fields_gin`.

**GIN полнотекстовые** (`to_tsvector('simple', …)`):
`idx_contacts_search` (имя, фамилия, телефон, компания), `idx_companies_search` (название, ИНН, менеджер), `idx_deals_search` (заголовок, описание).

**По tenant_id:** `users`, `contacts`, `companies`, `deals`, `deal_messages`, `deal_stage_history`, `crm_tasks`, `repair_orders`, `repair_works`, `repair_parts`, `repair_notes`, `repair_photos`, `device_models`, `transactions`, `invoices`, `cash_accounts`, `tenant_audit_log`, `refresh_tokens`.

**Auth-таблицы:** `otp_codes (phone, created_at DESC)`, `otp_codes (expires_at)`, `refresh_tokens (user_id)`, `refresh_tokens (expires_at)`, `refresh_tokens.token_hash` (UNIQUE-ограничение).

**По внешним ключам:** `repair_works.repair_order_id`, `repair_parts.repair_order_id`, `repair_notes.repair_order_id`, `repair_photos.repair_order_id`, `deal_messages.deal_id`, `deals.stage_id`, `crm_tasks.assignee_id`, `invoice_items.invoice_id`, `transactions.deal_id`, `transactions.repair_order_id`, `transactions.invoice_id`, `invoices.repair_order_id`, `invoices.company_id`.

**Уникальные:** `idx_repair_orders_ticket_number (tenant_id, ticket_number)`, `idx_invoices_number_tenant (tenant_id, invoice_number)`.

---

## 6. Триггеры `updated_at`

Функция `set_updated_at()` и триггеры `trg_<table>_updated_at BEFORE UPDATE` на: `tenants`, `users`, `contacts`, `companies`, `deals`, `crm_tasks`, `repair_orders`, `cash_accounts`, `invoices`, `channel_accounts`, `telegram_auth_sessions`, `ai_agents`, `record_table_layouts`, `page_layout_tabs`.

Отдельно `trg_forbid_core_crm_uninstall BEFORE DELETE ON installed_modules` — запрет отключения базовой CRM на уровне БД (миграция `0010`, исправлена в `0011`: первая версия блокировала каскад от `DELETE FROM tenants`).

---

## 7. Row-Level Security

```sql
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID ...
-- читает GUC app.tenant_id, который db/client.ts выставляет на каждом
-- checkout соединения из пула (tenant берётся из проверенного токена)

CREATE OR REPLACE FUNCTION platform_scope() RETURNS BOOLEAN ...
-- читает GUC app.platform_scope; включается только гейтом
-- requirePlatformOwner после проверки users.platform_role
```

Политика `tenant_isolation` включена на таблицах чистой установки из цикла
плюс `invoice_items` с собственной политикой:
`contacts`, `companies`, `deals`, `deal_messages`, `deal_stage_history`, `crm_tasks`, `notes`, `record_table_layouts`, `page_layout_tabs`, `repair_orders`, `repair_works`, `repair_parts`, `repair_notes`, `repair_photos`, `device_models`, `cash_accounts`, `finance_categories`, `transactions`, `invoices`, `installed_modules`, `module_data_purges`, `channel_accounts`, `telegram_auth_sessions`, `ai_agents`, `ai_usage_log`, `ai_balance_topups`, `knowledge_base_documents`, `knowledge_base_chunks`, `ai_agent_channel_bindings`, `invoice_items`.

`module_data_purges` перенесена в `schema.sql` (2026-09-04): без неё
`POST /marketplace/modules/:slug/toggle` на чистой установке падал
`relation "module_data_purges" does not exist`.

Каждая новая таблица требует явного `GRANT ... TO app_user` в миграции: роль создана без прав по умолчанию, и без гранта первый же запрос отдаёт `permission denied for table`.

- `USING (tenant_id = current_tenant_id() OR platform_scope())` — чтение;
- `WITH CHECK (tenant_id = current_tenant_id())` — запись. `platform_scope()` здесь **отсутствует сознательно**: платформенной панели нужно читать по всем арендаторам, но не писать от их имени.

`invoice_items` — отдельная политика через `EXISTS` к родительскому `invoices`. У неё **обязателен явный `WITH CHECK`**: под `FORCE` политика без него использует для записи выражение `USING`, и вставка позиций отклонялась бы в той же транзакции, где создаётся сам счёт.

`otp_codes` и `refresh_tokens` **сознательно исключены**: обе читаются до появления tenant-контекста — код по номеру телефона анонимным вызовом, refresh-токен по хешу, чтобы только из него узнать арендатора. Политика `tenant_id = current_tenant_id()` сверялась бы с NULL GUC и заблокировала бы вход. Изоляция для них обеспечивается в SQL: выборка всегда идёт по телефону или хешу токена, а строки `refresh_tokens` дополнительно несут `tenant_id` и `user_id`. По той же причине вне политики остаются `users` (читается хуком `authenticate` до установки контекста) и платформенные справочники `tenants`, `marketplace_modules`.

RLS — второй барьер. Приложение всё равно обязано фильтровать по `tenant_id` явно.

### Условия, при которых RLS действительно работает

Требуются **оба** пункта; по отдельности каждый бесполезен (миграция `0002_rls_enforce.sql`):

1. **`FORCE ROW LEVEL SECURITY`** на таблице — без него владелец таблиц политики игнорирует.
2. **Подключение непривилегированной ролью `app_user`** (`NOSUPERUSER`, `NOBYPASSRLS`, только DML). Прежняя роль `getvoxly` в образе postgres — `SUPERUSER` с `rolbypassrls`, и её не останавливает даже `FORCE`. Владелец схемы остаётся только для миграций и `docker-entrypoint-initdb.d`.

`ALTER DEFAULT PRIVILEGES` выдаёт `app_user` права на таблицы будущих миграций — иначе новый `CREATE TABLE` молча ломал бы приложение отказом в доступе.

Проверено на живой БД ролью `app_user`: без контекста — 0 строк; в контексте арендатора видна только его запись; явный `WHERE tenant_id = <чужой>` возвращает 0; кросс-тенантная запись падает с `new row violates row-level security policy`; под `platform_scope=on` видны все арендаторы, но запись отклоняется.

---

## 8. Идемпотентность

Файл рассчитан на повторный прогон: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` перед `CREATE POLICY`, `INSERT … ON CONFLICT DO NOTHING`, `ALTER COLUMN … DROP NOT NULL`.

Расширение первичного ключа `repair_counters` обёрнуто в `DO`-блок с проверкой `pg_constraint`: пересоздание ключа выполняется только если он всё ещё состоит из двух колонок, поэтому повторный прогон — no-op.

Отдельного инструмента миграций пока нет (задача M6.2.7): версионной истории у схемы нет, а изменения уже применяются к существующим базам. Это следующий по приоритету пункт после верификации на живой БД.

> Изменения от 2026-08-18 проверены статически (баланс скобок, dollar-quoting, структура таблиц, идемпотентность). Прогон на живой PostgreSQL не выполнялся — требуется применить `schema.sql` на dev-БД и отдельно проверить блок расширения ключа `repair_counters` на инсталляции с данными.
