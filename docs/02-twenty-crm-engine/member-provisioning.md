# Member Provisioning

> Управление участниками воркспейса: права, роли, создание и удаление.

## Исходные файлы

- `apps/saas-api/src/services/twenty-member-provision.ts`
- `packages/twenty-client/src/index.ts`

## Ключевые функции

### `provisionTwentyMemberForTenant(params)`
```typescript
export async function provisionTwentyMemberForTenant(params: {
  tenantId: string;
  workspaceId: string;
  email: string;
  firstName: string;
  lastName?: string;
  role?: string;
}): Promise<...>
```

**Callers / Inbound:**
- `apps/saas-api/src/services/provisioning.ts` — первый участник при создании воркспейса
- `apps/saas-api/src/routes/admin.ts` — управление участниками из админки

### `resolveTwentyPasswordForMember(member)`
```typescript
export function resolveTwentyPasswordForMember(member: ...): string
```

## Роли

| Роль Voxly | Роль Twenty | Описание |
|-------------|-------------|----------|
| `owner` | `WORKSPACE_ADMIN` | Полный доступ |
| `admin` | `WORKSPACE_ADMIN` | Управление воркспейсом |
| `member` | `WORKSPACE_MEMBER` | Стандартный участник |
| `viewer` | `WORKSPACE_VIEWER` | Только чтение |

## Инварианты безопасности

- Участник привязан к `tenantId`.
- При удалении тенанта — каскадное удаление участников через Twenty API.

## Риски поломки

- **Twenty API rate limiting** при массовом provision.
- **Различие версий** Twenty API для member management.
