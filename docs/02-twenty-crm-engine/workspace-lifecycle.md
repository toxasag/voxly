# Workspace Lifecycle

> Активация воркспейсов Twenty CRM, кастомные домены, provisioning.

## Исходные файлы

- `apps/saas-api/src/services/provisioning.ts` — основная логика провижининга
- `apps/saas-api/src/routes/tenant.ts` — эндпоинты управления тенантами
- `apps/saas-api/src/routes/auth.ts` — регистрация с автоматическим provisioning
- `packages/twenty-client/src/index.ts` — HTTP-клиент Twenty CRM
- `docker/twenty.Dockerfile` — билд Twenty с кастомными патчами

## Ключевые функции

### `provisionWorkspace(params: ProvisioningParams)`
```typescript
export interface ProvisioningParams {
  tenantId: string;
  email: string;
  firstName: string;
  lastName?: string;
}
export async function provisionWorkspace(params: ProvisioningParams): Promise<...>
```

**Callers / Inbound:**
- `apps/saas-api/src/routes/auth.ts` — при регистрации нового пользователя
- `apps/saas-api/src/routes/tenant.ts` — при явном создании воркспейса

**Dependencies / Outbound:**
- `@voxly/twenty-client` (`TwentyClient`) — создание workspace через Twenty REST API
- `@voxly/db` (`prisma`) — запись Tenant в control-plane PG

### `buildCrmPublicUrl(crmSubdomain, slug)`
```typescript
function buildCrmPublicUrl(crmSubdomain: string | null | undefined, slug: string): string
```

**Callers:** `apps/saas-api/src/routes/auth.ts`

## Docker-патчи Twenty CRM

| Файл | Назначение |
|------|-----------|
| `docker/patch-twenty-functions-url.cjs` | Подмена URL для logic-функций (voxly-crm-chat → saas-api) |
| `docker/patch-twenty-front-component-url.cjs` | URL фронтенд-компонентов |
| `docker/patch-twenty-file-base64.cjs` | Запрет Base64 в Postgres |
| `docker/patch-twenty-workspace-limit.cjs` | Лимит на создание воркспейсов |
| `docker/patch-evolution-lid-pn.cjs` | Evolution API LID/PN совместимость |
| `docker/twenty-cabinet-link.js` | Ссылка на кабинет в UI |
| `docker/twenty-deal-chat.js` | Чат-виджет в сделке |
| `docker/twenty-shell-ux.js` | UX кастомизация shell |

Патчи применяются в `docker/twenty.Dockerfile` на этапе `RUN`.

## SQL-патчи

| Файл | Назначение |
|------|-----------|
| `docker/set-workspace-nav-order.sql` | Порядок навигации в воркспейсе |
| `docker/set-chat-tab-position.sql` | Позиция вкладки чатов |
| `docker/set-opportunity-kanban-default.sql` | Дефолт канбан-отображения для сделок |
| `docker/set-opportunity-kanban-card-defaults.sql` | Дефолт полей карточек канбан |
| `docker/dedupe-cabinet-nav.sql` | Дедупликация элементов навигации |

## Инварианты безопасности

- Воркспейс создаётся только после аутентификации пользователя.
- CRM-субдомен уникален на уровне БД (unique constraint).
- Патчи Twenty в VCS — воспроизводимость билда гарантирована.

## Риски поломки

- **Обновление Twenty** (major version) может сломать патчи — проверять на staging.
- **DNS-propagation delay** для кастомных доменов — доступен по fallback URL.
