# 03_03 — API ремонтов и финансов

> Источник: `backend/src/modules/repairs/`, `backend/src/modules/finance/`, `backend/src/modules/marketplace/`, `backend/src/modules/admin/`.

---

## 1. Общие правила

Аутентификация — `Authorization: Bearer <jwt>`; `tenant_id` только из токена. Конверты `{ data, meta? }` и `{ error }`, как в `03_02_CRM_API.md`. Пагинация: `limit` 1…100 (по умолчанию 25), `offset` от 0.

**Модульные ограничения.** Если требуемый модуль не установлен арендатору — `403 MODULE_NOT_INSTALLED`. Это отдельный код от `PERMISSION_DENIED`, чтобы клиент мог предложить установку.

**Специфичные коды:**

| Код | Статус | Причина |
|---|---|---|
| `MODULE_NOT_INSTALLED` | 403 | модуль не подключён |
| `INVALID_STATUS_TRANSITION` | 409 | недопустимый переход статуса наряда |
| `REPAIR_ORDER_CLOSED` | 409 | наряд выдан или отклонён, правки запрещены |
| `INSUFFICIENT_FUNDS` | 409 | недостаточно средств на счёте |
| `INVOICE_ALREADY_PAID` | 409 | повторная оплата счёта |

---

## 2. Ремонты — `/api/v1/repairs`

Все маршруты требуют модуль `service_center` плюс право `service_center:read` (чтение) или `service_center:write` (запись).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/` | список нарядов |
| GET | `/:id` | наряд с работами, запчастями, заметками, фото и итогами |
| POST | `/` | приёмка |
| PATCH | `/:id` | правка полей |
| PATCH | `/:id/status` | смена статуса |
| DELETE | `/:id` | мягкое удаление |
| GET | `/:id/totals` | пересчёт сумм |
| GET/POST | `/:id/works` | работы |
| PATCH/DELETE | `/:id/works/:itemId` | правка и удаление работы |
| GET/POST | `/:id/parts` | запчасти |
| PATCH/DELETE | `/:id/parts/:itemId` | правка и удаление запчасти |
| GET/POST | `/:id/notes` | заметки и журнал |
| GET/POST | `/:id/photos` | фото |

### `GET /repairs`

Query: `status`, `priority`, `master_id`, `customer_id`, `search`, `limit`, `offset`.

`search` покрывает номер наряда, имя и телефон клиента, бренд, модель и серийный номер. Сортировка — по приоритету (`urgent` → `high` → `normal` → `low`), затем по дате приёмки.

### `POST /repairs`

```json
{
  "customer_id": "…uuid…",
  "customer_name": "Сергей Волков",
  "customer_phone": "+79991234567",
  "equipment_type": "Ноутбук",
  "equipment_brand": "Lenovo",
  "equipment_model": "ThinkPad T14",
  "equipment_serial": "PF-0XYZ",
  "package_contents": "Блок питания, сумка",
  "appearance": "Потёртости на крышке",
  "defect_description": "Не включается после залития",
  "defect_photos": ["https://…/1.jpg"],
  "priority": "normal",
  "master_id": "…uuid…",
  "master_name": "Павел Смирнов",
  "estimated_cost": 8400,
  "notes": ""
}
```

`defect_description` — минимум 10 символов. `defect_photos` — до 20 URL. `priority` по умолчанию `normal`.

Сервер в одной транзакции: выделяет номер `ЗН-YYYY-NNNN` через `repair_counters`, создаёт наряд в статусе `intake`, создаёт строки в `repair_photos`, пишет открывающую запись в `repair_notes`, пополняет `device_models`.

**Ответ `201`** — объект наряда, включая:

```json
{
  "data": {
    "ticketNumber": "ЗН-2026-0042",
    "status": "intake",
    "nextStatus": "diagnostics",
    "allowedTransitions": ["diagnostics", "rejected"],
    "equipment": { "type": "Ноутбук", "brand": "Lenovo", "model": "ThinkPad T14", "serialNumber": "PF-0XYZ", "packageContents": "…", "appearance": "…" },
    "estimatedCost": 8400,
    "finalCost": null,
    "diagnostics": null
  }
}
```

`nextStatus` и `allowedTransitions` сервер вычисляет из матрицы переходов — интерфейсу не нужно её дублировать.

### `GET /repairs/:id`

Дополнительно к полям наряда возвращает `works`, `parts`, `notes_log`, `photos` и `totals`:

```json
{
  "totals": {
    "worksTotal": 5000,
    "partsRetailTotal": 3400,
    "partsCostTotal": 2100,
    "grandTotal": 8400,
    "margin": 6300,
    "marginPercent": 75
  }
}
```

### `PATCH /repairs/:id/status`

```json
{
  "status": "approval",
  "comment": "Согласовано с клиентом",
  "diagnostics": {
    "findings": "Окисление платы питания",
    "recommended_action": "Замена платы",
    "condition_notes": "Клавиатура исправна"
  }
}
```

Разрешённые переходы:

| Из | В |
|---|---|
| `intake` | `diagnostics`, `rejected` |
| `diagnostics` | `approval`, `rejected` |
| `approval` | `in_progress`, `rejected` |
| `in_progress` | `ready`, `rejected` |
| `ready` | `issued` |
| `issued`, `rejected` | — |

Правила:

- переход в `approval` требует диагностики — переданной в запросе либо уже сохранённой, иначе `400 VALIDATION_ERROR`;
- переход в `ready` ставит `completed_at`;
- переход в `issued` ставит `delivered_at` и фиксирует `final_cost` суммой работ и запчастей;
- любой переход пишет запись в `repair_notes` с `kind = 'status'`;
- повторная установка того же статуса возвращает наряд без изменений;
- недопустимый переход — `409 INVALID_STATUS_TRANSITION` с перечнем разрешённых в `details`.

### Работы

`POST /repairs/:id/works`:

```json
{ "description": "Замена платы питания", "master_id": "…uuid…", "master_name": "Павел Смирнов", "cost": 5000 }
```

### Запчасти

`POST /repairs/:id/parts`:

```json
{ "name": "Плата питания", "article": "PWR-114", "quantity": 1, "retail_price": 3400, "cost_price": 2100 }
```

Ответ по позиции содержит расчёт: `retailTotal`, `costTotal`, `margin`.

Добавление, правка и удаление работ и запчастей возвращают пересчитанные `totals` в `meta`. Для нарядов в статусах `issued` и `rejected` добавление отвечает `409 REPAIR_ORDER_CLOSED`.

### Заметки и фото

`POST /repairs/:id/notes` — `{ "content": "…" }`, записывается с `kind = 'note'`, автор из токена.

`POST /repairs/:id/photos` — `{ "url": "https://…", "caption": "" }`. URL дополнительно добавляется в массив `defect_photos`. Загрузка бинарных файлов (multipart) не поддерживается.

---

## 3. Финансы — `/api/v1/finance`

Требуют модуль `finance` плюс `finance:read` или `finance:write`.

| Метод | Путь | Право |
|---|---|---|
| GET | `/accounts` | `finance:read` |
| POST | `/accounts` | `finance:write` |
| POST | `/accounts/transfer` | `finance:write` |
| GET | `/transactions` | `finance:read` |
| POST | `/transactions` | `finance:write` |
| GET | `/pnl` | `finance:read` |

### `GET /finance/accounts`

```json
{ "data": [ { "id": "…", "name": "Касса", "currency": "RUB", "balance": 152000, "isDefault": true } ] }
```

### `POST /finance/accounts`

```json
{ "name": "Эквайринг", "currency": "RUB", "opening_balance": 0, "is_default": false }
```

### `POST /finance/accounts/transfer`

```json
{
  "from_account_id": "…uuid…",
  "to_account_id": "…uuid…",
  "amount": 25000,
  "description": "Инкассация",
  "occurred_at": "2026-08-18T10:00:00.000Z"
}
```

Проверки: счёта должны различаться (иначе `400`), валюты совпадать (`400 VALIDATION_ERROR`), баланса источника хватать (`409 INSUFFICIENT_FUNDS`).

Операция атомарна: оба счёта блокируются `FOR UPDATE`, балансы меняются и создаются две записи в `transactions` (расход и доход) с категорией `Internal transfer`.

**Ответ `200`** — оба счёта с новыми балансами:

```json
{ "data": { "from": { "id": "…", "balance": 127000, "…": "…" }, "to": { "id": "…", "balance": 25000, "…": "…" } } }
```

### `POST /finance/transactions`

```json
{
  "account_id": "…uuid…",
  "type": "income",
  "amount": 8400,
  "currency": "RUB",
  "category_id": "…uuid…",
  "category_name": "Оплата ремонта",
  "description": "ЗН-2026-0042",
  "counterparty_name": "Сергей Волков",
  "counterparty_inn": "",
  "deal_id": "",
  "repair_order_id": "…uuid…",
  "invoice_id": "",
  "occurred_at": "2026-08-18T10:00:00.000Z"
}
```

`type` — `income` или `expense`; `category_name` обязателен. Валюта операции должна совпадать с валютой счёта. Расход, уводящий баланс в минус, отклоняется с `409 INSUFFICIENT_FUNDS`. Баланс счёта обновляется в той же транзакции.

### `GET /finance/pnl`

Query: `from`, `to` — ISO-даты. По умолчанию период — последние 30 дней от текущего момента.

```json
{
  "data": {
    "from": "2026-07-19T…",
    "to": "2026-08-18T…",
    "income": 412000,
    "expenses": 268000,
    "netProfit": 144000,
    "incomeByCategory": [ { "categoryName": "Оплата ремонта", "amount": 260000, "percentage": 63.1 } ],
    "expensesByCategory": [ { "categoryName": "Закупка", "amount": 120000, "percentage": 44.8 } ]
  }
}
```

`percentage` — доля статьи в сумме своего направления, округление до одного знака; при нулевом итоге равна 0.

---

## 4. Счета на оплату — `/api/v1/invoices`

Требуют модуль `finance` плюс `finance:read` или `finance:write`.

| Метод | Путь | Право |
|---|---|---|
| GET | `/` | `finance:read` |
| POST | `/` | `finance:write` |
| POST | `/from-repair/:repairId` | `finance:write` |
| PATCH | `/:id` | `finance:write` |
| POST | `/:id/pay` | `finance:write` |

### `POST /invoices`

```json
{
  "company_id": "…uuid…",
  "company_name": "TechCorp LLC",
  "company_inn": "7701234567",
  "company_address": "Москва, Тверская 15",
  "contact_name": "Сергей Волков",
  "contact_phone": "+79991234567",
  "deal_id": "",
  "repair_order_id": "",
  "due_date": "2026-08-25T00:00:00.000Z",
  "vat_rate": 20,
  "currency": "RUB",
  "notes": "",
  "line_items": [
    { "description": "Замена платы питания", "quantity": 1, "unit_price": 5000, "source": "manual", "source_label": "" }
  ]
}
```

`line_items` — от 1 до 100 позиций. `vat_rate` — 0…100, по умолчанию 20. `source`: `manual`, `repair_work`, `repair_part`, `deal`.

Итоги считает сервер: `total` позиции равен `quantity × unit_price`, `subtotal` — их сумма, `vat_amount = subtotal × vat_rate / 100`, `total = subtotal + vat_amount`. Номер выдаётся в формате `СЧ-YYYY-NNNN`, статус созданного счёта — `sent`.

**Ответ `201`**

```json
{
  "data": {
    "id": "…",
    "invoiceNumber": "СЧ-2026-0007",
    "status": "sent",
    "issueDate": "…",
    "dueDate": "…",
    "subtotal": 5000,
    "vatRate": 20,
    "vatAmount": 1000,
    "total": 6000,
    "currency": "RUB",
    "paidAt": null,
    "paidAccountId": null,
    "lineItems": [ { "id": "…", "description": "…", "quantity": 1, "unitPrice": 5000, "total": 5000, "source": "manual", "sourceLabel": null } ]
  }
}
```

### `POST /invoices/from-repair/:repairId`

Тело — как у `POST /invoices`, но без `repair_order_id` и `line_items`: их формирует сервер.

Каждая работа наряда превращается в позицию с `source = repair_work`, каждая запчасть — в позицию с `source = repair_part` и своим количеством. Если работ и запчастей нет, создаётся одна позиция по `estimated_cost` наряда. `source_label` заполняется номером наряда. Реквизиты плательщика по умолчанию берутся из данных клиента наряда.

`404 NOT_FOUND`, если наряда нет в пределах арендатора.

### `PATCH /invoices/:id`

```json
{ "status": "overdue", "due_date": "2026-09-01T00:00:00.000Z", "notes": "Продлён срок" }
```

`status`: `draft`, `sent`, `paid`, `overdue`, `cancelled`.

### `POST /invoices/:id/pay`

```json
{ "account_id": "…uuid…", "occurred_at": "2026-08-18T12:00:00.000Z", "description": "Оплата по счёту" }
```

В одной транзакции: счёт блокируется `FOR UPDATE`; при статусе `paid` возвращается `409 INVOICE_ALREADY_PAID`; проверяется существование кассы и совпадение валюты; статус меняется на `paid` с заполнением `paid_at` и `paid_account_id`; баланс кассы увеличивается на сумму счёта; создаётся входящая транзакция с категорией `Invoice payment` и привязками к счёту, наряду и сделке.

---

## 5. Маркетплейс — `/api/v1/marketplace`

Все маршруты требуют право `tenant:admin`. Каталог и подключения всегда
scoped текущим арендатором: `tenant_id` берётся из токена, а не из тела запроса.

### Тарифные модели

| `billingKind` | Расчёт |
|---|---|
| `flat` | `basePrice` |
| `per_seat` | `basePrice + max(0, usersCount − includedUnits) × unitPrice` |
| `per_unit` | `unitPrice × quantity` |

Каталог содержит 9 модулей: базовая CRM (600 ₽/мес за 10 пользователей, далее
+200 ₽), Сервисный центр (500 ₽), Финансы и счета (500 ₽), AI-агенты (500 ₽ за
агента), Telegram/WhatsApp/MAX/Avito/Instagram (500 ₽ за аккаунт).

### `GET /marketplace/modules`

```json
{
  "data": [
    {
      "slug": "ai_bots",
      "name": "AI-агенты",
      "description": "…",
      "priceMonthly": 500,
      "billingKind": "per_unit",
      "basePrice": 0,
      "unitPrice": 500,
      "includedUnits": 0,
      "unitLabel": "агент",
      "isMulti": true,
      "category": "ai",
      "icon": "Bot",
      "trialDays": 14,
      "features": ["…"],
      "installed": true,
      "installedAt": "2026-08-20T10:00:00.000Z",
      "quantity": 2,
      "trialEndsAt": "2026-09-03T10:00:00.000Z",
      "trialActive": true,
      "monthlyTotal": 0
    }
  ]
}
```

`monthlyTotal` во время активного trial равен нулю; это вычисляет сервер, не
браузер. Для неподключённого `per_unit` модуля витрина рассчитывается как одна
единица, чтобы карточка не показывала 0 ₽.

### `GET /marketplace/billing`

```json
{
  "data": {
    "monthlyTotal": 1500,
    "monthlyAfterTrials": 2100,
    "usersCount": 1,
    "items": [
      {
        "slug": "core_crm",
        "name": "Базовая CRM",
        "quantity": 1,
        "monthlyTotal": 0,
        "trialActive": true,
        "trialEndsAt": "2026-09-03T10:00:00.000Z"
      }
    ]
  }
}
```

`monthlyAfterTrials` показывает сумму после завершения всех активных trial,
чтобы рост счёта не был неожиданностью.

### `POST /marketplace/modules/:slug/toggle`

```json
{ "enabled": true, "quantity": 2 }
```

`quantity` применим только к `isMulti = true`; для `flat` и `per_seat` всегда
используется 1. Максимум — 100.

```json
{
  "data": {
    "slug": "telegram",
    "enabled": true,
    "quantity": 2,
    "trialEndsAt": "2026-09-03T10:00:00.000Z"
  }
}
```

При **первой** установке `trialEndsAt = now() + 14 days`; повторное включение
после удаления не выдаёт новых дней: проверяется запись `module.install` в
`tenant_audit_log`. Отключение удаляет строку `installed_modules`. Обе операции
пишут аудит (`module.install` / `module.uninstall`).

### `PATCH /marketplace/modules/:slug/quantity`

```json
{ "quantity": 3 }
```

Доступен только установленным мульти-модулям. Немульти-модуль или отсутствующее
подключение возвращает `404`, количество вне 1…100 — `400 VALIDATION_ERROR`.

### `GET /tenant/modules`

Требует только аутентификацию; возвращает реальные подключения текущего
арендатора и является источником истины для Sidebar и клиентских module guards.

```json
{
  "data": [
    {
      "slug": "finance",
      "name": "Финансы и счета",
      "installedAt": "2026-08-20T10:00:00.000Z",
      "quantity": 1,
      "trialEndsAt": "2026-09-03T10:00:00.000Z"
    }
  ],
  "meta": { "total": 1 }
}
```

После toggle фронтенд инвалидирует этот query-key, поэтому пункты Сервисного
центра, Финансов и AI-ботов появляются или исчезают без перезагрузки. Базовые
пункты CRM и Маркетплейс всегда остаются доступными.

Отключённый модуль сразу начинает отвечать `403 MODULE_NOT_INSTALLED` на
сервере; в UI `<Guard>` показывает «Модуль отключён» и кнопку перехода в
Маркетплейс.

---

## 6. Администрирование арендаторов — `/api/v1/admin`

Требует роль `owner`.

### `GET /admin/tenants`

```json
{
  "data": [
    {
      "id": "…",
      "name": "Acme Corp",
      "plan": "enterprise",
      "status": "active",
      "ai_tokens_balance": 200000,
      "subscription_expires_at": "2026-12-31T00:00:00.000Z",
      "created_at": "…"
    }
  ]
}
```

### `PATCH /admin/tenants/:id`

```json
{
  "status": "active",
  "subscription_expires_at": "2027-01-31T00:00:00.000Z",
  "ai_tokens_balance": 500000
}
```

Все поля необязательны. `status`: `trial`, `active`, `past_due`, `suspended`. `subscription_expires_at` допускает `null` — снятие срока. `ai_tokens_balance` — целое неотрицательное.

Пустое тело возвращает текущее состояние арендатора без изменений. Каждое изменение фиксируется в `tenant_audit_log` (`action = 'tenant.update'`) со снимком в `details`.

`404 NOT_FOUND`, если арендатора нет.
