# Database & Migrations — БД, pgbouncer, миграции

Дата ревизии: 2026-08-16.

## 1. Две базы данных

| БД | Прод (хост `150.241.98.135`, `/opt/voxly`) | Local (compose) | Назначение |
|---|---|---|---|
| postgres-control | `127.0.0.1:5433` | `docker/docker-compose.yml:53-61` (`5433:5432`, postgres:16-alpine) | контрольная плоскость: Prisma `packages/db/prisma/schema.prisma` |
| pgbouncer-control | edoburu `v1.25.2-p0`, **transaction mode** | `docker-compose.yml:78` | пул соединений saas-api/saas-worker к postgres-control |
| postgres-twenty | `127.0.0.1:5434` | `docker-compose.yml:110-117` | данные Twenty CRM (workspace-данные тенантов) |

**Кросс-БД транзакций нет.** Двухфазные операции (например provisioning: запись `Tenant.twentyWorkspaceId` в control + workspace в twenty) компенсируются кодом, а не транзакцией. Это главный источник рассинхрона при падениях посередине.

### pgbouncer transaction mode — ограничения

- Сессионные фичи Postgres (`SET`, `LISTEN/NOTIFY`, temp tables, advisory-lock уровня сессии) непредсказуемы. В коде используется только `pg_advisory_xact_lock(87236401)` (`apps/saas-api/src/routes/billing.ts:1123`) — транзакционный, что корректно для transaction pooling.
- `SELECT ... FOR UPDATE` (`packages/ai-core/src/index.ts:207-209`) живёт внутри `prisma.$transaction` — совместимо.

## 2. Prisma-клиент (`packages/db`)

`packages/db/src/index.ts`:

```ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export { prisma };
export default prisma;
export * from '@prisma/client';
export { upsertCrmRecordLink } from './crm-link.js';
```

Синглтон на процесс; строка подключения — стандартный `DATABASE_URL` (через pgbouncer в prod). Seed: `packages/db/prisma/seed.ts`.

## 3. Схема (выборка ключевых моделей)

`packages/db/prisma/schema.prisma`:

- `Tenant` (строка 22): `slug @unique`, `portalHost @unique`, `twentyWorkspaceId`, `twentyOwnerPasswordEncrypted`, `status TenantStatus @default(trial)`, `aiMarkupPercent Int?`, `timelineSyncEnabled Boolean @default(true)`.
- `TenantMember` (99): `@@unique([tenantId, userId])`, `role UserRole`, `twentyPasswordEncrypted`.
- `Subscription` (118): `productCode`, `periodMonths Int` (0 = триал), `startsAt/endsAt`, `status @default("active")`.
- `Payment` (139): `robokassaInvId Int @unique`, `amount Decimal(10,2)`, `balanceAppliedRub Decimal(10,2) @default(0)`, `idempotencyKey String @unique`, `shpTenantId`, `fiscalReceipt Json?`.
- `AiWallet` (194): `tenantId @unique`, `balanceRub Decimal(10,2)`.
- `AiUsageLog` (206): `tokens Int`, `providerCostRub Decimal(10,4)`, `markupPercent Int`, `chargedRub Decimal(10,4)`, `uncollectedRub Decimal(10,4)?`, `channel String?`, `usageChargeKey String? @unique`, индекс `@@index([tenantId, channel, createdAt])`.
- Прочее: `Addon`, `TenantBalance`, `BotInstance`, `GiftCampaignConfig`, `GiftSubscriber`, `ReferralCode`/`Referral`/`ReferralEarning`, `AnalyticsIntegration`, `TrackingLink`, `AiAgent`, `PlatformSetting`.

## 4. Миграции

- Каталог: `packages/db/prisma/migrations/` (стандартные Prisma-миграции), `migration_lock.toml`.
- Диапазон: `20260723144500_conversation_ai_handoff` … `20260816000000_chat_message_from_me` (35 миграций на момент ревизии).
- Управление — обычным `prisma migrate` (отдельных CI-скриптов миграций в репо не обнаружено; `scripts/` содержит утилиты, миграционного пайплайна там нет).

## 5. SQL-патчи Twenty (вне Prisma)

Прямые SQL/JS-патчи к БД twenty (применяются вручную/при сборке, каталог `docker/`):

| Файл | Назначение |
|---|---|
| `docker/dedupe-cabinet-nav.sql` | дедуп навигации кабинета |
| `docker/set-chat-tab-position.sql` | позиция chat-таба |
| `docker/set-opportunity-kanban-default.sql`, `docker/set-opportunity-kanban-card-defaults.sql` | дефолты канбана |
| `docker/set-workspace-nav-order.sql` | порядок навигации workspace |
| `docker/twenty-cabinet-link.js`, `docker/twenty-deal-chat.js`, `docker/twenty-shell-ux.js` | UI-патчи Twenty |
| `docker/patch-twenty-*.cjs` | патчи file-base64, front-component-url, functions-url, workspace-limit |
| `docker/patch-evolution-lid-pn.cjs` | патч evolution-api |

Аналогичные runtime-операции из кода: `ensureTwentyCustomDomain`, `ensureOpportunityRuDefaults`, `ensureOpportunityKanbanCardDefaults`, `clearTwentyOnboardingFlags`, `ensureWorkspaceNavOrder`, `flushTwentyWorkspaceRedisCache` (`apps/saas-api/src/services/`), вызываются при provisioning (`apps/saas-api/src/jobs/queues.ts:82-120`).

## 6. Redis

`redis:7-alpine` (local, `docker-compose.yml:130`), prod — redis 7 на `127.0.0.1:6379`, appendonly, `maxmemory 1gb`, `allkeys-lru`. Использование: BullMQ-очереди (`apps/saas-api/src/jobs/queues.ts`), scheduler-локи (`scheduler-lock.ts`), кэш Twenty (`packages/shared/src/crm-thread-cache.ts`, `crm-unread-cache.ts`, flush — `apps/saas-api/src/services/twenty-redis-flush.ts`).

## 7. Инварианты и риски

1. **Уникальности на уровне БД** (`robokassaInvId`, `idempotencyKey`, `usageChargeKey`, `tenantId` в AiWallet) — последний барьер идемпотентности; удаление unique-констрейнта в миграции ломает защиту от дублей.
2. Денежные поля — `Decimal` (не Float); конвертация через `Number(...)` в коде допустима только для чтения/отчётов.
3. **Migration drift**: новых поля схемы требуют одновременного деплоя saas-api + saas-worker (один и тот же пакет `@voxly/db`).
4. **SQL-патчи Twenty не версионируются Prisma** — при пересборке образа `voxly-twenty` их нужно применять заново (проверь Dockerfile/скрипты сборки перед релизом).
5. pgbouncer transaction mode: новое использование сессионного SQL (`SET`, advisory session locks, `LISTEN`) будет ломаться — только транзакционные конструкции.
6. Прямые записи в `postgres-twenty` в обход GraphQL (сервисы `twenty-*`) обходят бизнес-логику Twenty — при апгрейде форка Twenty (текущий `2.22.0`) эти SQL/JS-патчи нужно ревизировать первыми.
