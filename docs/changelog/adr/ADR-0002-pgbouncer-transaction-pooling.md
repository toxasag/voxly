# ADR-0002: PgBouncer Transaction Pooling в front of Control Plane PG

## Status

Accepted

## Context

Control plane PostgreSQL обслуживала 8 сервисов напрямую:
- saas-api, saas-worker, ai-telegram-worker, ai-whatsapp-worker
- gramjs-bridge, platform-bot-service, gift-bot-worker, manager-bot-service

Каждый сервис держал пул Prisma-клиентов → суммарное количество соединений
превышало `max_connections` PostgreSQL. При скачках нагрузки соединения
исчерпывались, новые запросы отклонялись.

## Decision

Внедрён **PgBouncer** (edoburu/pgbouncer:v1.25.2-p0) в режиме **transaction pooling**
перед postgres-control:

```
сервисы → pgbouncer-control:5432 (transaction mode) → postgres-control:5432
```

Конфигурация:
- `POOL_MODE: transaction`
- `MAX_CLIENT_CONN: 1000`
- `DEFAULT_POOL_SIZE: 25`
- `MIN_POOL_SIZE: 5`
- `RESERVE_POOL_SIZE: 5`
- `AUTH_TYPE: scram-sha-256`

Ограничения:
- Миграции Prisma используют `DIRECT_DATABASE_URL` (bypass pgbouncer),
  т.к. transaction mode не поддерживает DDL, advisory locks, session state.
- Twenty PG **не** подключена через pgbouncer (TypeORM + raw pg prepared statements).

## Consequences

### Позитивные
- Емкость соединений увеличена с ~100 до 1000+ клиентов.
- Стабильность при пиковых нагрузках.

### Негативные
- Advisory locks (`pg_advisory_xact_lock`) не работают через pgbouncer.
- Необходим `DIRECT_DATABASE_URL` для миграций.
- `SERVER_RESET_QUERY: DISCARD ALL` сбрасывает session state между транзакциями.

### Мониторинг
- Healthcheck: `pg_isready -h 127.0.0.1 -p 5432 -U voxly`

## References

- Commit: `78c3841` (feat(infra): 6.2 pgBouncer transaction mode)
- Docs: `docs/01-system-core/database-and-migrations.md`
- Docs: `docs/01-system-core/cron-scheduler-locks.md`
