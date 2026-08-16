# Redis Cache Invalidation

> Триггеры сброса кэша Twenty CRM в Redis.

## Исходные файлы

- `apps/saas-api/src/services/twenty-redis-flush.ts`
- `apps/saas-api/src/routes/admin.ts`
- `apps/saas-api/src/jobs/queues.ts`
- `packages/twenty-client/src/index.ts`

## Ключевые функции

### `flushTwentyWorkspaceRedisCache(params)`
```typescript
export async function flushTwentyWorkspaceRedisCache(params: {
  workspaceId: string;
  twentyApiKey: string;
  twentyServerUrl: string;
}): Promise<void>
```

**Callers / Inbound:**
- `apps/saas-api/src/routes/admin.ts` — ручной flush
- `apps/saas-api/src/jobs/queues.ts` — при обновлениях контактов/сделок
- `apps/saas-api/src/routes/crm-chat.ts` — при изменении чат-данных

## Триггеры flush

| Событие | Источник |
|---------|----------|
| Обновление контакта | BullMQ job после CRM-enrich |
| Создание/изменение сделки | BullMQ job после dedupe |
| Ручной flush | Админ-эндпоинт `/admin/flush-cache` |
| Изменение участника | After member provision/delete |

## Инварианты

- Flush scoped по `workspaceId` — не затрагивает чужие воркспейсы.
- Админ-эндпоинт защищён сервисным токеном.

## Риски

- **Race condition**: flush до завершения записи → stale data.
- **Redis restart**: кэш пуст, данные реконструируются из PG с задержкой.
