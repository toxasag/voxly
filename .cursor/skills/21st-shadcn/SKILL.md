---
name: 21st-shadcn
description: Use shadcn/ui + 21st.dev components in saas-portal (Tailwind v4). Prefer existing @/components/ui/*.
---

# 21st / shadcn for Voxly portal

Portal already has Tailwind v4 + shadcn-style primitives in `apps/saas-portal/src/components/ui/`.

## Add more components

From `apps/saas-portal`:

```bash
npx shadcn@latest add button card input
# or from 21st registry:
npx shadcn@latest add "https://21st.dev/r/shadcn/accordion"
```

Config: `apps/saas-portal/components.json`

## Rules

- Use `cn()` from `@/lib/utils`
- Prefer existing Button/Card/Input/Badge before adding new deps
- Theme: **shadcn indigo** (ADR-020) in `globals.css` — primary indigo CTAs, zinc neutrals; legacy `ink`/`canvas` aliases map to semantic tokens
