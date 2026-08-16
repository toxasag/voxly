# CRM Enrich Contracts

> Обогащение контактов, телефонов и лидов из внешних источников.

## Исходные файлы

- `apps/saas-api/src/routes/crm-enrich-internal.ts` — внутренние эндпоинты обогащения
- `apps/saas-api/src/services/telegram-crm-enrich.ts` — обогащение из Telegram данных
- `apps/saas-api/src/services/form-lead-parse.ts` — парсинг лидов из форм
- `apps/saas-api/src/services/form-lead-process.ts` — обработка лидов

## Ключевые типы и функции

### `runTelegramCrmEnrich(opts)`
```typescript
export type EnrichTarget = { /* target person/contact data */ };
export type EnrichResultRow = { /* enriched result */ };
export type EnrichRunSummary = { /* summary of enrich run */ };

export async function runTelegramCrmEnrich(opts: {
  tenantId: string;
  workspaceId: string;
  twentyApiKey: string;
  twentyServerUrl: string;
  // ...
}): Promise<EnrichRunSummary>
```

**Callers / Inbound:**
- `apps/saas-api/src/routes/admin.ts` — ручной запуск из админки
- `apps/saas-api/src/jobs/queues.ts` — по расписанию (BullMQ job)

**Dependencies / Outbound:**
- `@voxly/twenty-client` — чтение/запись Person в Twenty CRM
- `@voxly/db` — обновление статусов обогащения

## Ключевые эндпоинты crm-enrich-internal.ts

```typescript
function requireService(request: { headers: Record<string, unknown> }, reply: ...): void

export const crmEnrichInternalRoutes: FastifyPluginAsync = async (fastify) => { ... }
```

## Инварианты безопасности

- Scoped по `tenantId` и `workspaceId`.
- Внутренние эндпоинты защищены сервисным токеном.
