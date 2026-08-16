# CRM Chat App Auto-Refresh

> Авто-обновление приложения voxly-crm-chat во всех воркспейсах при смене tarball в образе saas-api (deploy).

## Контекст проблемы (инцидент 2026-08-16)

Twenty устанавливает private-registry приложение **один раз** при provisioning воркспейса и далее отдаёт собранный бандл (front/logic) из `local-storage` бесконечно. При деплое нового образа saas-api (с новым запечённым tarball) существующие воркспейсы продолжали отдавать **старый UI чата** — пропадали селектор канала «Пишем от:» и write-first.

Диагностика по хэшам:
- tarball в образе: `sha1(chat-panel.mjs) = aa1eb735…` (актуальный);
- бандл в воркспейсе: `ebdc05d4…` (устаревший, поставлен 14.08 из тогдашнего образа).

## Исходные файлы

- `apps/saas-api/src/services/crm-chat-app-auto-refresh.ts` — сервис авто-обновления (новый)
- `apps/saas-api/src/worker.ts` — вызов при старте saas-worker
- `apps/saas-api/src/services/purge-tenant.ts` — `refreshCrmChatAppForTenant` (переиспользуется)
- `apps/saas-api/tests/crm-chat-app-refresh.test.ts` — юнит-тесты чистой логики
- `apps/saas-api/Dockerfile` — стейдж `crm-chat-tarball` (запекает `/voxly/assets/voxly-crm-chat.tgz`)

## Экспортируемые функции

```typescript
export type AutoRefreshResult =
  | 'no-tarball' | 'skipped' | 'ran' | 'partial' | 'unlocked-error';

export function shouldRefreshApp(
  storedSha1: string | null,
  tarballSha1: string | null,
): boolean;

export function shouldPersistMarker(results: { ok: boolean }[]): boolean;

export async function readTarballSha1(path: string): Promise<string | null>;
export async function readInstalledTarballSha1(): Promise<string | null>;
export async function persistInstalledTarballSha1(sha1: string): Promise<void>;
export async function closeAutoRefreshRedis(): Promise<void>;

export async function refreshCrmChatAppsIfTarballChanged(): Promise<AutoRefreshResult>;
```

## Callers / Inbound

- `apps/saas-api/src/worker.ts` — при старте saas-worker (fire-and-forget, ошибки не роняют boot).
- `refreshCrmChatAppForTenant` (внутри) вызывается также из `apps/saas-api/src/routes/admin.ts:488` — `POST /api/admin/tenants/:id/refresh-crm-chat` (ручной форс-рефреш, superadmin).

## Dependencies / Outbound

- `@voxly/db` (`prisma`) — список тенантов (`twentyWorkspaceId` + `twentyOwnerPasswordEncrypted` не null).
- `./purge-tenant.js` → `TwentyClient.ensureCrmChatAppInstalled({ forceReinstall: true })` — реинсталл per-workspace + загрузка tarball в private registry + INC-116 патч `__typename`.
- Redis (`voxly:crmchat-app:tarball-sha1`) — маркер установленного хэша; `withSchedulerLock('crmchat-app-refresh', 900)` — защита от параллельного прогона репликами.

## Алгоритм

1. sha1 запечённого tarball (`VOXLY_CRM_CHAT_TARBALL`) ≠ маркеру в Redis → запуск.
2. Scheduler-lock → для каждого провижененного тенанта `refreshCrmChatAppForTenant` (auth под owner → uninstall/install → переменные приложения → INC-116 патч).
3. Все OK → маркер сохраняется; любая ошибка → маркер НЕ пишется, ретрай при следующем старте воркера.

## Гарантия покрытия

- **Новый портал:** `runProvisioningJob` всегда читает tarball из образа `saas-api` и вызывает `ensureCrmChatAppInstalled({ forceReinstall: true })`; новый workspace сразу получает текущий CRM Chat (front components + logic functions).
- **Существующий портал:** при следующем старте `saas-worker` `refreshCrmChatAppsIfTarballChanged()` сравнивает sha1 tarball с Redis-маркером и force-reinstall'ит приложение во всех provisioned workspace.
- **Обязательный deploy coupling:** любое изменение `twenty-app/voxly-crm-chat/`, CRM-chat API или `packages/twenty-client` требует `./scripts/prod-deploy.sh saas-api,saas-worker`. В противном случае новый tarball может не попасть в образ или старые workspace не обновятся.

## Инварианты

- **После каждого реинсталла** (авто-рефреш/ручной refresh-crm-chat) виджет-конфиги патчатся (`__typename`) И сбрасывается flat-map кэш workspace (`flushTwentyWorkspaceRedisCache`) — install-миграция кэширует непатченые конфиги ДО патча, бамп версии их не удаляет (INC-129). Лог: `[crmchat-refresh] flat-map cache flushed … keysDeleted=N`.

- Реинсталл идемпотентен и безопасен для повтора.
- Изменение контракта `ensureCrmChatAppInstalled` синхронно с `packages/twenty-client`.
- Тенанты без `twentyOwnerPasswordEncrypted` исключаются из выборки (иначе вечный retry-цикл).

## Риски

- Массовый реинсталл на большом числе воркспейсов удлиняет boot воркера (последовательно) — при росте добавить батчинг/приоритизацию.
- Если Redis недоступен, lock fail-open → реинсталл может выполниться параллельно репликами (перекрывается tolerable-duplicate логикой клиента).

## Rollback Plan

1. `git revert <commit>` правок `crm-chat-app-auto-refresh.ts` + `worker.ts`.
2. Удалить маркер: `redis-cli DEL voxly:crmchat-app:tarball-sha1` (необязательно).
3. Ручной канал обновления остаётся: `POST /api/admin/tenants/:id/refresh-crm-chat`.
