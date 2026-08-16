# Cron, Scheduler & Locks — фоновые задания и распределённые блокировки

Дата ревизии: 2026-08-16.

## 1. Архитектура

Два механизма, оба стартуют и в `saas-api` (`apps/saas-api/src/index.ts:299` → `startScheduledJobs()`), и в standalone-воркере `saas-worker` (`apps/saas-api/src/worker.ts:20`):

1. **Cron (`setInterval` + Redis NX lock)** — `apps/saas-api/src/jobs/scheduler.ts`.
2. **BullMQ очереди** — `apps/saas-api/src/jobs/queues.ts` (воркеры отключаются `VOXLY_DISABLE_WORKERS=1`, строка 25).

Поскольку cron запускается в обоих процессах (api + worker), корректность при нескольких репликах обеспечивает Redis-лок.

## 2. `withSchedulerLock` (`apps/saas-api/src/jobs/scheduler-lock.ts`)

```ts
export async function withSchedulerLock(
  jobName: string,
  ttlSeconds: number,
  fn: () => Promise<void>,
): Promise<'ran' | 'skipped' | 'unlocked-error'>

/** Test helper — closes the lazy Redis connection. */
export async function closeSchedulerLockRedis(): Promise<void>
```

Механика:

- Ключ `voxly:scheduler:lock:${jobName}`; `SET key token EX ttl NX`, token = `${pid}-${Date.now()}-${random}`.
- `NX` не сработал → `'skipped'` (задание выполняет другой процесс).
- Redis недоступен → **fail-open**: задание выполняется без лока, возврат `'unlocked-error'` (строки 38-42) — локальная разработка без Redis продолжает работать.
- После `fn()` — освобождение только если значение ключа всё ещё наше (`GET`+сравнение+`DEL`, строка 49-50); otherwise TTL истечёт сам.
- Отдельный lazy-коннект IORedis (`maxRetriesPerRequest: 1`, `enableOfflineQueue: false`), `REDIS_URL` default `redis://localhost:6379`.

**Callers (grep):** только `safeJob`-обёртка в `apps/saas-api/src/jobs/scheduler.ts:14` и тест `apps/saas-api/tests/scheduler-lock.test.ts`.

## 3. Cron-задания (`startScheduledJobs`, `apps/saas-api/src/jobs/scheduler.ts:20`)

| jobName | Интервал | TTL лока | Действие |
|---|---|---|---|
| `check-expired-subscriptions` | 1ч (+разовый через 10с) | 50 мин | истечение триалов/подписок, suspend после грейса 7д, `syncTwentyCrmLock`, expire аддонов (`scheduler.ts:120-198`) |
| `notify-expiring-subscriptions` | 24ч | 20 ч | `notifyExpiringSubscriptions(prisma, { days: 3, kind: 'both' })` (Telegram-напоминания) |
| `platform-broadcasts` | 30с | 50 с | `processDuePlatformBroadcasts(prisma)` |
| `check-ai-wallet-alerts` | 6ч | 5 ч | алерты по `balanceRub <= 100` (email — TODO в коде, `scheduler.ts:212`) |
| `ingest-won-deals` | 10 мин (+разовый 45с) | 8 мин | `ingestWonDealsAllTenants()` — AI sales learning |
| `sync-gift-campaign-schedules` | 60с (+разовый 15с) | 50 с | включение/выключение Gift-кампаний по `scheduledStartAt/scheduledEndAt`, максимум 5000 строк |
| `release-stale-balance-holds` | 1ч (+разовый 30с) | 50 мин | `releaseBalanceHold` по pending-платежам старше 24ч с `balanceAppliedRub > 0` |

Все таймеры обёрнуты `safeJob` (строки 12-18): исключения и unhandled rejections гасятся в `console.warn`. Экспорт: `startScheduledJobs()`, `stopScheduledJobs()` (очистка интервалов).

## 4. BullMQ (`apps/saas-api/src/jobs/queues.ts`)

Очереди (строки 27-31): `provisioning`, `email`, `subscription`, `form-leads`, `gramjs-crm-enrich`. Воркеры экспортируются как `provisioningWorker`, `emailWorker`, `formLeadWorker`, `gramjsCrmEnrichWorker` + из `@voxly/ai-core`: `startAiUsageWorker`, `startTimelineSyncWorker` → `aiUsageWorker`, `timelineSyncWorker` (см. `apps/saas-api/src/worker.ts:8-14`). Connection — общий `IORedis(REDIS_URL, { maxRetriesPerRequest: null })`.

Типы job data:

```ts
export interface ProvisioningJobData { tenantId: string; ownerEmail: string; ownerPasswordEncrypted: string; ownerFirstName?: string; workspaceName: string; slug: string; }
export interface EmailJobData { to: string; subject: string; body: string; isHtml?: boolean; }
export interface FormLeadJobData { formLeadId: string; }
export interface GramjsCrmEnrichJobData { tenantId: string; botId: string; limit?: number; }
```

Про `provisioningQueue` — см. [tenancy-and-isolation.md](./tenancy-and-isolation.md).

## 5. Инварианты

1. TTL лока всегда **меньше** интервала (например 50 мин при интервале 1ч) — не бывает ситуации «лок жив, а тик уже пришёл» → пропуск.
2. Fail-open — осознанный компромисс: без Redis задания не теряются, но при N процессах без Redis возможны дубли (важно для `platform-broadcasts` с TTL 50с).
3. Идемпотентность на стороне эффектов: биллинговые операции защищены `idempotencyKey`/`usageChargeKey`/advisory-lock (см. [billing-and-ai-balance.md](./billing-and-ai-balance.md)), поэтому даже дубль выполнения cron безопасен для денег.
4. `stopScheduledJobs` вызывается только в тестах; в prod процессы завершаются по SIGTERM/SIGINT (`worker.ts:35-44`, `prisma.$disconnect`).

## 6. Риски

- Изменение интервала задания без пропорционального изменения TTL ломает инвариант (1).
- Redis с `allkeys-lru` (prod) может вытеснить ключ лока до истечения TTL → второй процесс выполнит задание (не critical для идемпотентных эффектов).
- Добавление нового cron только в `worker.ts`-процесс невозможно — `startScheduledJobs` общий; флаг `VOXLY_DISABLE_WORKERS` выключает только BullMQ-воркеры, **не** cron (он живёт в `scheduler.ts` и стартует всегда).
