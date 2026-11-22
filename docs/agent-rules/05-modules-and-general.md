# Модули, общие правила кода, тесты, git, AI Bots

> Вынесено без изменений смысла из `AGENTS.md` проекта GETVOXLY (исходные строки 559–654 прежней версии; прежний полный файл — коммит `1115feb`/`4cc8860`). Читай этот файл перед работой в соответствующей области.

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
