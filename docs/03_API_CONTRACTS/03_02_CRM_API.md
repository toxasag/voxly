# 03_02 — API ядра CRM

> Источник: `backend/src/modules/crm/`.
> Базовый путь: `/api/v1/crm`.

---

## 1. Общие правила

**Аутентификация.** Обязателен заголовок `Authorization: Bearer <jwt>`. `tenant_id` берётся из токена; передавать его в теле или query запрещено.

**Frontend Sprint 13.** Компании, сделки и задачи теперь используют TanStack Query v5 и реальные API paths. Компании читают `CompanyDTO` напрямую; сделки получают pipeline catalog через `GET /deals/pipelines`, затем Kanban через `GET /deals/kanban`, а timeline через `GET/POST /deals/:id/messages`; задачи используют server-side filters `today`, `overdue`, `my` и `PATCH /tasks/:id/status`. Backend DTO задач пока содержит только `assigneeId` без имени исполнителя, а users catalog endpoint отсутствует — UI показывает сокращённый UUID вместо выдуманного имени.

**Конверты.**

```json
{ "data": … , "meta": { "limit": 25, "offset": 0, "total": 132 } }
{ "error": { "code": "NOT_FOUND", "message": "Contact not found" } }
```

**Пагинация.** `limit` — 1…100, по умолчанию 25. `offset` — от 0, по умолчанию 0. `meta.total` — общее число записей без учёта страницы.

**Именование.** Запросы принимают `snake_case`, ответы отдают `camelCase`.

**Удаление** мягкое: ставится `deleted_at`, все чтения фильтруют `deleted_at IS NULL`.

**Коды ошибок:** `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `PERMISSION_DENIED` (403), `NOT_FOUND` (404), `INTERNAL_SERVER_ERROR` (500).

---

## 2. Контакты — `/api/v1/crm/contacts`

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `contacts:read` |
| GET | `/:id` | `contacts:read` |
| POST | `/` | `contacts:write` |
| PATCH | `/:id` | `contacts:write` |
| PUT | `/:id/custom-fields` | `contacts:write` |
| DELETE | `/:id` | `contacts:delete` |

### `GET /contacts`

Query: `search`, `company_id`, `channel`, `limit`, `offset`.

`search` покрывает имя, фамилию, отчество, любой из телефонов (включая дополнительные из JSONB), e-mail, должность, название компании и значения соцсетей (`ILIKE`). `channel` — одно из `telegram`, `whatsapp`, `rumax`, `phone`, `email`.

### `POST /contacts`

```json
{
  "first_name": "Сергей",
  "last_name": "Волков",
  "middle_name": "Игоревич",
  "phones": [
    { "number": "+79991234567", "country_code": "RU", "calling_code": "+7" },
    { "number": "+74951234567", "country_code": "RU", "calling_code": "+7" }
  ],
  "email": "sergey@techcorp.ru",
  "socials": [
    { "kind": "telegram", "value": "@volkov" },
    { "kind": "whatsapp", "value": "+79991234567" }
  ],
  "job_title": "Технический директор",
  "company_name": "TechCorp LLC",
  "company_id": "…uuid…",
  "channel": "telegram",
  "linkedin_link": "https://linkedin.com/in/volkov",
  "notes": "",
  "custom_fields": { "source": "выставка" }
}
```

Обязательно только `first_name` (миграция `0020`). Фамилия, отчество, телефоны и компания необязательны — как на `Person` у Twenty, где nullable всё, кроме идентификатора: клиент из мессенджера часто известен одним именем, у физлица нет компании, номер бывает скрыт настройками приватности. `channel` по умолчанию `phone`. Пустая строка в необязательных полях трактуется как отсутствие значения и пишется как `NULL`.

`phones` — список, первый элемент становится основным номером (`phone` + `phone_country_code` + `phone_calling_code`), остальные уходят в `additional_phones`. Это модель их composite-типа `PHONES`. Номер приводится к E.164: разделители снимаются до валидации, иначе поиск по номеру не находил бы «+7 916 …», записанный как «8 (916) …». Дубли по номеру снимаются. Максимум 10 номеров.

`socials` — список `{kind, value}`, где `kind` ∈ `telegram|whatsapp|max|viber|vk|instagram|other`. Первое значение `telegram` и `whatsapp` дополнительно пишется в одноимённые колонки: по ним ищет транспорт каналов. Дубли по паре (kind, value) снимаются. Максимум 20 профилей.

`company_name` без `company_id` **создаёт компанию**: сервис ищет компанию тенанта по нормализованному названию (`lower(btrim(...))`) и создаёт её, если не нашёл. До этого название оставалось строкой у контакта и в `/crm/companies` не появлялось. Переданный `company_id` важнее названия, а название в ответе всегда равно названию связанной компании — источник правды один.

`linkedin_link` (миграция `0019`) валидируется как URL, но допускает пустую строку: поле необязательное, а `z.string().url()` на `""` отдал бы ошибку, которую пользователь читает как «уберите поле».

`created_by` в теле **не принимается**: автор берётся из токена, иначе клиент мог бы записать создателем любого пользователя тенанта.

**Ответ `201`**

```json
{
  "data": {
    "id": "…",
    "firstName": "Сергей",
    "lastName": "Волков",
    "middleName": "Игоревич",
    "phone": "+79991234567",
    "phones": [
      { "number": "+79991234567", "countryCode": "RU", "callingCode": "+7", "isPrimary": true },
      { "number": "+74951234567", "countryCode": "RU", "callingCode": "+7", "isPrimary": false }
    ],
    "email": "sergey@techcorp.ru",
    "telegramUsername": "@volkov",
    "whatsapp": "+79991234567",
    "socials": [
      { "kind": "telegram", "value": "@volkov" },
      { "kind": "whatsapp", "value": "+79991234567" }
    ],
    "jobTitle": "Технический директор",
    "companyName": "TechCorp LLC",
    "companyId": "…",
    "channel": "telegram",
    "linkedinLink": "https://linkedin.com/in/volkov",
    "customFields": { "source": "выставка" },
    "notes": "",
    "createdBy": "…uuid…",
    "createdByName": "Антон",
    "createdAt": "…",
    "updatedAt": "…",
    "dealsCount": 0,
    "tasksCount": 0
  }
}
```

`phone` дублирует первый элемент `phones` намеренно: по нему ищет транспорт каналов, и отдельное поле избавляет вызывающего от разбора списка.

`createdByName`, `dealsCount` и `tasksCount` приходят JOIN-ами, поэтому `POST` и `PATCH` перечитывают запись после записи: `RETURNING` не умеет отдать значение соединения, и карточка сразу после создания показывала бы автора как «Система».

### `PATCH /contacts/:id`

Частичное обновление. `custom_fields` **сливается** оператором `||`: ключи, не переданные в запросе, сохраняются.

`phones` и `socials` — наоборот, **заменяются целиком**. Частичной правки одного элемента нет намеренно: у Twenty `PhonesFieldInput` тоже отдаёт весь composite, а патч по индексу ломался бы при одновременной правке из двух вкладок.

### `PUT /contacts/:id/custom-fields`

Полная замена JSONB-объекта.

```json
{ "custom_fields": { "source": "реклама" } }
```

### `DELETE /contacts/:id`

Мягкое удаление. Если у контакта не было связанных сделок — `204` без тела. Если были — `200` с предупреждением:

```json
{
  "data": { "id": "…", "deleted": true },
  "meta": { "linkedDeals": 3, "warning": "Contact had linked deals; they now reference a deleted contact" }
}
```

---

## 3. Компании — `/api/v1/crm/companies`

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `companies:read` |
| GET | `/:id` | `companies:read` |
| GET | `/:id/stats` | `companies:read` |
| POST | `/` | `companies:write` |
| PATCH | `/:id` | `companies:write` |
| DELETE | `/:id` | `companies:delete` |

### `GET /companies`

Query: `search` (название, ИНН, телефон, менеджер), `manager_id`, `limit`, `offset`.

### `POST /companies`

```json
{
  "name": "TechCorp LLC",
  "domain_name": "techcorp.ru",
  "phone": "+74951234567",
  "email": "info@techcorp.ru",
  "inn": "7701234567",
  "ogrn": "1027700132195",
  "bik": "044525225",
  "account_number": "40702810100000012345",
  "legal_address": "Москва, Тверская 15",
  "manager_name": "Иван Петров",
  "manager_id": "…uuid…",
  "annual_revenue": 5000000,
  "linkedin_link": "https://linkedin.com/company/techcorp",
  "address_city": "Москва",
  "address_street": "Тверская 1",
  "address_country": "Россия",
  "address_postcode": "125009",
  "notes": "",
  "custom_fields": {}
}
```

Проверка реквизитов: `inn` — 10 или 12 цифр, `ogrn` — 13 или 15, `bik` — 9, `account_number` — 20. Поля необязательны, но при непустом значении формат обязателен.

Поля миграции `0019` (образец — стандартный объект Company в Twenty):

| Поле | Тип | Примечание |
|---|---|---|
| `annual_revenue` | `number \| null` | `NUMERIC(18,2)` в БД. `null` означает «доход неизвестен» и отличается от `0`; передача `null` в `PATCH` очищает значение |
| `linkedin_link` | `string` | URL либо пустая строка |
| `address_city`, `address_street`, `address_country`, `address_postcode` | `string` | Фактический адрес. **Не заменяет** `legal_address`: юридический адрес берётся из реквизитов и часто не совпадает |

**Ответ `201`** — реквизиты и адрес сгруппированы:

```json
{
  "data": {
    "id": "…",
    "name": "TechCorp LLC",
    "domainName": "techcorp.ru",
    "phone": "+74951234567",
    "email": "info@techcorp.ru",
    "requisites": {
      "inn": "7701234567",
      "ogrn": "1027700132195",
      "bik": "044525225",
      "accountNumber": "40702810100000012345",
      "legalAddress": "Москва, Тверская 15"
    },
    "managerName": "Иван Петров",
    "managerId": "…",
    "annualRevenue": 5000000,
    "linkedinLink": "https://linkedin.com/company/techcorp",
    "address": {
      "city": "Москва",
      "street": "Тверская 1",
      "country": "Россия",
      "postcode": "125009"
    },
    "notes": "",
    "customFields": {},
    "createdBy": "…uuid…",
    "createdByName": "Антон",
    "createdAt": "…",
    "updatedAt": "…",
    "contactsCount": 0,
    "dealsCount": 0,
    "dealsBudgetTotal": 0
  }
}
```

`annualRevenue` приходит числом, хотя `NUMERIC` отдаётся драйвером строкой — приведение делает DTO. Как и у контактов, `POST`/`PATCH` перечитывают запись, чтобы вернуть `createdByName` и агрегаты.

### `GET /companies/:id/stats`

```json
{ "data": { "contactsCount": 4, "dealsCount": 7, "dealsBudgetTotal": 1250000 } }
```

### `DELETE /companies/:id`

По аналогии с контактами: `204` без связей, `200` с `meta.linkedContacts`, `meta.linkedDeals` и предупреждением при их наличии.

---

## 4. Сделки — `/api/v1/crm/deals`

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `deals:read` |
| GET | `/kanban` | `deals:read` |
| GET | `/pipelines` | `deals:read` |
| POST | `/pipelines/:pipelineId/stages` | `deals:write` |
| PATCH | `/pipelines/:pipelineId/stages/:stageId` | `deals:write` |
| DELETE | `/pipelines/:pipelineId/stages/:stageId` | `deals:write` |
| GET | `/:id` | `deals:read` |
| POST | `/` | `deals:write` |
| PATCH | `/:id` | `deals:write` |
| PATCH | `/:id/stage` | `deals:write` |
| DELETE | `/:id` | `deals:write` |
| GET | `/:id/messages` | `deals:read` |
| POST | `/:id/messages` | `deals:write` |

### `GET /deals`

Query: `pipeline_id`, `stage_id`, `search` (заголовок, описание), `contact_id`, `company_id`, `limit`, `offset`.

`contact_id` и `company_id` обслуживают секцию «Сделки» на карточках контакта и компании: без них связанные сделки было нечем запросить, и секция показывала только счётчик.

### `GET /deals/pipelines`

Tenant-scoped catalog used by the frontend to select the required `pipeline_id` for the Kanban projection and deal creation.

**Ответ `200`**

```json
{
  "data": [
    { "id": "…uuid…", "name": "Основная воронка", "sortOrder": 1 }
  ],
  "meta": { "total": 1 }
}
```

Если у арендатора нет воронок, возвращается пустой массив. Endpoint зарегистрирован до `/:id`, чтобы слово `pipelines` не разбиралось как UUID сделки.

### Поля записей (миграция `0018`)

`DealDTO` дополнен `ownerId`, `closeDate` (YYYY-MM-DD), `position` и денормализованными подписями связей `companyName`, `contactName`, `ownerName` — они приходят JOIN'ами в том же запросе, иначе таблица записей делала бы запрос на чип в каждой строке (N+1). `POST /deals` принимает `owner_id` и `close_date`; при отсутствии `owner_id` ответственным становится создатель. `PATCH /deals/:id` дополнительно принимает `owner_id`, `close_date`, `position` и отвечает перечитанной записью с подписями связей.

`PATCH /deals/:id/stage` принимает необязательный `target_index` — индекс места в целевой колонке при перетаскивании; без него карточка встаёт первой.

`ContactDTO` дополнен `jobTitle` и `dealsCount` (сколько сделок ведётся через контакт). `CompanyDTO` — `domainName`, `contactsCount`, `dealsCount`, `dealsBudgetTotal`. Счётчики считаются LATERAL-подзапросами в выборке списка.

### `POST /deals/pipelines/:pipelineId/stages` · `PATCH …/stages/:stageId` · `DELETE …/stages/:stageId`

CRUD стадий для визуального редактора воронки (кнопка «Настроить» на канбане). Все три маршрута зарегистрированы до `/:id`.

- `POST` — `{ "name": "…", "color": "amber" }`, `color` опционален (`slate` по умолчанию); стадия добавляется в конец (`sort_order = max+1`). Ответ `201` — колонка канбана.
- `PATCH` — частично `{ name?, color?, sort_order? }`; перестановка колонок выполняется двумя PATCH с обменом значений `sort_order`. Ответ `200` — обновлённая колонка; `404`, если стадия чужая или не существует.
- `DELETE` — только пустая пользовательская стадия: `400 STAGE_NOT_EMPTY` при живых сделках, `400` для стадий с флагом `is_won`/`is_lost` — на них держится семантика закрытия сделок. Ответ `204`.

`color` — ключ пресета (`amber|emerald|sky|rose|violet|orange|cyan|slate`), а не CSS-класс и не hex: фронтенд компилирует только литеральные классы Tailwind, а произвольные цвета позволили бы сломать контраст интерфейса.

### `GET /deals/kanban`

Query: `pipeline_id` — обязателен.

Возвращает все этапы воронки, включая пустые:

```json
{
  "data": [
    {
      "stageId": "…",
      "stageName": "В работе",
      "sortOrder": 1,
      "isWon": false,
      "isLost": false,
      "dealCount": 4,
      "budgetTotal": 780000,
      "deals": [ { "id": "…", "title": "…", "budget": 450000, "…": "…" } ]
    }
  ],
  "meta": { "pipelineId": "…", "stageCount": 6, "dealCount": 17 }
}
```

`404 NOT_FOUND`, если воронка не найдена или у неё нет этапов.

### `POST /deals`

```json
{
  "title": "Внедрение CRM",
  "description": "",
  "budget": 450000,
  "currency": "RUB",
  "pipeline_id": "…uuid…",
  "stage_id": "…uuid…",
  "contact_id": "…uuid…",
  "company_id": "…uuid…",
  "custom_fields": {}
}
```

`currency` — три символа, по умолчанию `RUB`. Сервер проверяет, что `stage_id` принадлежит указанной `pipeline_id` и что воронка принадлежит арендатору; иначе `400 VALIDATION_ERROR`. Автор берётся из токена. Создание фиксируется записью в `deal_stage_history`.

### `PATCH /deals/:id/stage`

```json
{ "stage_id": "…uuid…" }
```

Проверяет, что целевой этап принадлежит воронке сделки. Пишет переход в `deal_stage_history`. При попадании на этап с `is_won` или `is_lost` ставит `closed_at`, при выходе из терминального этапа — очищает.

`400 VALIDATION_ERROR`, если этап из другой воронки.

### `GET /deals/:id/messages`

```json
{
  "data": [
    {
      "id": "…",
      "dealId": "…",
      "source": "manager",
      "direction": "outbound",
      "senderName": "Иван Петров",
      "content": "…",
      "channel": "telegram",
      "attachment": null,
      "attachmentType": null,
      "deliveryStatus": "sent",
      "deliveryError": null,
      "createdAt": "…"
    }
  ],
  "meta": { "total": 12 }
}
```

Сортировка по возрастанию `created_at`.

`deliveryStatus`: `neutral` — доставлять некуда (входящее от клиента, системная
запись), `pending` — принято сервером, транспорт ещё не подтвердил, `sent` —
подтверждено, `failed` — отказ, текст в `deliveryError`.

### `POST /deals/:id/messages`

```json
{
  "source": "manager",
  "direction": "outbound",
  "content": "Отправил счёт",
  "channel": "telegram",
  "channel_account_id": "",
  "attachment": "",
  "attachment_type": ""
}
```

`source`: `human`, `manager`, `client`, `ai`, `ai_bot`, `system` (по умолчанию `manager`). `direction`: `inbound`, `outbound`, `neutral` (по умолчанию `outbound`). `senderName` подставляется из токена. `404 NOT_FOUND`, если сделки нет.

**Сообщение не только записывается, но и отправляется в канал клиента.** До
этого маршрут писал строку в `deal_messages` и транспорт не вызывал: менеджер
печатал в карточке, сообщение появлялось в таймлайне, клиент в Telegram не
получал ничего.

Порядок шагов: сначала запись со `deliveryStatus: "pending"`, затем отправка,
затем обновление статуса. Обратный порядок терял бы текст ответа при отказе сети.

Отправляются только строки с `direction: "outbound"` и `source ≠ "system"`:
внутренняя заметка остаётся в `neutral`, иначе она выглядела бы как
неотправленное клиенту сообщение.

Получатель берётся из контакта сделки (`telegram_chat_id` для Telegram —
числовой id, а не username: username мог измениться). Аккаунт-отправитель — тот,
на который клиент писал последним в этом канале, если `channel_account_id` не
передан явно: у арендатора может быть несколько аккаунтов одного канала, и ответ
обязан уйти с нужного.

**Отказ доставки не превращается в 5xx.** Ответ остаётся `201` со
`deliveryStatus: "failed"` и причиной в `deliveryError`: сообщение сохранено, а
ошибка 5xx оставила бы клиента в неизвестности — сохранён текст или нет. Причины
отказа: канал не отправляет в этом процессе (транспорт выключен или аккаунт не
поднят), у контакта нет адреса в канале, транспорт отклонил отправку
(`USER_IS_BLOCKED`, `FLOOD_WAIT` — текст Telegram передаётся как есть, потому что
эти случаи требуют разных действий оператора).

---

## 5. Задачи — `/api/v1/crm/tasks`

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `tasks:read` |
| GET | `/:id` | `tasks:read` |
| POST | `/` | `tasks:write` |
| PATCH | `/:id` | `tasks:write` |
| PATCH | `/:id/status` | `tasks:write` |
| DELETE | `/:id` | `tasks:write` |

### `GET /tasks`

Query: `filter`, `assignee_id`, `priority`, `status`, `linked_entity_type`, `linked_entity_id`, `limit`, `offset`.

`filter`:

| Значение | Отбор |
|---|---|
| `today` | срок в пределах текущих суток |
| `overdue` | срок в прошлом и статус не `done` |
| `upcoming` | срок в будущем и статус не `done` |
| `my` | исполнитель — текущий пользователь |
| `unassigned` | без исполнителя |

`linked_entity_type` и `linked_entity_id` используются только вместе, иначе `400 VALIDATION_ERROR`.

Сортировка: сначала просроченные, затем по приоритету (`high` → `medium` → `low`), затем по сроку, затем по дате создания.

### `POST /tasks`

```json
{
  "title": "Позвонить клиенту",
  "description": "",
  "priority": "high",
  "status": "todo",
  "due_date": "2026-08-20T10:00:00.000Z",
  "assignee_id": "…uuid…",
  "linked_entity_type": "deal",
  "linked_entity_id": "…uuid…"
}
```

`priority`: `low`, `medium` (по умолчанию), `high`. `status`: `todo` (по умолчанию), `in_progress`, `done`. `linked_entity_type` и `linked_entity_id` обязательны только парой.

**Ответ `201`**

```json
{
  "data": {
    "id": "…",
    "dealId": "…",
    "contactId": null,
    "companyId": null,
    "linkedEntityType": "deal",
    "linkedEntityId": "…",
    "title": "Позвонить клиенту",
    "description": "",
    "priority": "high",
    "status": "todo",
    "dueDate": "2026-08-20T10:00:00.000Z",
    "assigneeId": "…",
    "completedAt": null,
    "isOverdue": false,
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

`isOverdue` вычисляется сервером. Три поля `dealId`/`contactId`/`companyId` дублируют логическую привязку `linkedEntityType` + `linkedEntityId`.

### `PATCH /tasks/:id`

Смена `status` без явного `completed_at` синхронизирует метку: переход в `done` ставит текущее время, любой другой статус очищает её. Изменение привязки перезаписывает все три колонки, поэтому заполненной остаётся максимум одна.

### `PATCH /tasks/:id/status`

```json
{ "status": "done" }
```

Быстрое переключение для чекбокса в таблице.

---

## 6. Заметки — `/api/v1/crm/notes`

Образец — объект `Note` в Twenty вместе с junction-таблицей `NoteTarget`.

**Права наследуются от целевой записи**, своего `notes:*` нет: заметка о контакте — часть данных этого контакта, и читать её должен тот, у кого есть доступ к контакту. Отдельное право пришлось бы выдавать каждой роли, и оно неизбежно расходилось бы с доступом к самой записи.

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `contacts:read` / `companies:read` / `deals:read` по `target_type` |
| POST | `/` | `contacts:write` / `companies:write` / `deals:write` по `target_type` |
| PATCH | `/:id` | право записи по типу цели существующей заметки |
| DELETE | `/:id` | то же |

### `GET /notes`

Query: `target_type` (`contact` \| `company` \| `deal`), `target_id`, `limit` (≤100, по умолчанию 50), `offset`.

Оба параметра цели обязательны: список заметок всегда открывается в контексте записи, а выборка «все заметки тенанта» не нужна ни одному экрану.

```json
{
  "data": [
    {
      "id": "…",
      "title": "",
      "body": "Договорились созвониться в пятницу",
      "targetType": "contact",
      "targetId": "…uuid…",
      "createdBy": "…uuid…",
      "createdByName": "Антон",
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "meta": { "limit": 50, "offset": 0, "total": 1 }
}
```

### `POST /notes`

```json
{
  "title": "",
  "body": "Договорились созвониться в пятницу",
  "target_type": "contact",
  "target_id": "…uuid…"
}
```

`body` обязателен (1–20000 символов), `title` необязателен — как `title` у Note в Twenty: чаще заметку пишут одним абзацем, и требовать заголовок значило бы придумывать его на каждую строчку.

Существование цели проверяется отдельным запросом **до** вставки и с учётом `tenant_id`. Внешний ключ поймал бы чужой id, но ответил бы ошибкой БД, а не понятным `404`; без проверки тенанта заметку можно было бы прикрепить к записи чужого арендатора, зная её uuid.

- `201` — заметка создана, в ответе `data` с `createdByName`
- `404` — целевой записи нет в этом тенанте (`{ "error": { "code": "NOT_FOUND", "message": "contact not found" } }`)
- `403` — нет права записи на объект цели

### `PATCH /notes/:id`

Тело: `title` и/или `body`. Тип цели не меняется: перенос заметки между записями — другая операция, и разрешать её частичным обновлением значило бы допускать смену владельца данных незаметно для пользователя.

### `DELETE /notes/:id`

Мягкое удаление (`deleted_at`), ответ `204`.

### Модель хранения

Полиморфная связь выражена **тремя nullable-колонками** `contact_id` / `company_id` / `deal_id` с ограничением на ровно одну заполненную:

```sql
CONSTRAINT notes_single_target CHECK (
  (contact_id IS NOT NULL)::int + (company_id IS NOT NULL)::int + (deal_id IS NOT NULL)::int = 1
)
```

Пара `(target_type, target_id)` выглядела бы компактнее, но не даёт ссылочной целостности: удаление контакта оставило бы висячие заметки. Здесь целостность обеспечивает сама БД, а `ON DELETE CASCADE` убирает заметки вместе с записью.

RLS включён с `FORCE` и той же политикой `tenant_isolation`, что у остальных таблиц CRM.

---

## 7. Раскладки RecordTable — `/api/v1/crm/table-layouts`

| Метод | Путь | Право |
|---|---|---|
| GET | `/:tableId` | аутентифицированный пользователь |
| PUT | `/:tableId` | аутентифицированный пользователь |

`tableId` — `contacts`, `companies`, `deals` или `tasks`. Раскладка принадлежит
паре tenant + пользователь: `tenant_id` и `user_id` всегда берутся из JWT, а не
из параметров клиента.

### `GET /table-layouts/:tableId`

Возвращает `200 { "data": null }`, если пользователь ещё не сохранял
раскладку; иначе:

```json
{
  "data": {
    "tableId": "contacts",
    "layout": {
      "widths": { "name": 280, "email": 220 },
      "order": ["name", "email", "phone"],
      "hidden": ["phone"]
    },
    "updatedAt": "2026-09-03T11:00:00.000Z"
  }
}
```

### `PUT /table-layouts/:tableId`

Тело — объект `layout` из примера выше. PUT заменяет всю раскладку и делает
upsert по `(tenant_id, user_id, table_id)`.

- ширины — целые 104…2000, не более 50;
- `order` и `hidden` — до 50 уникальных идентификаторов колонок;
- идентификатор колонки: 1…64 символа, начинается с буквы, далее только буквы,
  цифры, `_` или `-`;
- неизвестный tableId и неверное тело отвечают `400 VALIDATION_ERROR`.

---

## 8. Вкладки карточек — `/api/v1/crm/page-layouts`

| Метод | Путь | Право |
|---|---|---|
| GET | `/:objectType/tabs` | аутентифицированный пользователь |
| PATCH | `/:objectType/tabs/:tabKey` | аутентифицированный пользователь |

`objectType` — `contact`, `company` или `deal`. `tenant_id` только из JWT.
Первый GET для нового арендатора вызывает `ensureTenantDefaults` и засевает
стандартный состав (идемпотентно).

### `GET /page-layouts/:objectType/tabs`

Список в порядке `position ASC`, включая неактивные — фильтр `is_active` /
модуль / право делает фронт (`resolvePageLayoutTabs`).

```json
{
  "data": [
    {
      "tabKey": "home",
      "title": "Главная",
      "icon": "Home",
      "position": 10,
      "isActive": true,
      "moduleSlug": null,
      "requiredPermission": null,
      "updatedAt": "2026-09-03T20:00:00.000Z"
    },
    {
      "tabKey": "chat",
      "title": "Чат",
      "icon": "MessageCircle",
      "position": 15,
      "isActive": true,
      "moduleSlug": null,
      "requiredPermission": "deals:write",
      "updatedAt": "2026-09-03T20:00:00.000Z"
    }
  ]
}
```

### `PATCH /page-layouts/:objectType/tabs/:tabKey`

Частичное обновление: `title`, `icon`, `position`, `isActive`. `moduleSlug` и
`requiredPermission` через API не меняются — они задают семантику вкладки при
вставке. Неизвестный ключ → `404 TAB_NOT_FOUND`. Пустое тело → `404`.

