# GETVOXLY — B2B SaaS Modular Platform
# Core CRM + Pluggable Modules: Service Center, Finance, AI Bots

---

> ⚡ **Паспорт проекта GETVOXLY (Мгновенная память сессии):**
> - **Продукт:** B2B SaaS Modular CRM Platform (Fastify 5 + Next.js 15 + Postgres 16 RLS + Redis 7).
> - **Боевой сервер (VPS):** IP 150.241.98.135, путь /opt/getvoxly (SSH root@150.241.98.135).
> - **Боевой домен:** https://getvoxly.ru/ и https://api.getvoxly.ru/
> - **Документация и деплой:** Вся архитектура в docs/ (docs/05_OPERATIONS/05_01_SERVER_ACCESS.md).
> - **СТРОЖАЙШАЯ ИЗОЛЯЦИЯ:** Запрещено выходить за пределы GETVOXLY или трогать другие проекты (/home/vibeforge/projects/vertex-siam, freelance-hunter).

## SYSTEM IDENTITY

You are a Senior Fullstack Architect working on GETVOXLY. Every change you make must respect
multi-tenant isolation, module-boundary discipline, and strict TypeScript. You never cut corners.

---

## 1. STACK OVERVIEW

### Frontend
- **Framework:** Next.js 15 (App Router) — no `pages/`, only `app/` directory.
- **Styling:** Tailwind CSS 4 + shadcn/ui (Radix primitives, `npx shadcn@latest add ...` to extend).
- **Icons:** Lucide Icons exclusively. No emoji in UI.
- **Forms / Validation:** React Hook Form + Zod (co-locate schemas with components).
- **State:** React Context for tenant/auth state; TanStack Query (React Query v5) for all server state. No Redux, no Zustand.

### Backend
- **Server:** Fastify 5 (TypeScript, ESM).
- **Database:** PostgreSQL 16 with JSONB for custom/extension fields. No ORM — raw SQL or a thin query-builder (kysely / pg-typed).
- **Queue / Cache:** Redis 7 + BullMQ for background jobs.
- **Multi-tenancy:** Every table carries `tenant_id UUID NOT NULL`. Row-Level Security (RLS) enforced in PostgreSQL.

### AI Bots Module
- LLM calls go through an abstraction layer (pluggable providers). No raw `fetch` to OpenAI/Anthropic directly.
- Streaming responses use Server-Sent Events over the Fastify route.

---

## 2. TYPESCRIPT POLICE — ZERO TOLERANCE

```typescript
// 🚫 FORBIDDEN — instant rejection
const data: any = fetchSomething();
// @ts-ignore
const id = user.id;

// 🚫 FORBIDDEN — type assertions that erase safety
const x = response as any;
const y = <any>someValue;

// 🚫 FORBIDDEN — implicit any in callbacks
arr.map(item => item.name);  // item must be explicitly typed via generic or contextual inference
```

### Mandatory Rules
| Rule | Enforcement |
|---|---|
| `any` | NEVER. Use `unknown` and narrow with type guards / Zod parsers. If generic constraint is truly needed, use `Record<string, unknown>` with a comment explaining why. |
| `@ts-ignore` / `@ts-expect-error` | NEVER on production code. Only `@ts-expect-error` allowed **temporarily** in test files with a `// TODO:` linking to a Linear ticket. |
| `as` cast narrowing | Allowed ONLY for well-known runtime guarantees: `as HTMLInputElement` on `event.target`. Never `as` to bypass missing properties. |
| `strictNullChecks` | Always on. Use optional chaining `?.` and nullish coalescing `??`. |

### Type Naming Convention
- **Interfaces & Types:** PascalCase, no `I` prefix.
  ```typescript
  // ✅ GOOD
  interface CreateContactPayload { ... }
  type DealStage = 'lead' | 'qualified' | 'closed_won' | 'closed_lost';

  // ❌ BAD
  interface IContact { ... }
  type deal_stage = ...
  ```
- **Query/Mutation Results:** Suffix with `Row` for DB results, `DTO` for API transfer objects.
  ```typescript
  type ContactRow = { id: string; tenant_id: string; ... };
  type ContactDTO = { id: string; firstName: string; ... };
  ```

---

## 3. DIRECTORY STRUCTURE & MODULE ISOLATION

```
src/
├── app/                          # Next.js App Router (pages, layouts, loading, error)
│   ├── (auth)/                   # Route group — public auth pages
│   ├── (main)/                   # Route group — authenticated tenant portal
│   │   ├── layout.tsx            # Shell: sidebar, header, tenant context provider
│   │   ├── contacts/
│   │   ├── companies/
│   │   ├── deals/
│   │   └── modules/
│   │       ├── service-center/   # Module: Service Center
│   │       ├── finance/          # Module: Finance
│   │       └── ai-bots/          # Module: AI Bots
│   └── api/                      # Route handlers (thin proxies to backend)
├── components/
│   ├── ui/                       # shadcn/ui primitives (button, card, dialog, etc.)
│   ├── core/                     # CRM-core shared components
│   │   ├── contacts/
│   │   ├── companies/
│   │   ├── deals/
│   │   └── tasks/
│   └── modules/                  # One folder per optional module
│       ├── service-center/
│       ├── finance/
│       └── ai-bots/
├── lib/
│   ├── api/                      # TanStack Query hooks (react-query)
│   ├── auth/                     # Clerk/Auth.js client helpers
│   ├── permissions/              # Permission check utilities
│   └── utils/                    # Generic helpers (cn, formatDate, etc.)
├── schemas/                      # Zod schemas (shared with server ideally)
└── types/                        # Global type definitions
```

### Naming Conventions

| Artifact | Convention | Example |
|---|---|---|
| Page files | `page.tsx` | `app/(main)/contacts/page.tsx` |
| Layout files | `layout.tsx` | `app/(main)/layout.tsx` |
| Loading / Error | `loading.tsx`, `error.tsx` | — |
| Server Components | `*-server.tsx` suffix | `contact-list-server.tsx` |
| Client Components | No suffix (default), but `"use client"` directive at top | `contact-table.tsx` |
| React Hook Form | `*-form.tsx` | `create-contact-form.tsx` |
| Zod schemas | `*.schema.ts` | `contact.schema.ts` |
| TanStack Query hooks | Files named after resource: `use-*.ts` | `use-contacts.ts`, `use-deals.ts` |
| Backend routes | `*-routes.ts` | `contact-routes.ts` |
| Backend services | `*-service.ts` | `contact-service.ts` |

### Module Coupling Rule
**Modules imports are ONE-WAY only:**
```
app/modules/<module> → components/modules/<module> → lib/api/<module>
```
- `app/(main)/contacts/` **NEVER** imports from `components/modules/service-center/`.
- `components/core/contacts/` **NEVER** imports from `components/modules/finance/`.
- Shared logic lives in `lib/`, `types/`, or `schemas/` — never in a sibling module.

If two modules need the same utility, lift it to `lib/utils/` first. File a review with the team before merging cross-module imports.

---

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

---

## 6. UI / DESIGN SYSTEM (Twenty CRM / Table Reference)

> Официальная спецификация интерфейса, дизайн-токенов, сетки и компонентов GETVOXLY.
> Полная документация — `docs/01_ARCHITECTURE/01_06_DESIGN_SYSTEM.md` и `01_05_UI_CONVENTIONS.md`.

### Color Palette & Design Tokens (Light Canvas)

| Role | Token / Value | Usage |
|---|---|---|
| **Canvas Background** | `#ffffff` (`--color-bg`) | Основной фон страниц, панелей, ячеек |
| **Sidebar / Secondary** | `#fbfbfb` / `#fafafa` (`--color-bg-secondary`) | Сайдбар навигации, шапка, подложки, свимлейны |
| **Elevated Surface (Hover)** | `#fafafa` / `#f5f5f5` | Подсветка строк при наведении, поповеры, `hover:bg-black/[0.04]` |
| **Border / Divider** | `#e5e5e5` (`--color-border`) | Разделители строк, границы карточек, колонок, инпутов |
| **Border (hover)** | `#cccccc` | Рамка карточки или инпута при наведении |
| **Border (divider)** | `#f0f0f0` | Внутренние тонкие разделители шапок и списков |
| **Text Primary** | `#111111` / `#000000` | Заголовки, названия сделок, значения в ячейках, основной текст |
| **Text Secondary** | `#666666` | Вторичные подписи, лейблы колонок, описания, таймстампы |
| **Text Muted / Icons** | `#888888` | Плейсхолдеры («Указать …»), иконки в тулбарах, счетчики |
| **Primary CTA Accent** | `#4a38f5` (Indigo) | Главная кнопка действия, бренд-маркер, активный таб, фокус |
| **Primary Hover** | `#3d2ee0` | Наведение на primary-кнопки |
| **Secondary Accent** | `#aaaaaa` (`--color-secondary`) | Второстепенные контролы, неактивные переключатели |
| **Focus State** | `#4a38f5` / `#03b2cb` | Рамка активного ввода (`focus:ring-[#4a38f5]/20`) |
| **Selection / DnD Highlight** | `#3b82f6` | Маркер перетаскивания колонок, активные чекбоксы |
| Success | `emerald-600` / `#15803d` / `#dcfce7` | Положительные статусы (closed_won, paid, ready, выполнено) |
| Danger / Destructive | `rose-600` / `#dc2626` / `#ffe4e6` | Кнопки удаления, ошибки, отказ, closed_lost, просрочено |
| Warning / Notes | `#854d0e` / `#fef08a` / `#fefce8` | Текст `#854d0e`, рамка `#fef08a`, фон `#fefce8` (чип заметки) |
| Info / Tag | `sky-600` / `#4a38f5`/10 | Информационные бейджи, теги, ссылки |

### Typography & Spacing
- **Шрифты:** `Inter` (UI sans-serif для текста и заголовков), `DM Mono` (моноширинный для ID, сумм, дат, валют).
- **Размеры:** Display `13.3px`, H1 `13px`, Body `13px` / `12px` (`text-xs`), Label `11px`, Tiny `10px`.
- **Строка таблицы записей:** строго `32px` (`RECORD_TABLE_ROW_HEIGHT = 32`, `h-8`).
- **Скругления:**
  - `16px` (`rounded-2xl` / `rounded-[16px]`): модальные окна, боковые шторки (дроверы), листы.
  - `8px` (`rounded-[8px]` / `rounded-lg`): карточки записей, канбан, поля ввода, кнопки.
  - `4px` (`rounded-[4px]`): бейджи, теги, чипы заметок, чекбоксы.
- **Анимации:** быстрые `75ms` (hover), стандартные `150ms` (дропдауны, табы), оверлеи `300ms` (slide-over sheet).

### Component Patterns

**Card:**
```tsx
<div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors">
```

**Primary Button:**
```tsx
<Button className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]">
  Сохранить
</Button>
```

**Destructive Button:**
```tsx
<Button className="h-8 rounded-[8px] bg-rose-600 px-3 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-rose-500">
  Удалить
</Button>
```

**Input:**
```tsx
<Input className="h-8 rounded-[8px] border-[#e5e5e5] bg-white text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:ring-[#4a38f5]/20" />
```

**Note Chip (Twenty UX Pattern):**
```tsx
<div className="rounded-[4px] border border-[#fef08a] bg-[#fefce8] p-2 text-xs text-[#854d0e] line-clamp-3">
  {noteBody}
</div>
```

**Status Badge (TagPill):**
```tsx
import { TagPill, type TagColor } from "@/components/ui/tag";

<TagPill color="emerald">Активен</TagPill>
<TagPill color="amber">В обработке</TagPill>
<TagPill color="rose">Отменён</TagPill>
```

**Table (RecordTable):**
```tsx
<RecordTable
  rows={items}
  columns={columns}
  getRowId={(item) => item.id}
  tableId="module_table"
/>
```

### Layout Rules
- **Паттерн боковых шторок (Slide-Over Drawers):** Просмотр и редактирование сущностей происходят в правой боковой шторке (`Sheet.tsx`), а не в центрированных модальных окнах. Синхронизируется с URL (`?record=<id>`).
- **Строка таблицы:** Фиксированная высота `32px`, липкие колонки чекбокса (`28px`) и первой колонки (`COLLAPSED_IDENTIFIER_WIDTH = 38px`), ресайз колонок через CSS-переменные напрямую в DOM.
- **Сайдбар:** фиксированная ширина `w-60` (складывается до `w-16`), `bg-[#fbfbfb] border-r border-[#e5e5e5]`. На мобильном (< 768px) скрывается (`hidden md:flex`), а навигация уходит в маршрут-меню и нижний бар.
- **Шапка:** `h-14`, `bg-white border-b border-[#e5e5e5]`, sticky к верху.
- **Один брейкпоинт:** `md:` (768px). Структурная раскладка строится на Tailwind-префиксах, а не на `useIsMobile`.
- **Оверлеи:** Прокрутку фона и закрытие по Escape выполняет исключительно `useOverlay` (`lib/utils/use-scroll-lock.ts`).

Полные правила вёрстки — `docs/01_ARCHITECTURE/01_06_DESIGN_SYSTEM.md` и `docs/01_ARCHITECTURE/01_05_UI_CONVENTIONS.md`.

---

## 7. FORM & VALIDATION STANDARDS

Every form follows this pattern:

```tsx
// schemas/contact.schema.ts
import { z } from 'zod';

export const createContactSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  company_id: z.string().uuid().optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

export type CreateContactPayload = z.infer<typeof createContactSchema>;

// components/core/contacts/create-contact-form.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactSchema, type CreateContactPayload } from '@/schemas/contact.schema';

export function CreateContactForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<CreateContactPayload>({
    resolver: zodResolver(createContactSchema),
    defaultValues: { first_name: '', last_name: '', email: '', phone: '', custom_fields: {} },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateContactPayload) => apiClient.post('/api/contacts', data),
    onSuccess,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input {...field} className="border-slate-700 bg-slate-900" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ...remaining fields */}
        <Button type="submit" disabled={mutation.isPending} className="bg-[#4a38f5] text-white hover:bg-[#3b2be0]">
          {mutation.isPending ? 'Saving...' : 'Create Contact'}
        </Button>
      </form>
    </Form>
  );
}
```

Rules:
- Zod schemas live in `schemas/` and are reused for both client validation and server-side request validation (keep them in sync).
- Field names in schemas use `snake_case` (database column convention), but the Zod `.transform()` can convert to camelCase for the frontend if the team decides.
- All mutations show loading state (`isPending`), disable the submit button, and surface validation errors via `<FormMessage />`.
- Server-side `4xx` errors are parsed and displayed via `form.setError()` using `onError` in `useMutation`.

---

## 8. SERVER-SIDE CONVENTIONS (Fastify)

### Route Definition Pattern

```typescript
// backend/src/routes/contact-routes.ts
import type { FastifyInstance } from 'fastify';
import { createContactSchema } from '../../shared/schemas/contact.schema'; // shared schemas package

export async function contactRoutes(app: FastifyInstance) {
  // All routes require authentication + tenant context
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requirePermission('contacts:read'));

  app.get('/contacts', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 25, maximum: 100 },
        },
      },
    },
    handler: async (request, reply) => {
      const { tenant_id } = request;
      const { search, page, limit } = request.query as { search?: string; page: number; limit: number };
      const offset = (page - 1) * limit;

      const contacts = await app.db.query(
        `SELECT * FROM contacts
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR full_text @@ plainto_tsquery($2))
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [tenant_id, search ?? null, limit, offset]
      );

      return reply.send({ data: contacts, page, limit });
    },
  });

  app.post('/contacts', {
    schema: { body: createContactSchema }, // reuse Zod schema + ajv compilation
    handler: async (request, reply) => {
      const { tenant_id } = request;
      const payload = request.body;

      const [contact] = await app.db.query(
        `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, company_id, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenant_id, payload.first_name, payload.last_name, payload.email, payload.phone, payload.company_id, JSON.stringify(payload.custom_fields ?? {})]
      );

      return reply.status(201).send(contact);
    },
  });
}
```

### Middleware Decorators
```typescript
// backend/src/plugins/auth.ts
declare module 'fastify' {
  interface FastifyRequest {
    tenant_id: string;
    user_id: string;
    permissions: Set<string>;
    installed_modules: string[];
  }
}
```

### Background Jobs (BullMQ)
- Queue names: `email`, `export`, `ai-bots`, `notifications`.
- All job handlers read `tenant_id` from the job payload. Job data is scoped to the tenant.
- Retry policies: exponential backoff, max 5 attempts, dead-letter to a `failed-jobs` queue.

### API Response Envelope
```typescript
interface ApiResponse<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface ApiError {
  error: {
    code: string;       // 'VALIDATION_ERROR', 'NOT_FOUND', 'PERMISSION_DENIED', etc.
    message: string;
    details?: Record<string, string[]>; // field-level errors
  };
}
```

---

## 9. MODULE SYSTEM — INSTALLATION & REGISTRY

### Module Registration (Backend)
```typescript
// backend/src/modules/registry.ts
interface ModuleDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;             // Lucide icon name
  permissions: Permission[];
  routes: (app: FastifyInstance) => Promise<void>;
  menuItems: MenuItem[];
}

export const moduleRegistry: Record<string, ModuleDefinition> = {
  service_center: { ... },
  finance: { ... },
  ai_bots: { ... },
};
```

- On startup, the server queries `installed_modules` for the tenant and registers only active module routes.
- Uninstalled module routes return `403` with `code: 'MODULE_NOT_INSTALLED'`.

### Frontend Module Registration
```typescript
// lib/modules/registry.ts
interface FrontendModule {
  slug: string;
  requiredPermissions: Permission[];
  sidebar: React.ComponentType;    // sidebar nav item
  pages: React.ComponentType;      // page component (lazy loaded via next/dynamic)
}

export const frontendModuleRegistry: Record<string, FrontendModule> = { ... };
```

- Dynamic imports use `next/dynamic` with `ssr: false` for heavy module UIs.
- `Guard` component wraps every module page to double-check installation + permission on client mount.

---

## 10. GENERAL CODE RULES

### Imports
- Use `@/` path alias for all project-internal imports.
- Group imports: React/Next → Third-party → `@/` internal, separated by blank lines.
- No relative `../../../` imports for anything beyond the same directory.

### Error Handling
- Backend: never leak stack traces. Use `app.setErrorHandler()` to unify error responses in the `ApiError` envelope.
- Frontend: use React Error Boundaries around module sections. Wrap `useQuery` errors with `onError` for toast notifications. Use `toast({ variant: 'destructive', description: error.message })`.
- Empty states: use a dedicated `<EmptyState icon={...} title="..." description="..." action={<Button>...</Button>} />` component. Never show a blank table.

### Loading States
- Tables/lists: use `<Skeleton className="h-12 w-full" />` (shadcn) × 5–10 rows.
- Page transitions: Next.js `loading.tsx` with skeleton layout matching the page shape.
- Mutations: spinner inside the button (`<Loader2 className="mr-2 h-4 w-4 animate-spin" />`).

### Time & Date
- All dates stored in UTC. Frontend converts to user timezone via `Intl.DateTimeFormat`, using the tenant timezone setting.
- Relative times use a simple `timeAgo()` utility.

### Database
- Table names: `snake_case`, plural (`contacts`, `companies`, `deals`, `tasks`, `installed_modules`).
- Primary keys: `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`.
- Timestamps: every table has `created_at TIMESTAMPTZ DEFAULT now()` and `updated_at TIMESTAMPTZ DEFAULT now()` with a trigger for auto-update.
- Soft deletes: `deleted_at TIMESTAMPTZ` column. Queries filter `WHERE deleted_at IS NULL`. No hard deletes unless explicitly required (GDPR purge).

---

## 11. TESTING

- **Unit tests** (Vitest) for utilities, Zod schemas, permission logic.
- **Integration tests** (Supertest + Fastify) for API routes with a test PostgreSQL.
- **E2E** (Playwright) for critical flows: auth → create contact → create deal → view timeline.
- Module tests are isolated — they run only if the module is installed in the test tenant fixture.

---

## 12. GIT WORKFLOW

- Branch naming: `feature/GETV-123-short-description`, `fix/GETV-456-bug-description`.
- Commit messages: Conventional Commits — `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- No committing: `.env` files, `node_modules/`, `.next/`, `dist/`, coverage output.
- Lint + TypeScript check must pass before push (enforced by `husky` pre-push hook).

---

## 13. AI BOTS MODULE — ADDITIONAL RULES

- Prompt templates are stored in the database, never hardcoded.
- All LLM calls log `tenant_id`, `user_id`, `model`, `tokens_used`, `latency_ms` to an `ai_logs` table.
- Streaming endpoints use SSE: `Content-Type: text/event-stream`. Fastify route returns a `ReadableStream`.
- Chat timeline messages have `source: 'human' | 'ai' | 'system' | 'ai_bot'`.

---

## 14. FINAL CHECKLIST — BEFORE YOU WRITE CODE

1. Does this query include `WHERE tenant_id = ...`?
2. Is there any `any` or `@ts-ignore`? → Remove it.
3. Is the module guard (`<Guard>`) in place for module-specific UI?
4. Are colors from the defined palette (`slate-950/900/800`, `amber-500`, `orange-400`)?
5. Is the Zod schema in `schemas/`, not inline?
6. Does the form have loading/error/empty states handled?
7. Is the import path using `@/` and properly grouped?
8. For new modules: is it registered in both backend and frontend registries?

---

## 15. SPEC-DRIVEN DEVELOPMENT & DOCS DISCIPLINE

1. **Source of Truth:** Папка `docs/` является абсолютным источником правды для архитектуры и контрактов API.
2. **Перед генерацией:** Всегда читай соответствующий PRD из `@docs/02_PRD_AND_MODULES/` или контракт из `@docs/03_API_CONTRACTS/`.
3. **После генерации (Definition of Done):**
   - Проверить типизацию: `tsc --noEmit` (0 ошибок).
   - Обновить статус задачи `[x]` в `docs/04_PROJECT_STATE/ROADMAP_TASKS.md`.
   - Зафиксировать изменения в `docs/04_PROJECT_STATE/CHANGELOG.md`.
4. **Запрет на расхождение документации:** Если код меняет сигнатуру API или добавляет таблицу/поле в БД, соответствующий документ в `docs/` должен быть обновлен в той же итерации.

---

## 16. AGENT SKILLS — ОБЯЗАТЕЛЬНЫЙ РИТУАЛ

Набор `caveman-*` (17 скилов, `github.com/aidvizhhub/caveman-dvizh-skills`) установлен в
`~/.config/kilo/skills/`. Это правила работы, а не справочник: они применяются к каждой задаче
по этому проекту, а не по запросу.

### Порядок применения

| Когда | Скил | Что даёт |
|---|---|---|
| До задачи | `caveman-prevent` | Премортем: топ-3 причины провала закрыть до первой правки |
| До задачи | `caveman-research` | Факты из официальной документации и исходников раньше блогов и памяти |
| В процессе | `caveman-verify` | Снять факт «как есть» → сверить с «как должно» (план, `docs/`, канон) → расхождение чинить до следующего шага |
| После задачи | `caveman-conclusion` | Вывод-вердикт: итог + что это значит + что делать дальше |
| После задачи | `caveman-advise` | 3-4 варианта «куда дальше» с ценой каждого |

Крупная задача идёт по `caveman-loop`: 8 шагов (память → разведка → рамки «готово =
проверяемое условие» → план и премортем → дело с проверкой → доказательства → отчёт →
запись), терминальный гейт «готово доказано фактами», кап 3 итерации → стоп и отчёт.

При работе с кодом дополнительно: `caveman-code` (сначала как делают в индустрии, потом своё),
`caveman-save` (границы файла 100-300 строк, max 500; тест до реализации),
`caveman-diagnose` (баг — по уликам из логов, а не гаданием, одна переменная за раз).

### Почему это в правилах проекта, а не в памяти сессии

`AGENTS.md` и `.cursorrules` — единственные документы, которые читаются автоматически на каждой
сессии. Канон `caveman-verify` прямо требует вшивать фикс в правила, иначе он не держится:
скилы уже были установлены один раз и не подхватывались, потому что правила о них не знали.

### Установка на новой машине

```bash
gh repo clone aidvizhhub/caveman-dvizh-skills
mkdir -p ~/.config/kilo/skills
cp -R caveman-dvizh-skills/skills/. ~/.config/kilo/skills/
```

`install.sh` из репозитория на macOS не работает: он использует `declare -A` (bash 4+), а
системный `/bin/bash` — 3.2. Скрипт только копирует папки `skills/*`, поэтому `cp -R` даёт тот
же результат. Штатные цели скрипта (`claude`, `opencode`, `codex`, `gemini`, `agents`) для Kilo
не подходят — путь указывается явно.