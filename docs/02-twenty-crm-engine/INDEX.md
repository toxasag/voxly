# 02 — Twenty CRM Engine

> Доменный модуль, описывающий интеграцию с Twenty CRM: воркспейсы, участники, воронки, кэш Redis, дедупликация.

## Содержание

| Файл | Описание |
|------|-----------|
| [`workspace-lifecycle.md`](workspace-lifecycle.md) | Активация воркспейсов, кастомные домены, provisioning |
| [`member-provisioning.md`](member-provisioning.md) | Права, роли, создание и удаление участников |
| [`pipelines-kanban-ru-defaults.md`](pipelines-kanban-ru-defaults.md) | Воронки, стадии сделок, дефолты канбан-карточек, RU-локализация |
| [`redis-cache-invalidation.md`](redis-cache-invalidation.md) | Триггеры сброса кэша Twenty CRM в Redis |
| [`crm-deal-deduplication.md`](crm-deal-deduplication.md) | Транзакционный конвейер дедупликации контактов/сделок |
| [`crm-chat-app-auto-refresh.md`](crm-chat-app-auto-refresh.md) | Авто-обновление voxly-crm-chat во воркспейсах при деплое (tarball hash → force reinstall) |

---

## Протокол синхронизации

При создании, переименовании или удалении файла в этом модуле — **ОБЯЗАТЕЛЬНО** обновить данный `INDEX.md` в том же коммите.
