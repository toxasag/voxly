# TypeScript и структура проекта

> Вынесено без изменений смысла из `AGENTS.md` проекта GETVOXLY (исходные строки 69–173 прежней версии; прежний полный файл — коммит `1115feb`/`4cc8860`). Читай этот файл перед работой в соответствующей области.

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
