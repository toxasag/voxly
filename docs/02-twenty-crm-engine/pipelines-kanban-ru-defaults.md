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

## Глобальный шаблон карточки (2026-08-16)

`OPPORTUNITY_KANBAN_CARD_FIELDS` в `packages/twenty-client/src/index.ts` — schema-independent шаблон для каждого нового workspace. Поля по умолчанию:

`name`, `createdAt`, `amount`, `updatedAt`, `createdBy`, `closeDate`, `company`, `pointOfContact`, `taskTargets`, `noteTargets`.

`updatedAt` добавлен после `amount` (position `1.5`, size `100`). Нельзя копировать UUID view/field из конкретного тенанта; provisioning разрешает поля по стабильным metadata names. После прямых metadata SQL-изменений обязательны `metadataVersion++` и `flushTwentyWorkspaceRedisCache`.

## Provisioning invariant

`OPPORTUNITY_KANBAN_CARD_FIELDS` is the single ID-independent source of truth for new portals. Current intended card fields include `updatedAt`; changes require a template test and the normal provisioning/reapply sequence plus metadata version/cache flush.
