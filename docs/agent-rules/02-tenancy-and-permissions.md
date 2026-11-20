# Мультитенантность и права

> Вынесено без изменений смысла из `AGENTS.md` проекта GETVOXLY (исходные строки 176–267 прежней версии; прежний полный файл — коммит `1115feb`/`4cc8860`). Читай этот файл перед работой в соответствующей области.

## 4. MULTI-TENANCY — TENANT ISOLATION

### Database Rules (Backend)
- **Every query** MUST include `WHERE tenant_id = $tenantId` unless it's a system-level operation (auth, billing webhooks).
- **Row-Level Security:** PostgreSQL RLS policies are defined per table. Service functions run as `SET LOCAL role = tenant_role`.
- **Never** construct tenant-id in the frontend. It comes from the authenticated session on the backend, injected via middleware.
  ```typescript
  // ✅ Backend: tenant_id from Fastify `request` decorator (set by auth middleware)
  const { tenant_id } = request;
  const contacts = await db.query(
    'SELECT * FROM contacts WHERE tenant_id = $1',
    [tenant_id]
  );

  // ❌ NEVER pass tenant_id from the client
  // POST /api/contacts body: { tenant_id: "..." }  ← FORBIDDEN
  ```
- **JSONB custom fields** live in a `custom_fields JSONB DEFAULT '{}'` column. Never create runtime columns.

### Frontend Rules
- Tenant context is fetched once on `(main)/layout.tsx` and provided via React Context.
- API calls use a shared `apiClient` that attaches credentials (cookies / Bearer token) — NEVER pass tenant_id to the server.
- `useTenant()` hook returns `{ tenantId, tenantName, plan, installedModules }`.

---

## 5. PERMISSIONS & MODULE VISIBILITY

### Permission Model
```typescript
type Permission = 
  // Core CRM
  | 'contacts:read' | 'contacts:write' | 'contacts:delete'
  | 'companies:read' | 'companies:write' | 'companies:delete'
  | 'deals:read' | 'deals:write'
  | 'tasks:read' | 'tasks:write'
  // Module: Service Center
  | 'service_center:read' | 'service_center:write'
  // Module: Finance
  | 'finance:read' | 'finance:write' | 'finance:admin'
  // Module: AI Bots
  | 'ai_bots:read' | 'ai_bots:configure'
  // Admin
  | 'tenant:admin' | 'billing:manage';
```

### UI Guard — Dynamic Hiding
**Components and navigation items are hidden, NOT disabled, when the user lacks permission or the module is not installed.**

```typescript
// lib/permissions/guards.ts
export function hasPermission(user: CurrentUser, permission: Permission): boolean { ... }
export function isModuleInstalled(modules: InstalledModule[], slug: ModuleSlug): boolean { ... }

// components/core/guard.tsx — composable guard component
interface GuardProps {
  permission?: Permission;
  module?: ModuleSlug;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function Guard({ permission, module, children, fallback = null }: GuardProps) {
  const user = useCurrentUser();
  const { installedModules } = useTenant();

  if (permission && !hasPermission(user, permission)) return <>{fallback}</>;
  if (module && !isModuleInstalled(installedModules, module)) return <>{fallback}</>;

  return <>{children}</>;
}
```

Usage:
```tsx
// Navigation sidebar
<Guard permission="contacts:read">
  <SidebarLink href="/contacts" icon={ContactIcon}>Contacts</SidebarLink>
</Guard>

// Module section — double check: permission + installed
<Guard permission="service_center:read" module="service_center">
  <SidebarLink href="/modules/service-center" icon={WrenchIcon}>Service Center</SidebarLink>
</Guard>

// Action button
<Guard permission="contacts:write">
  <Button onClick={openCreateDialog}>Add Contact</Button>
</Guard>
```
- **No route-level redirect** for modules. If the module is not installed, the layout group `app/(main)/modules/<slug>/` returns 404 via `notFound()`. Navigation links for uninstalled modules never render.
- **Permission checks happen on the backend too.** Every Fastify route handler verifies the permission from the JWT/session. The UI guard is cosmetic; the backend guard is the source of truth.
