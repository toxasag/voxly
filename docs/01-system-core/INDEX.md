# 01-system-core — ядро платформы Voxly

Модуль документации: контрольная плоскость (saas-api/saas-worker), мультитенантность, биллинг и AI-баланс, планировщик и блокировки, база данных и миграции.

## Содержимое

| Файл | О чём |
|---|---|
| [system-overview.md](./system-overview.md) | Топология платформы (Mermaid), контейнеры, матрица prod vs local |
| [tenancy-and-isolation.md](./tenancy-and-isolation.md) | Модель тенантов, CRM-блокировка, service-токены, изоляция данных |
| [billing-and-ai-balance.md](./billing-and-ai-balance.md) | Robokassa, подписки/грейс-период, AI-кошелёк и списания |
| [cron-scheduler-locks.md](./cron-scheduler-locks.md) | `withSchedulerLock`, cron-задания, BullMQ-очереди |
| [database-and-migrations.md](./database-and-migrations.md) | Prisma-схема, две Postgres, pgbouncer, миграции, SQL-патчи Twenty |

## Источники истины (код)

- Контрольная плоскость: `apps/saas-api/src/` (вход — `index.ts`, воркер — `worker.ts`)
- Prisma-схема: `packages/db/prisma/schema.prisma`, клиент — `packages/db/src/index.ts`
- Биллинг-клиент: `packages/billing/src/index.ts`
- Общие константы/аутентификация сервисов: `packages/shared/src/`
- AI-начисления: `packages/ai-core/src/index.ts`
- Compose: `docker/docker-compose.yml` + `docker/docker-compose.override.yml`

## Протокол синхронизации

1. Любой новый файл в этом модуле **обязательно** добавляется в таблицу выше (обнови `INDEX.md` в том же коммите).
2. Каждое утверждение в спеках должно опираться на код: путь к файлу + точная сигнатура экспорта. Если сущности в коде нет — прямо написать «в коде отсутствует».
3. При изменении сигнатур/поведения, описанных здесь (например `withSchedulerLock`, `chargeAiUsage`, `evaluateCrmAccess`), обновить соответствующий раздел и проставить дату ревизии в конце файла.
4. Никаких реальных секретов в документах — только плейсхолдеры вида `{{SECRET}}`.
