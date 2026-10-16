# 02_03 — Модуль «Сервисный центр»

> Slug модуля: `service_center`.
> Frontend: `frontend/src/app/(dashboard)/repairs/`, `frontend/src/components/repairs/`, `frontend/src/lib/repairs/`.
> Backend: `backend/src/modules/repairs/`.
> Контракт API: `docs/03_API_CONTRACTS/03_03_REPAIRS_AND_FINANCE_API.md`.

---

## 1. Область

Учёт ремонтов: приёмка оборудования, диагностика, согласование, работы и запчастями, выдача клиенту. Модуль подключаемый: страницы скрыты, API отвечает `403 MODULE_NOT_INSTALLED`, если `service_center` не установлен арендатору.

---

## 2. Маршруты

| Маршрут | Файл |
|---|---|
| `/repairs` | `app/(dashboard)/repairs/page.tsx` |
| `/repairs/[id]` | `app/(dashboard)/repairs/[id]/page.tsx` |

Обе страницы обёрнуты в `<Guard requiredPermission="service_center:read" requiredModule="service_center">`.

---

## 3. Номер заказ-наряда

Формат `ЗН-YYYY-NNNN` (например `ЗН-2026-0042`).

Генерация — таблица `repair_counters` с ключом `(tenant_id, year)`. Upsert `ON CONFLICT DO UPDATE SET last_number = last_number + 1` внутри транзакции приёмки сериализует параллельные запросы, поэтому два наряда не получат один номер. Уникальность закреплена индексом `idx_repair_orders_ticket_number (tenant_id, ticket_number)`.

---

## 4. Статусный маршрут

Шесть шагов основного пути:

```
intake → diagnostics → approval → in_progress → ready → issued
```

`rejected` — терминальный выход (клиент отказался от ремонта), доступен из любого статуса до `ready`.

**Матрица разрешённых переходов** (`backend/src/modules/repairs/repairs.types.ts`):

| Из | В |
|---|---|
| `intake` | `diagnostics`, `rejected` |
| `diagnostics` | `approval`, `rejected` |
| `approval` | `in_progress`, `rejected` |
| `in_progress` | `ready`, `rejected` |
| `ready` | `issued` |
| `issued` | — |
| `rejected` | — |

Попытка недопустимого перехода — `409 INVALID_STATUS_TRANSITION` с перечнем разрешённых вариантов в `details`.

**Побочные эффекты перехода:**

| Переход | Эффект |
|---|---|
| в `approval` | требуется диагностика: либо передана в запросе, либо уже сохранена, иначе `400 VALIDATION_ERROR` |
| в `ready` | ставится `completed_at` |
| в `issued` | ставится `delivered_at`, `final_cost` фиксируется суммой работ и запчастей |
| любой | запись в `repair_notes` с `kind = 'status'`, `from_status`, `to_status` |

Наряды в статусах `issued` и `rejected` закрыты для правок: добавление работ и запчастей отвечает `409 REPAIR_ORDER_CLOSED`.

**Компонент степпера:** `frontend/src/components/repairs/detail/RepairStatusStepper.tsx` — пройденные шаги `emerald`, будущие `slate-800`, кнопка перехода на следующий статус.

---

## 5. Приёмка

Компонент `RepairIntakeModal.tsx`, схема `frontend/src/schemas/repair.schema.ts`.

Состав формы:

- **Клиент:** автокомплит по имени и телефону, выбор из списка, кнопка смены.
- **Оборудование:** тип, бренд, модель, серийный номер.
- **Комплектация:** `package_contents` — что принято вместе с устройством.
- **Внешний вид:** `appearance` — состояние корпуса на момент приёмки.
- **Дефект:** описание, минимум 10 символов.
- **Фото:** превью с возможностью удаления.
- **Оценка:** предварительная стоимость, назначение мастера, приоритет (`low`/`normal`/`high`/`urgent`).

При создании наряда backend в одной транзакции: выделяет номер, пишет наряд, создаёт строки в `repair_photos` для переданных URL, добавляет открывающую запись в `repair_notes` и пополняет справочник `device_models` (`ON CONFLICT DO NOTHING`).

Кнопка «Зарегистрировать и напечатать квитанцию» сразу открывает печатную форму.

---

## 6. Квитанция

Компонент `RepairReceiptModal.tsx`, печать через `window.print()` (`frontend/src/lib/repairs/use-print-receipt.ts`).

Содержимое: штрихкод и номер наряда моноширинным шрифтом, блок клиента, блок оборудования (тип, бренд, модель, серийный номер, комплектация, внешний вид), описание дефекта, свод стоимости (работы + запчасти = итог, маржа), примечания, линии подписей клиента и мастера.

---

## 7. Детальная страница наряда

Верхняя панель: номер, бейдж статуса, кнопки «Печать квитанции», «Создать счёт», «Завершить и выдать». Под ней — степпер.

Левая колонка (320 px): клиент, оборудование, мастер, бюджет и итог.

Четыре вкладки:

| Вкладка | Содержимое | Компонент |
|---|---|---|
| Детали | заметки, даты | — |
| Работы и запчасти | таблицы работ и деталей, финансовый свод | `WorkItemsTable.tsx`, `PartsTable.tsx`, `FinancialSummary.tsx` |
| Диагностика | результаты осмотра | `DiagnosticsPanel.tsx` |
| История и чат | журнал статусов и заметки | заглушка |

Кнопка «Завершить и выдать» появляется только в статусе `ready`.

---

## 8. Работы и запчасти

**Работы** (`repair_works`): описание, мастер, стоимость.

**Запчасти** (`repair_parts`): наименование, артикул, количество, розничная цена, закупочная цена.

**Расчёт** (`calculateTotals` в `repairs.types.ts`):

```
worksTotal       = Σ work.cost
partsRetailTotal = Σ (retailPrice × quantity)
partsCostTotal   = Σ (costPrice   × quantity)
grandTotal       = worksTotal + partsRetailTotal
margin           = grandTotal − partsCostTotal
marginPercent    = margin ÷ grandTotal × 100   (0 при нулевом итоге)
```

Каждая позиция запчасти дополнительно отдаёт `retailTotal`, `costTotal` и собственную `margin`.

Эндпоинты добавления, правки и удаления работ и запчастей возвращают пересчитанные `totals` в `meta`, поэтому интерфейсу не нужен отдельный запрос.

---

## 9. Диагностика

Хранится в `repair_orders.diagnostics` (JSONB): `performed_at`, `performed_by`, `findings`, `recommended_action`, `condition_notes`.

Заполняется при переходе `diagnostics → approval`. `findings` и `recommended_action` обязательны, `condition_notes` — нет. `performed_at` и `performed_by` проставляет сервер.

---

## 10. Заметки, журнал и фото

`repair_notes` совмещает две роли, различаемые полем `kind`:

- `note` — заметка мастера, добавляется вручную;
- `status` — автоматическая запись о смене статуса с `from_status` и `to_status`.

`repair_photos` хранит вложения; при добавлении URL дублируется в денормализованный массив `repair_orders.defect_photos`, который читает список нарядов.

---

## 11. Связь с финансами

Кнопка «Создать счёт» на детальной странице открывает `InvoiceCreateModal` с предзаполненными позициями: каждая работа и каждая запчасть наряда становятся строками счёта.

Backend-аналог — `POST /api/v1/invoices/from-repair/:repairId`. Он подтягивает работы и запчасти, а если их нет, создаёт одну позицию по `estimated_cost`. Реквизиты плательщика по умолчанию берутся из данных клиента наряда. Подробнее — `02_04_MODULE_FINANCE.md`.

---

## 12. Права

| Действие | Требования |
|---|---|
| Чтение нарядов | модуль `service_center` + `service_center:read` |
| Приёмка, правки, статусы, работы, запчасти, заметки, фото | модуль `service_center` + `service_center:write` |

---

## 13. Открытые задачи

- `M2.1.7` — полноценная форма правки наряда.
- `M2.1.9` — компонент истории наряда (журнал статусов, заметки мастеров, сообщения клиента).
- `M2.1.10` — хуки `use-tickets.ts`.
- `M2.1.12` — предпросмотр SMS/e-mail уведомлений.
- `M2.1.13` — канбан-вид очереди нарядов.
- `M2.2.5` — загрузка бинарных файлов (multipart); сейчас принимаются только URL.
- `M2.2.6` — очередь `service_notifications` для уведомлений при смене статуса.
- `M2.2.7` — интеграционные тесты.
