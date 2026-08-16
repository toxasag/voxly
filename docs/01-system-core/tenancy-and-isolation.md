# Tenancy & Isolation — мультитенантность и изоляция

Дата ревизии: 2026-08-16. Все сигнатуры скопированы из кода.

## 1. Модель тенанта

Prisma-модель `Tenant` (`packages/db/prisma/schema.prisma:22`):

```prisma
model Tenant {
  id                String         @id @default(cuid())
  slug              String         @unique
  portalHost        String         @unique // {slug}.getvoxly.ru
  twentyWorkspaceId String?        // set after provisioning
  twentyWorkspaceSlug String?      // subdomain for {slug}-crm
  twentyOwnerPasswordEncrypted String? // random Twenty credential for SSO, AES-256-GCM
  crmSubdomain      String?        // {slug}-crm
  status            TenantStatus   @default(trial)
  aiMarkupPercent   Int?           // override global markup for this tenant
  timelineSyncEnabled Boolean      @default(true)
  ...
}
```

Изоляция реализована **двумя способами** в зависимости от данных:

1. **CRM-данные** — физически в отдельной БД Twenty (`postgres-twenty`), тенант = workspace Twenty (`twentyWorkspaceId`). Изоляция на уровне приложения Twenty.
2. **Контрольные данные** (подписки, платежи, боты, AI, рефералы) — общая таблица в `postgres-control` со строковым `tenantId` (FK на `Tenant`), фильтрация на уровне каждого запроса в saas-api.

Точка сопоставления workspace → tenant: `prisma.tenant.findFirst({ where: { twentyWorkspaceId } })` (`apps/saas-api/src/index.ts:212-215`).

## 2. Провижининг тенанта

`apps/saas-api/src/services/provisioning.ts`:

```ts
export async function provisionWorkspace(params: ProvisioningParams)
```

Вызывается из `apps/saas-api/src/routes/auth.ts:243` (синхронно при регистрации). Тяжёлый путь — через BullMQ-очередь `provisioning`:

```ts
export interface ProvisioningJobData {
  tenantId: string;
  ownerEmail: string;
  ownerPasswordEncrypted: string;
  ownerFirstName?: string;
  workspaceName: string;
  slug: string;
}
// apps/saas-api/src/jobs/queues.ts:351
await provisioningQueue.add('provision-workspace', data, { ... });
```

Воркер `runProvisioningJob` (`apps/saas-api/src/jobs/queues.ts:90+`): создание workspace в Twenty → `ensureTwentyCustomDomain` (SQL, т.к. GraphQL-путь требует CLOUDFLARE_API_KEY — INC-031) → `ensureOpportunityRuDefaults` → `ensureOpportunityKanbanCardDefaults` → `clearTwentyOnboardingFlags` → установка приложения voxly-crm-chat из приватного registry. Пароль владельца Twenty хранится зашифрованным (AES-256-GCM, `packages/crypto`: `encrypt`/`decrypt`/`encryptJSON`/`decryptJSON`/`generateSecret`).

Полнное удаление: `apps/saas-api/src/services/purge-tenant.ts` — `export async function purgeTenantFully(opts: {...})` (строка 136).

## 3. Идентификация тенанта в запросах (Inbound)

`apps/saas-api/src/index.ts:196-241` — декоратор `fastify.decorate('authenticate', ...)` поддерживает два механизма:

1. **Service-токен** (Twenty-приложение / внутренние сервисы): `Authorization: Bearer <token>` верифицируется `verifyServiceToken(bearer, 'saas-api')`; тенант берётся из заголовка `X-Twenty-Workspace-Id` → lookup `Tenant.twentyWorkspaceId`. Без заголовка — 401 `'X-Twenty-Workspace-Id required for service token'`.
2. **Portal JWT** (`request.jwtVerify()`): `request.user.tenantId` из payload токена.

Сигнатуры из `packages/shared/src/service-auth.ts`:

```ts
export function serviceTokenEnvName(service: string): string
export function resolveServiceToken(targetService: string): string
export function timingSafeEqualStr(a: string, b: string): boolean
export function extractBearer(authorizationHeader: string | null | undefined): string
export function verifyServiceToken(presentedToken: string | null | undefined, selfService: string): boolean
```

`verifyServiceToken` принимает персональный `VOXLY_TOKEN_SAAS_API` **или** общий `VOXLY_SERVICE_TOKEN` (миграционный fallback); сравнение constant-time по всем кандидатам без early-exit.

## 4. CRM-блокировка (доступ при неоплате)

`apps/saas-api/src/services/crm-access.ts`:

```ts
export async function loadCrmAccessForTenant(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<{ tenant: { id: string; status: string; twentyWorkspaceId: string | null } | null; evaluation: CrmAccessEvaluation }>

export async function assertCrmAccessAllowed(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<CrmAccessEvaluation | null>

export async function syncTwentyCrmLock(
  twentyWorkspaceId: string | null | undefined,
  lock: boolean,
): Promise<void>
```

Общие правила — `packages/shared/src/index.ts:265`:

```ts
export function evaluateCrmAccess(opts: {
  tenantStatus: string;
  crmSubscription: CrmSubscriptionSnapshot | null | undefined;
  now?: Date;
  gracePeriodDays?: number;
}): CrmAccessEvaluation
```

`GRACE_PERIOD_DAYS = 7`, `TRIAL_PERIOD_DAYS = 7` (`packages/shared/src/index.ts:225-226`).

**Inbound (grep по вызовам `assertCrmAccessAllowed`):** декоратор `authenticate` в `apps/saas-api/src/index.ts` (строки 180-241) — для service-токенов всегда, для portal-JWT только на путях `/crm/chat` (`isCrmChatRequest`, `path.includes('/crm/chat')`).

**Outbound:** `syncTwentyCrmLock` → `setTwentyWorkspaceActivation(workspaceId, 'INACTIVE' | 'ACTIVE')` (`apps/saas-api/src/services/twenty-workspace-activation.ts`) — обратимая блокировка прямого email/password-входа в Twenty. Вызывается из cron `checkExpiredSubscriptions` (`apps/saas-api/src/jobs/scheduler.ts:165,183`).

## 5. Инварианты безопасности

1. **Никаких запросов к контрольным таблицам без `tenantId` в `where`** — фильтрация выполняется вручную в каждом route-handler (автоматического RLS в Prisma-схеме нет — в `packages/db/prisma/schema.prisma` отсутствуют `RLS`/политики;изоляция = дисциплина кода). Нарушение = утечка данных между тенантами.
2. Service-токен без `X-Twenty-Workspace-Id` не аутентифицирует (401) — нельзя «угадать» тенант без известного workspaceId.
3. `twentyOwnerPasswordEncrypted` / `TenantMember.twentyPasswordEncrypted` — только в зашифрованном виде; ключ `packages/crypto` (env-based).
4. `requireSuperadmin` (`apps/saas-api/src/index.ts:243-252`) — отдельный декоратор для `/api/admin/*`; проверка `request.user.role !== 'superadmin'` → 403.
5. CORS: только `{VOXLY_DOMAIN}`, его поддомены и localhost (`isAllowedCorsOrigin`, `apps/saas-api/src/index.ts:48-53`).

## 6. Риски поломки

- Добавление нового route без фильтра по `tenantId` или без `authenticate` — прямая утечка. Ревью обязательно проверяет `where: { tenantId }`.
- Portal-JWT CRM-лок проверяется только на `/crm/chat` — остальные tenant-роуты должны сами вызывать `assertCrmAccessAllowed`, если доступ к CRM-данным критичен.
- Смена формата `request.user` (поле `tenantId`) сломает все route-handlers — используется повсеместно.
- Удаление/переименование env `VOXLY_TOKEN_SAAS_API` без вывода из эксплуатации fallback `VOXLY_SERVICE_TOKEN` оставит старый общий токен валидным (он проверяется вторым кандидатом).

## 7. Что отсутствует

- Row-Level Security на стороне Postgres — **не реализовано** (нет в схеме/миграциях).
- Отдельная БД/схема на тенанта в control-plane — **нет**, только общие таблицы с `tenantId`.
