# CRM Deal Deduplication

> Транзакционный конвейер дедупликации контактов и сделок.

## Исходные файлы

- `apps/saas-api/src/services/crm-deal-dedupe.ts`
- `apps/saas-api/src/routes/crm-chat.ts`
- `apps/saas-api/src/services/form-lead-process.ts`
- `apps/saas-api/src/routes/forms.ts`

## Ключевые функции

### `runCrmSaveDedupe(opts)`
```typescript
export type CrmSaveDedupeResult = {
  deduplicated: boolean;
  mergedInto?: string;
};

export async function runCrmSaveDedupe(opts: {
  tenantId: string;
  workspaceId: string;
  twentyApiKey: string;
  twentyServerUrl: string;
  personId?: string;
}): Promise<CrmSaveDedupeResult>
```

### `readPersonContactPhonesFromTwentyDb(opts)`
```typescript
export async function readPersonContactPhonesFromTwentyDb(opts: {
  workspaceId: string;
  twentyApiKey: string;
  twentyServerUrl: string;
}): Promise<...>
```

### `softMergePeopleByPhone(opts)`
```typescript
export async function softMergePeopleByPhone(opts: {
  workspaceId: string;
  twentyApiKey: string;
  twentyServerUrl: string;
  primaryPersonId: string;
  duplicatePersonId: string;
}): Promise<...>
```

**Callers / Inbound:**
- `apps/saas-api/src/routes/crm-chat.ts` — при создании/обновлении сделки из чата
- `apps/saas-api/src/services/form-lead-process.ts` — при обработке лида из формы

**Dependencies / Outbound:**
- `@voxly/twenty-client` — чтение/запись Person, ContactPhone
- `@voxly/db` — логирование дедупликации

## Алгоритм

1. При создании контакта/сделки → извлечь все телефоны.
2. Найти Person с совпадающими телефонами в воркспейсе.
3. Найден дубликат → soft merge (перенос связей на primary Person).
4. Результат зафиксирован в control-plane БД.

## Инварианты

- Дедупликация scoped по `workspaceId` — нет пересечения тенантов.
- Soft merge не удаляет данные, только переносит связи.

## Дополнение (2026-08-16)

`findPersonByHint` (packages/twenty-client) теперь ищет и по t.me-линкам Person (`telegramPrimaryLinkUrl`/`Label`: `https://t.me/<u>`, `@<u>`, `<u>`) — ручной ввод юзернейма в карточке больше не создаёт дубль Person. См. [`03-saas-api-internal/crm-chat-write-first.md`](../03-saas-api-internal/crm-chat-write-first.md).

## Риски

- **Phone normalization**: разные форматы → `normalizePhoneToE164`.
- **Race condition**: два контакта одновременно с одним телефоном → оба пройдут до merge.
