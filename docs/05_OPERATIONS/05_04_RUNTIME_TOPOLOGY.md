# Runtime topology and release identity

Обновлено 2026-10-29. Этот документ описывает фактический production-контур,
проверенный 2026-10-28, и не заменяет секретные значения на VPS.

## Release manifest

Канонический source-файл: `backend/src/release-manifest.json`. Он копируется в
runtime build и импортируется Fastify. `GET /health` возвращает его как `release`.
Рантайм не выполняет `git rev-parse HEAD`: Git checkout на VPS может быть
грязным и не является доказательством версии образа.

Перед release нужно обновить `gitCommit`, `buildId`, `releaseDate`, target
environment и миграционный блок. После сборки внешний health должен вернуть тот
же объект.

## Network topology

```text
Internet
  -> Nginx Proxy Manager (automation-npm-1, SSL termination)
      getvoxly.ru / app.getvoxly.ru -> frontend:3000
      api.getvoxly.ru -> backend:4000
  -> Docker external network: automation_automation_net
```

Nginx Proxy Manager владеет портами 80/443. Host-level `nginx` и systemd units
для GETVOXLY не являются runtime-компонентами. Backend слушает `0.0.0.0:4000`,
frontend — `0.0.0.0:3000`; контейнеры подключаются к внешней сети
`automation_automation_net`.

NPM должен передавать как минимум `Host`, `X-Real-IP`, `X-Forwarded-For` и
`X-Forwarded-Proto`. Fastify включён с `trustProxy: true`, поэтому `request.ip`
и origin-aware логика используют forwarded chain от доверенного прокси.

Для `api.getvoxly.ru` прокси должен сохранять HTTP methods, streaming responses
и upgrade-заголовки для SSE/WebSocket-подобных realtime маршрутов. Буферизацию
для streaming endpoint следует отключать на proxy host; health и обычные JSON
ответы могут обслуживаться стандартно.

## Fastify routes

- `/auth/*` — публичная аутентификация; это фактический канонический prefix.
- `/api/v1/*` — защищённые CRM, finance, channels, AI, admin и tenant routes.
- `/health` — публичный DB/Redis/queue/release readiness endpoint.

`/api/v1/auth/*` не является действующим маршрутом и не должен использоваться в
новых клиентах или документации.

## Redis and BullMQ

Backend получает `REDIS_URL` и fail-closed для durable job enqueue в production,
если Redis не настроен. Зарегистрированные BullMQ queues:

| Queue | Producer/worker | Retry policy |
|---|---|---|
| `lead-notifications` | lead notification service | 3 attempts, exponential backoff, remove completed |
| `kb` | knowledge base queue | 3 attempts, exponential backoff, remove completed |
| `conversion-events` | conversion dispatcher | 5 attempts, exponential backoff, remove completed |

`/health` публикует counts `waiting`, `active`, `completed`, `failed`, `delayed`
and `oldestJobAgeMs` без payload jobs. Tenant id остаётся в job data и проверяется
worker/service перед отправкой; Redis keyspace не используется как замена RLS.

## Database snapshot

Для текущего release manifest зафиксировано:

- PostgreSQL 16 + pgvector 0.8.0;
- 58 applied migrations, 0 pending;
- 57 public tables на production-сверке;
- 41 public RLS policies на production-сверке;
- extensions: `uuid-ossp`, `pgcrypto`, `vector`.
