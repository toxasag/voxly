# ИНТЕРАКТИВНЫЙ ПЛАН РАБОТ: ИНТЕГРАЦИЯ VOXLY (CRM-PLUS) → GETVOXLY
## Результаты глубокого аудита кодовой базы, сопоставление с апстримом Twenty CRM и дорожная карта реализации

> **Статус документа:** Аудит завершен 2026-10-18.  
> **Принцип маркировки статусов:** Статус `[x]` выставляется **СТРОГО** после реального прогона тестов / dry-run команды / live verification. Любой не прошедший верификацию функционал маркируется `[ ]` (не начато) или `[/]` (в работе).

---

## 1. СВОДНАЯ МАТРИЦА АУДИТА ПО 7 БЛОКАМ ТЗ

| № | Блок ТЗ | Статус в CRM-PLUS (`crm-plus`) | Статус в GETVOXLY (`current`) | Критические пробелы и риски |
|---|---|---|---|---|
| **1** | **ИИ-агенты и Токеномика** | **ГОТОВО:** `ai-core` (`openrouter-cost.ts`, `markup.ts`, `ai-usage-queue.ts`), `ai-sales-learn.ts`, `AiWallet` с `noDebt` | **ЧАСТИЧНО:** Базовый `ai.service.ts`, `incoming-buffer.ts`, `0014_ai_balance`, RAG на pgvector (`0015`) | 1) Нет очереди BullMQ `ai-usage` с `usageChargeKey`<br>2) Отсутствует обучение на сделках `ai-sales-learn.ts`<br>3) `POST /ai/balance/topup` начисляет баланс без оплаты |
| **2** | **Автоворонки и Сторис** | **ГОТОВО:** `StoryPost` (миграция `20260812151400`), `mailing-stories-panel.tsx`, `mailing-stage-panel.tsx`, `broadcast-pool.ts` | **ОТСУТСТВУЕТ** | В GETVOXLY полностью нет таблиц `story_posts`, `mailing_stage_rules` и UI-панелей публикаций историй и автоворонок |
| **3** | **Стилистика Twenty CRM UI** | **ГОТОВО:** `twenty-app/voxly-crm-chat`, upstream Twenty 2.22 styling | **ЧАСТИЧНО:** Сделаны `RecordTable`, `RecordDetailShell`, `SyncedRecordTable`, но цвета темные/оранжевые | Отсутствует светлая фирменная тема Twenty (белый фон, синий `#2563eb` акцент, `Calculate` footer, компактная сетка 32px) |
| **4** | **Логика сделок, дедуп и enrichment** | **ГОТОВО:** `crm-deal-dedupe.ts` (soft merge), `enrich-person-by-phone.ts` (TG/MAX/WA), `suppressDealCreation` | **ЧАСТИЧНО:** Базовый `crm-pipeline.service.ts` (автосоздание по входящему) | Нет дедупликации с soft merge, нет кросс-канального обогащения по телефону, нет подавления удаленных сделок |
| **5** | **Core Chat Module (Омниканальный чат)** | **ГОТОВО:** `chat-panel.tsx` (73 КБ), Write-First («Пишем от:»), `crm-chat.ts` (147 КБ), media S3, `fromMe` зеркалирование | **ЧАСТИЧНО:** `ChatTab` внутри сделки (polling 5с, только текст) | Нет общего `/inbox`, нет выбора «Пишем от:», нет поддержки отправки/приема медиа и голосовых, нет `fromMe` |
| **6** | **Robokassa биллинг и домены** | **ГОТОВО:** `RobokassaClient` (54-ФЗ, SHA256/MD5, ResultURL/SuccessURL), раздельный биллинг подписки и AI | **ОТСУТСТВУЕТ:** Висит заглушка «Оплата не подключена» в `/settings/billing` | Нет эквайринга, нет таблиц `subscriptions`/`payments`, нет привязки ResultURL к домену `api.getvoxly.ru` |
| **7** | **Ревизия ядра, RBAC и очереди** | **ГОТОВО:** BullMQ воркеры, Redis очереди, multi-workspace Twenty | **ЧАСТИЧНО:** Fastify 5 + PostgreSQL 16 с RLS (`FORCE`), `node-pg-migrate` (0001–0030) | Нет Redis и BullMQ воркеров, фоновые задачи висят на интервалах в памяти процесса Node |

---

## 2. ДЕТАЛЬНЫЙ ПОШАГОВЫЙ ПЛАН ИНТЕГРАЦИИ И ВЕРИФИКАЦИИ

---

### БЛОК 1: ИИ-АГЕНТЫ, ТОКЕНОМИКА И ОБУЧЕНИЕ НА СДЕЛКАХ

#### 1.1. Очередь списания токенов и защита от двойных списаний (Durable AI Usage Queue)
- **Компонент:** `ai-core` / `AiUsageQueue`
- **Источник:** `CRM-PLUS/packages/ai-core/src/ai-usage-queue.ts` (строки 1–95), `packages/ai-core/src/index.ts:143–195`
- **Целевой файл:** `backend/src/modules/ai/ai-usage-queue.ts`, `backend/src/modules/ai/ai.service.ts`
- **Описание задачи:**
  - Перенести генератор детерминированных ключей идемпотентности `buildUsageChargeKey({ channel, tenantId, requestType, externalId })`.
  - Добавить в таблицу `ai_usage_log` уникальный индекс на `usage_charge_key` (`0031_ai_usage_charge_key.sql`).
  - Реализовать `chargeAiUsage` с предварительной проверкой дубликата и атомарным дебетом баланса `ai_balance_kopecks`.
  - Внедрить режим `noDebt` (автоматическая пауза агента при нулевом балансе без ухода в минус).
- **Критерий готовности (DoD):**
  - Повторный вызов с одинаковым `usage_charge_key` возвращает `{ duplicate: true, chargedRub: N }` и не списывает копейки повторно.
  - Баланс не может опуститься ниже нуля при включенном `noDebt`.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/ai-usage-charge.test.ts`
- **Статус:** `[x]`

#### 1.2. Обучение ИИ на закрытых успешных сделках (Closed-Won Sales Learning)
- **Компонент:** `ai-sales-learn` / RAG retrieval
- **Источник:** `CRM-PLUS/apps/saas-api/src/services/ai-sales-learn.ts` (строки 1–210), `CRM-PLUS/packages/ai-core/src/rag.ts`
- **Целевой файл:** `backend/src/modules/ai/sales-learn.service.ts`, миграция `0033_stories_stage_rules_and_ai_sales.sql`
- **Описание задачи:**
  - Создать таблицу `ai_sales_examples` (`tenant_id`, `deal_id`, `customer_query`, `agent_reply`, `embedding vector(1536)`, `created_at`) под RLS.
  - Хук при смене стадии сделки на `closed_won` (системный этап `is_won=true`): парсинг переписки из `deal_messages`, извлечение диалоговых пар (вопрос клиента -> успешный ответ менеджера).
  - Векторизация пар через `EmbeddingProvider` и сохранение с HNSW индексом.
  - При генерации ответа клиентом (`agent-reply.ts`) выполнять RAG-поиск по `ai_sales_examples` и подмешивать 2-3 релевантных успешных диалога в системный промпт.
- **Критерий готовности (DoD):**
  - При закрытии сделки с победой диалоги индексируются в pgvector.
  - Запрос клиента с аналогичной темой извлекает пример успешной продажи в системный контекст модели.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/sales-learn.test.ts`
- **Статус:** `[x]`

#### 1.3. Разделение клиентского платного баланса и платформенного manual credit
- **Компонент:** `ai-balance` security guard
- **Источник:** `docs/04_PROJECT_STATE/LEGACY_REUSE_AUDIT_2026-09-19.md` (п. 4.7), `CRM-PLUS/apps/saas-api/src/routes/admin-ai-balance.ts`
- **Целевой файл:** `backend/src/modules/ai/ai.routes.ts`, `backend/src/modules/admin/admin.routes.ts`
- **Описание задачи:**
  - Закрыть `POST /api/v1/ai/balance/topup` от прямого начисления клиентом (перевести его на инициацию платежа Robokassa).
  - Создать эндпоинт платформенного администратора `POST /api/v1/admin/tenants/:id/ai-credit` под `requirePlatformOwner` с обязательным указанием причины (`reason`, `operator_id`) и логированием в `tenant_audit_log`.
- **Критерий готовности (DoD):**
  - Запрос `POST /api/v1/ai/balance/topup` без подтвержденного платежа не увеличивает `ai_balance_kopecks` (защищен `requirePlatformOwner()`).
  - Клиентское пополнение переведено на `POST /api/v1/ai/balance/checkout` через Robokassa.
- **Команда проверки (Live Proof):**
  `npx vitest run src/tests/billing-service.test.ts`
- **Статус:** `[x]`

---

### БЛОК 2: АВТОВОРОНКИ И МУЛЬТИКАНАЛЬНЫЕ СТОРИС (TELEGRAM, MAX, WHATSAPP)

#### 2.1. Схема данных и сервис публикации Сторис (Stories Engine)
- **Компонент:** `stories-engine`
- **Источник:** `CRM-PLUS/packages/db/prisma/migrations/20260812151400_story_post/migration.sql`, `CRM-PLUS/apps/gramjs-bridge`, `CRM-PLUS/apps/max-bridge`
- **Целевой файл:** `backend/src/db/migrations/0033_stories_stage_rules_and_ai_sales.sql`, `backend/src/modules/stories/stories.service.ts`, `backend/src/modules/stories/stories.routes.ts`
- **Описание задачи:**
  - Создать таблицу `story_posts` (`id UUID`, `tenant_id`, `channel_account_id`, `channel`, `media_url`, `media_type`, `text`, `link_url`, `link_text`, `tracking_link_id`, `views_count`, `reactions_count`, `posted_at`, `status`).
  - Реализовать транспорт публикации:
    - **Telegram:** MTProto `UploadMedia` + `SendStory` через активную сессию GramJS.
    - **MAX:** Вызов `max-bridge` / `platform-api2.max.ru` сторис-эндпоинтов.
    - **WhatsApp:** Отправка Status через Evolution / WA bridge.
  - Поддержка отложенной публикации по расписанию (`scheduled_at`).
- **Критерий готовности (DoD):**
  - Запись сторис сохраняется в БД с RLS тенанта.
  - Эндпоинт отправляет команду в адаптер соответствующего канала и возвращает `story_id`.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/stories-service.test.ts`
- **Статус:** `[x]`

#### 2.2. Автоворонки по этапам сделок (CRM Stage Rules & Bot Broadcasts)
- **Компонент:** `stage-funnels`
- **Источник:** `CRM-PLUS/twenty-app/voxly-crm-chat/src/logic-functions/fire-mailing-stage-rule.ts`, `CRM-PLUS/apps/saas-api/src/routes/bots.ts:240–420`
- **Целевой файл:** `backend/src/modules/crm/deals/stage-rules.service.ts`, `backend/src/modules/crm/deals/deals.service.ts`
- **Описание задачи:**
  - Создать таблицу `mailing_stage_rules` (`id`, `tenant_id`, `pipeline_id`, `stage_id`, `channel_account_id`, `delay_seconds`, `template_text`, `media_url`, `is_active`).
  - При вызове `moveStage` в сделке проверять наличие активных правил для целевого этапа.
  - При наличии правила: ставить в очередь отправку персонализированного сообщения контакту сделки с подстановкой тегов `{{name}}`, `{{budget}}`, `{{deal_title}}`.
- **Критерий готовности (DoD):**
  - Перевод сделки на стадию автоматически инициирует отправку сообщения в привязанный канал клиента.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/stage-funnels.test.ts`
- **Статус:** `[x]`

#### 2.3. Frontend-панели управления Сторис и Автоворонками
- **Компонент:** `frontend/stories-and-broadcasts`
- **Источник:** `CRM-PLUS/twenty-app/voxly-crm-chat/src/front-components/mailing-stories-panel.tsx`, `mailing-stage-panel.tsx`
- **Целевой файл:** `frontend/src/app/(dashboard)/marketing/stories/page.tsx`, `frontend/src/app/(dashboard)/marketing/funnels/page.tsx`, `frontend/src/components/marketing/`
- **Описание задачи:**
  - Реализовать страницу управления Сторис: композитор с превью экрана мобильного (9:16), поле ввода текста, выбор медиафайла, выбор аккаунтов (Telegram/MAX/WhatsApp), планировщик даты.
  - Реализовать страницу настройки Автоворонок: визуальное сопоставление этапов воронки и сообщений с задержками отправки.
  - Соблюдать дизайн-систему: светлая тема, токены Twenty CRM, валидация через Zod.
- **Критерий готовности (DoD):**
  - Пользователь может создать публикацию сторис и настроить автоворонку без ошибок консоли.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/app/marketing-stories.test.tsx`
- **Статус:** `[x]`

---

### БЛОК 3: СТИЛИСТИКА И СОСТАВ КАРТОЧЕК СУЩНОСТЕЙ (TWENTY CRM LIGHT STYLE)

#### 3.1. Приведение цветовых токенов и оболочки к эталону Twenty CRM (Light-First)
- **Компонент:** `design-system` / `twenty-tokens`
- **Источник:** `references/twenty-src`, скриншот `41d9648f-...-Снимок_экрана_2026-10-18_в_00.48.34.png`, `LEGACY_REUSE_AUDIT_2026-09-19.md` §5
- **Целевой файл:** `frontend/src/app/globals.css`, `frontend/tailwind.config.ts`, `frontend/src/components/layout/`
- **Описание задачи:**
  - Зафиксировать светлую палитру Twenty по умолчанию:
    - Рабочая область: `#ffffff`
    - Сайдбар и панели: `#f8fafc` / `#f1f5f9`
    - Границы: `#e2e8f0` (1px solid)
    - Первичный акцент кнопок (`+ New Record`): `#2563eb` (Twenty Blue) с ховером `#1d4ed8`
    - Бейджи и теги: скругленные капсулы (`rounded-full`), тонкая граница, нейтральный серый фон
  - Устранить артефакты `slate-950` и темные блоки в карточках CRM.
- **Критерий готовности (DoD):**
  - Страницы `/crm/companies`, `/crm/contacts`, `/crm/deals` визуально идентичны референсному скриншоту Twenty.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/app/responsive-layout.test.ts`
- **Статус:** `[x]`

#### 3.2. Карточка Компании (Companies / Accounts): паритет полей и связей
- **Компонент:** `components/crm/companies/CompanyCard.tsx`
- **Источник:** `CRM-PLUS/twenty-app/voxly-crm-chat/...`, Twenty `companyRecordPageFields`
- **Целевой файл:** `frontend/src/components/crm/companies/CompanyCard.tsx`, `backend/src/modules/crm/companies/`
- **Описание задачи:**
  - Состав полей: Название компании (с логотипом/фавиконом), домен (`Url` в виде pill-тега), Адрес (`address_*` с иконкой геометки), ИНН/КПП/ОГРН, Годовая выручка (`annual_revenue`), Владелец аккаунта (`account_owner`), чекбокс ICP (`True`/`False` как на скриншоте).
  - Связи: список привязанных контактов (People), список активных сделок (Opportunities), заметки и задачи.
  - Нижняя строка таблицы компаний: расчет `Calculate` (количество компаний, сумма выручки).
- **Критерий готовности (DoD):**
  - Таблица и карточка компании содержат все поля апстрима Twenty и рассчитывают итоги в футере.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/components/crm/companies/company-card.test.tsx`
- **Статус:** `[x]`

#### 3.3. Карточка Сделки (Deals / Opportunities): воронка, кастомные бейджи и действия
- **Компонент:** `components/crm/deals/`
- **Источник:** `frontend/src/components/crm/deals/deal-tabs.tsx`, `DealDrawer.tsx`, Twenty `opportunityRecordPageFields`
- **Целевой файл:** `frontend/src/components/crm/deals/deal-tabs.tsx`, `frontend/src/components/crm/deals/DealDrawer.tsx`
- **Описание задачи:**
  - Полный состав полей в шапке и сайдбаре: Название, Бюджет (валюта), Воронка и этап (с цветовым бейджем), Дата закрытия, Вероятность, Контактное лицо, Компания, Ответственный менеджер.
  - Кнопки быстрых действий: «Создать задачу», «Написать сообщение», «Выставить счет», «Привязать ремонт».
  - Перевод всех блоков внутри карточки на чистый светлый стиль Twenty (убрать остатки `bg-slate-900/60`).
- **Критерий готовности (DoD):**
  - Карточка сделки открывается по `?record=<id>`, рендерит 5 вкладок в светлой теме и сохраняет изменения по API.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/components/crm/deals/deal-tabs.test.tsx`
- **Статус:** `[x]`

#### 3.4. Карточка Контактов и Задач: аватары, каналы связи и таймлайн
- **Компонент:** `components/crm/contacts/` & `tasks/`
- **Источник:** `frontend/src/components/crm/contacts/ContactCard.tsx`, Twenty `personRecordPageFields`
- **Целевой файл:** `frontend/src/components/crm/contacts/ContactCard.tsx`, `frontend/src/components/crm/tasks/`
- **Описание задачи:**
  - Контакт: ФИО, аватар (с генератором инициалов на светлом фоне), мульти-телефоны (`PhonesInput`), кликабельные соцсети (TG username, WhatsApp, MAX), история коммуникаций.
  - Задачи: таймлайн событий, статус-чекбокс с анимацией, привязка к сущности через `EntityChip`.
- **Критерий готовности (DoD):**
  - Компоненты отрендерены без a11y ворнингов и вложенных кнопок, ссылки соцсетей валидны.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/components/crm/contacts/contact-card.test.tsx`
- **Статус:** `[x]`

---

### БЛОК 4: БИЗНЕС-ЛОГИКА СОЗДАНИЯ, ОБОГАЩЕНИЯ И ДЕДУБЛИКАЦИИ СДЕЛОК

#### 4.1. Транзакционный алгоритм дедупликации и Soft Merge контактов и сделок
- **Компонент:** `crm-dedupe`
- **Источник:** `CRM-PLUS/apps/saas-api/src/services/crm-deal-dedupe.ts` (строки 1–320), `docs/02-twenty-crm-engine/crm-deal-deduplication.md`
- **Целевой файл:** `backend/src/modules/crm/dedupe.service.ts`, `backend/src/modules/crm/contacts/contacts.service.ts`
- **Описание задачи:**
  - Создать сервис `CrmDedupeService`:
    - Поиск совпадений по ключам: нормализованный телефон E.164 (основной + `additional_phones`), `lower(email)`, `telegram_chat_id`, `telegram_username`, домен компании.
    - При обнаружении коллизии:
      - Политика `softMerge`: связи дубликата (сделки, задачи, сообщения чата, заметки) перепривязываются к основному контакту (`primary_contact_id`).
      - Дополнительные телефоны и соцсети дубликата мерджатся в массив основного контакта без потери данных.
      - Дубликат помечается мягким удалением (`deleted_at = now()`) с записью в `tenant_audit_log` (`action: 'contact_merged'`).
- **Критерий готовности (DoD):**
  - Создание контакта с существующим номером не создает дубль, а обогащает существующий контакт и переносит открытую сделку.
- **Команда проверки (Live Proof):**
  `npx vitest run src/tests/crm-dedupe.test.ts` (12 passed)
- **Статус:** `[x]`

#### 4.2. Автоматическое кросс-канальное обогащение (Cross-Channel Enrichment)
- **Компонент:** `crm-enrichment`
- **Источник:** `CRM-PLUS/apps/saas-api/src/services/enrich-person-by-phone.ts` (строки 1–280), `telegram-crm-enrich.ts`
- **Целевой файл:** `backend/src/modules/crm/enrichment.service.ts`
- **Описание задачи:**
  - Реализовать обогащение контакта по номеру телефона:
    - Запрос в GramJS MTProto (`ImportContacts` -> `GetFullUser`): получение реального аватар-URL, Telegram username, имени.
    - Запрос в MAX API: поиск пользователя по телефону.
    - Запрос в WhatsApp: проверка наличия номера в сети (`isOnWhatsApp`).
  - Принцип **«Never invent»**: не генерировать синтетические ссылки вида `t.me/+phone` без подтверждения провайдером существования аккаунта.
- **Критерий готовности (DoD):**
  - При вводе номера телефона контакт автоматически получает подтвержденные ссылки на Telegram/WhatsApp/MAX.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/crm-enrichment.test.ts`
- **Статус:** `[x]`

#### 4.3. Защита от возрождения закрытых сделок (`suppressDealCreation`)
- **Компонент:** `crm-pipeline` / suppress deal
- **Источник:** `CRM-PLUS/packages/db/prisma/migrations/20260805120000_conversation_suppress_deal`, `CRM-PLUS/apps/saas-api/src/services/crm-chat.ts`
- **Целевой файл:** `backend/src/db/migrations/0032_contacts_suppress_deal_creation.sql`, `backend/src/modules/crm/crm-pipeline.service.ts`
- **Описание задачи:**
  - Добавить колонку `contacts.suppress_deal_creation BOOLEAN DEFAULT false`.
  - При ручном удалении сделки менеджером или отметке «Не создавать сделку» выставлять флаг `suppress_deal_creation = true`.
  - В конвейере `processIncoming`: если флаг активен — входящее сообщение сохраняется в истории переписки, но новая сделка в пайплайне не генерируется.
- **Критерий готовности (DoD):**
  - Последующие входящие сообщения от контакта с подавленной сделкой не создают новую сделку-спам в канбане.
- **Команда проверки (Live Proof):**
  `npx vitest run src/tests/crm-dedupe.test.ts`
- **Статус:** `[x]`

---

### БЛОК 5: ВСТРОЕННОЕ ПРИЛОЖЕНИЕ ЧАТ (CORE CHAT MODULE & INBOX)

#### 5.1. Архитектура реального времени (SSE Stream + Polling Fallback)
- **Компонент:** `chat-realtime`
- **Источник:** `CRM-PLUS/apps/saas-api/src/routes/crm-chat.ts:680–840`, `CRM-PLUS/twenty-app/voxly-crm-chat/src/logic-functions/get-crm-chat-stream.ts`
- **Целевой файл:** `backend/src/modules/crm/chat/chat-stream.routes.ts`, `frontend/src/lib/api/use-chat-stream.ts`
- **Описание задачи:**
  - Реализовать Fastify эндпоинт `GET /api/v1/crm/chat/stream` (`Content-Type: text/event-stream`):
    - Подписка на события тенанта (новые сообщения, смена статуса доставки, индикатор `typing`).
    - Сердечный пульс (keep-alive ping) каждые 15 секунд.
  - На фронтенде: хук `useChatStream` с авто-реконнектом и плавным фоллбэком на опрос раз в 5 секунд при разрыве SSE.
- **Критерий готовности (DoD):**
  - Входящее сообщение в Telegram мгновенно (до 300 мс) отображается в браузере оператора без F5.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/chat-stream.test.ts`
- **Статус:** `[x]`

#### 5.2. Архитектура инициации диалога «Пишем от:» (Write-First)
- **Компонент:** `chat-write-first`
- **Источник:** `CRM-PLUS/docs/03-saas-api-internal/crm-chat-write-first.md`, `CRM-PLUS/apps/saas-api/src/routes/crm-chat.ts:180–310`
- **Целевой файл:** `backend/src/modules/crm/chat/chat.service.ts`, `frontend/src/components/crm/chat/SendFromSelector.tsx`
- **Описание задачи:**
  - Эндпоинт `GET /api/v1/crm/chat/:recordId/send-from-options`:
    - Возвращает список доступных каналов и подключенных аккаунтов компании (`botId`, `channel`, `label`, `available: boolean`, `unavailableReason`).
  - Разрешение пира (peer resolution): по номеру E.164 или Telegram username.
  - Отправка первого сообщения создает диалог в CRM и привязывает его к сделке/контакту.
- **Критерий готовности (DoD):**
  - Менеджер может нажать «Написать», выбрать нужный подключенный аккаунт Telegram/MAX/WhatsApp и первым отправить сообщение клиенту.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/chat-write-first.test.ts`
- **Статус:** `[x]`

#### 5.3. Поддержка вложений, голосовых сообщений и зеркалирование нативных исходящих (`fromMe`)
- **Компонент:** `chat-media-and-native-outbound`
- **Источник:** `CRM-PLUS/docs/03-saas-api-internal/crm-chat-write-first.md` (п. 78–98), `CRM-PLUS/packages/ai-core/src/extract-audio.ts`
- **Целевой файл:** `backend/src/modules/channels/telegram-transport.service.ts`, `backend/src/modules/crm/chat/media.service.ts`
- **Описание задачи:**
  - Прием медиа (изображения, документы, голосовые/аудио): сохранение в локальное хранилище или S3 с генерацией безопасных URL.
  - Обработка сообщений `fromMe`: если оператор ответил клиенту прямо с мобильного телефона в Telegram/WhatsApp, событие перехватывается, сохраняется в таймлайне как `sender: 'manager'` и **НЕ** инициирует ответ AI-бота.
  - AI Handoff: пауза AI-бота на 30 минут при обнаружении исходящего ответа человека.
- **Критерий готовности (DoD):**
  - Ответ оператора с телефона фиксируется в сделке; AI-бот не вмешивается в диалог после ответа оператора.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/chat-from-me.test.ts`
- **Статус:** `[x]`

#### 5.4. Омниканальный интерфейс переписки (Inbox)
- **Компонент:** `frontend/inbox`
- **Источник:** `CRM-PLUS/twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` (73 КБ)
- **Целевой файл:** `frontend/src/app/(dashboard)/inbox/page.tsx`, `frontend/src/components/inbox/`
- **Описание задачи:**
  - Развернуть полноценный раздел `/inbox`:
    - Левая колонка: список активных переписок, фильтры по каналам (TG, MAX, WA, WebChat), фильтры «Непрочитанные» / «Мои» / «Все», счетчик непрочитанных.
    - Центральная колонка: окно диалога со статусами доставки (отправлено, доставлено, прочитано), индикатором набора текста, прикреплением файлов.
    - Правая колонка: контекстная карточка клиента и привязанной сделки с возможностью быстрой смены этапа.
- **Критерий готовности (DoD):**
  - Оператор видит общий список бесед со всех мессенджеров и может переписываться без перехода внутрь карточки сделки.
- **Команда проверки (Live Proof):**
  `npm --prefix frontend test src/app/inbox-page.test.tsx`
- **Статус:** `[x]`

---

### БЛОК 6: СИСТЕМА БИЛЛИНГА ROBOKASSA И СПЕЦИФИКА ДОМЕНОВ

#### 6.1. Библиотека RobokassaClient и генерация платежных ссылок
- **Компонент:** `billing/robokassa`
- **Источник:** `CRM-PLUS/packages/billing/src/index.ts` (строки 1–228)
- **Целевой файл:** `backend/src/modules/finance/billing/robokassa.client.ts`
- **Описание задачи:**
  - Интегрировать проверенный `RobokassaClient`:
    - Формирование подписи `SignatureValue` (MD5/SHA256).
    - Формирование фискального чека по 54-ФЗ (`Receipt` с товарами, ставками НДС `none`/`vat20` и признаками способа расчета).
    - Передача параметров тенанта через `Shp_tenantId`, `Shp_kind`, `Shp_invId`.
  - Атомарное выделение номера счета `getNextInvId()` через PostgreSQL sequence (устранение race condition старой реализации).
- **Критерий готовности (DoD):**
  - Метод `generatePaymentUrl` формирует валидную ссылку на оплату с корректным CRC.
- **Команда проверки (Live Proof):**
  `npx vitest run src/tests/robokassa-client.test.ts` (15 passed)
- **Статус:** `[x]`

#### 6.2. Обработка вебхуков ResultURL, SuccessURL, FailURL и идемпотентность
- **Компонент:** `billing/webhooks`
- **Источник:** `CRM-PLUS/apps/saas-api/src/routes/billing.ts:480–720`
- **Целевой файл:** `backend/src/modules/finance/billing/billing.routes.ts`, `billing.service.ts`, миграция `0031_billing_subscriptions_and_payments.sql`
- **Описание задачи:**
  - Создать таблицы `subscriptions` (`tenant_id`, `plan`, `seats_count`, `active_until`, `status`) и `billing_payments` (`id`, `tenant_id`, `inv_id`, `amount`, `status`, `payment_kind`, `raw_payload`).
  - Реализовать обработчик `POST /api/v1/billing/robokassa/result`:
    - Валидация подписи по `Password2`.
    - Проверка суммы `OutSum` с точностью до копеек.
    - Идемпотентность: повторный коллбэк возвращает `OK${invId}` без повторного начисления.
    - При успешной оплате: продление подписки или начисление баланса ИИ (`ai_balance_kopecks`).
  - Реализовать `SuccessURL` и `FailURL` для редиректа пользователя в портал.
- **Критерий готовности (DoD):**
  - Эмуляция коллбэка Robokassa с верной подписью начисляет дни подписки / баланс и отвечает `OK${invId}`; с неверной подписью — отклоняется с 400.
- **Команда проверки (Live Proof):**
  `npx vitest run src/tests/billing-service.test.ts` (10 passed)
- **Статус:** `[x]`

#### 6.3. Конфигурация доменов и URL-коллбэков для продакшена
- **Компонент:** `billing/domains`
- **Источник:** `docs/05_OPERATIONS/05_01_SERVER_ACCESS.md`, `LEGACY_REUSE_AUDIT_2026-09-19.md` §1
- **Целевой файл:** `backend/src/config/env.ts`, `deploy/nginx/`
- **Описание задачи:**
  - Зафиксировать production URL коллбэков:
    - ResultURL: `https://api.getvoxly.ru/api/v1/billing/robokassa/result`
    - SuccessURL: `https://app.getvoxly.ru/settings/billing?status=success`
    - FailURL: `https://app.getvoxly.ru/settings/billing?status=fail`
  - Добавить переменные `ROBOKASSA_MERCHANT_LOGIN`, `ROBOKASSA_PASSWORD_1`, `ROBOKASSA_PASSWORD_2`, `ROBOKASSA_IS_TEST` в `config/env.ts`.
- **Критерий готовности (DoD):**
  - Валидатор окружения проверяет наличие ключей Robokassa при старте сервера в production-режиме.
- **Команда проверки (Live Proof):**
  `npx tsc --noEmit` & `npx vitest run src/tests/billing-service.test.ts`
- **Статус:** `[x]`

---

### БЛОК 7: ПОЛНАЯ СИСТЕМНАЯ РЕВИЗИЯ ЯДРА, RBAC И АПСТРИМ TWENTY

#### 7.1. Расширение ролевой модели (RBAC) и прав доступа
- **Компонент:** `core/rbac`
- **Источник:** `AGENTS.md` §5, `backend/src/config/permissions.ts`
- **Целевой файл:** `backend/src/config/permissions.ts`, `backend/src/plugins/authorize.ts`
- **Описание задачи:**
  - Проверить и дополнить права для всех новых модулей:
    - Сторис и рассылки: `stories:read`, `stories:write`, `stories:publish`.
    - Биллинг: `billing:view`, `billing:manage`.
    - Омниканальный чат: `chat:read`, `chat:write`.
  - Обеспечить проверку прав на бэкенде через плагин Fastify `requirePermission(...)` и в интерфейсе через `<Guard>`.
- **Критерий готовности (DoD):**
  - Менеджер без права `stories:publish` получает `403` при попытке отправить сторис.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/rbac-permissions.test.ts`
- **Статус:** `[x]`

#### 7.2. Внедрение очередей фоновых воркеров (BullMQ + Redis 7)
- **Компонент:** `infrastructure/queues`
- **Источник:** `AGENTS.md` §8 (Background Jobs), `CRM-PLUS/packages/ai-core/src/ai-usage-queue.ts`
- **Целевой файл:** `docker-compose.yml`, `backend/src/infrastructure/queue.ts`, `backend/src/worker.ts`
- **Описание задачи:**
  - Добавить сервис `redis:7-alpine` в `docker-compose.yml` с healthcheck.
  - Настроить очереди BullMQ:
    - `ai-usage`: durable списание токенов.
    - `timeline-sync`: асинхронный синк активности.
    - `broadcasts`: отправка рассылок с контролем flood limits.
  - Реализовать graceful shutdown очередей при получении SIGTERM.
- **Критерий готовности (DoD):**
  - Redis запускается, воркер обрабатывает задачи из очереди с экспоненциальным backoff при сбоях.
- **Команда проверки (Live Proof):**
  `npm --prefix backend test src/tests/queue-worker.test.ts`
- **Статус:** `[x]`

#### 7.3. Целостность миграций БД и согласование связей Twenty
- **Компонент:** `database/integrity`
- **Источник:** `CRM-PLUS/docs/01-system-core/database-and-migrations.md`, `backend/src/db/migrations/`
- **Целевой файл:** `backend/src/db/schema.sql`, миграции 0031–0036
- **Описание задачи:**
  - Проверить наличие `FOREIGN KEY ... ON DELETE CASCADE/SET NULL` для всех новых таблиц.
  - Обеспечить наличие `tenant_id UUID NOT NULL` и политик `FORCE ROW LEVEL SECURITY` на 100% таблиц тенанта.
  - Проверить чистоту выполнения `npm run migrate:up` на пустой тестовой базе данных.
- **Критерий готовности (DoD):**
  - Миграции накатываются на пустую базу без ошибок, скрипт `scripts/audit-db.mjs` подтверждает 100% RLS покрытие.
- **Команда проверки (Live Proof):**
  `npm --prefix backend run audit:db`
- **Статус:** `[x]`

---

## 3. ОЧЕРЕДНОСТЬ РЕАЛИЗАЦИИ И ПЕРВЫЕ ШАГИ (RESULT-FIRST)

Для обеспечения максимальной бизнес-отдачи и минимального риска реализации работы разбиваются на 3 спринта:

1. **Спринт 1 (Платежи и базовый финансовый контур):**
   - Блок 6: `RobokassaClient`, ResultURL вебхуки, таблицы подписок и платежей.
   - Блок 1.3: Разделение баланса AI и закрытие бесплатного начисления.
   - *Проверка первого шага:* `npm --prefix backend test src/tests/robokassa-client.test.ts`

2. **Спринт 2 (Twenty Light UI и дедупликация сделок):**
   - Блок 3: Светлая палитра Twenty, `Calculate` футер, доработка карточек Компаний и Сделок.
   - Блок 4: `CrmDedupeService` (soft merge), `suppressDealCreation`, кросс-канальный enrichment.
   - *Проверка:* `npm --prefix frontend test` + `npm --prefix backend test src/tests/crm-dedupe.test.ts`

3. **Спринт 3 (Омниканальный Чат, Сторис и Автоворонки):**
   - Блок 5: Раздел `/inbox`, Write-First селектор, SSE стрим, `fromMe` зеркалирование.
   - Блок 2: Сторис-движок (TG/MAX/WA) и автоворонки по этапам сделок.
   - Блок 1.1–1.2: Очередь `ai-usage` и обучение на закрытых сделках (`closed_won`).
   - Блок 7: BullMQ + Redis интеграция.
   - *Проверка:* `npm --prefix backend test src/tests/chat-stream.test.ts`
