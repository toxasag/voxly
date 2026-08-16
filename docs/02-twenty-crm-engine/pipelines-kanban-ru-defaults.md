# Pipelines, Kanban & RU Defaults

> Воронки продаж, стадии сделок, дефолты канбан-карточек, RU-локализация.

## Исходные файлы

- `apps/saas-api/src/services/twenty-opportunity-ru-defaults.ts` — RU-дефолты воронок
- `docker/set-opportunity-kanban-default.sql`
- `docker/set-opportunity-kanban-card-defaults.sql`
- `packages/twenty-client/src/index.ts`

## Описание

Модуль устанавливает RU-локализованные стадии воронки для новых воркспейсов:
- Стадии: «Первый контакт» → «Квалификация» → «Презентация» → «Переговоры» → «Закрытие»
- Kanban-карточки: аватар, телефон, сумма, стадия

**Callers / Inbound:** `apps/saas-api/src/services/provisioning.ts` (при provisioning воркспейса)

**Dependencies / Outbound:** `@voxly/twenty-client` (Twenty REST API)

## SQL-патчи

| Файл | Действие |
|------|----------|
| `set-opportunity-kanban-default.sql` | UPSERT дефолтного Kanban-вида для opportunity pipeline |
| `set-opportunity-kanban-card-defaults.sql` | Дефолтные поля карточек (имя, телефон, сумма) |
| `set-workspace-nav-order.sql` | Навигация: Контакты → Сделки → Чаты → ... |
| `set-chat-tab-position.sql` | Позиция вкладки чатов |

## Инварианты

- SQL-патчи идемпотентны (UPSERT / DO UPDATE).

## Риски

- **Обновление Twenty** может изменить схему opportunity — патчи сломаются.
- **Мультиязычность** — RU hardcoded, для других языков нужен extension.
