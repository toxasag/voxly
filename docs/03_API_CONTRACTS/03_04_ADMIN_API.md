# 03.04 — Platform Admin API (Superadmin)

Модуль: `backend/src/modules/admin/` · Префикс: `/api/v1/admin`

Гейт — **глобальная платформенная роль** `users.platform_role = 'platform_owner'`
(хук `requirePlatformOwner`). Тенантные роли (`owner` и ниже) и их пермиссии
не дают доступа: любой запрос без платформенной роли получает
`403 PERMISSION_DENIED`. Назначение роли — только SQL-ом напрямую в БД
(миграция `0001_platform_role.sql`).

`platform_role` включён в `user` ответа `/auth/login`, `/auth/refresh`,
`/auth/otp/verify` (nullable).

---

## GET /api/v1/admin/tenants

Все тенанты платформы с агрегатами.

**Ответ 200:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Test Tenant",
      "plan": "trial | start | business | enterprise",
      "status": "trial | active | past_due | suspended",
      "ai_tokens_balance": 100000,
      "subscription_expires_at": "2026-09-18T00:00:00.000Z | null",
      "created_at": "2026-08-19T00:00:00.000Z",
      "users_count": 3,
      "modules_count": 2
    }
  ]
}
```

## PATCH /api/v1/admin/tenants/:id

Частичное обновление тарифа/статуса/лимитов. Все поля опциональны;
изменения пишутся в `tenant_audit_log` (`tenant.update`).

**Тело:**

```json
{
  "plan": "business",
  "status": "active",
  "subscription_expires_at": "2026-09-18T00:00:00.000Z",
  "ai_tokens_balance": 250000
}
```

**Ответ 200:** обновлённая строка `tenants`. **404** — тенант не найден.

## GET /api/v1/admin/metrics

Платформенные метрики для superadmin-панели (auto-refresh 30 c).

**Ответ 200:**

```json
{
  "data": {
    "counts": {
      "tenants_total": 1, "tenants_active": 1, "tenants_trial": 0,
      "tenants_suspended": 0, "users_total": 1, "contacts_total": 0,
      "deals_total": 0, "repair_orders_total": 0, "messages_total": 0
    },
    "database": {
      "size_bytes": 10485760, "connections": 8, "uptime_seconds": 3600
    },
    "queue": { "implemented": false, "pending": 0, "failed": 0 },
    "generated_at": "2026-08-19T00:00:00.000Z"
  }
}
```

`queue.implemented = false` до появления BullMQ в стеке — панель показывает
«n/a»; поле заранее держит форму конверта, чтобы фронт не менялся.

---

## Фронтенд

- Роут: `/superadmin` (`app/superadmin/page.tsx`), защищён
  `PlatformOwnerGuard` (клиент) + `middleware.ts` (редирект без auth-cookie).
- Хуки: `lib/api/use-admin.ts` — `useAdminTenants`, `useAdminMetrics`,
  `useUpdateTenant`, `renewSubscriptionDate`.
