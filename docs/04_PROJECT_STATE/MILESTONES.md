# MILESTONES — Project Timeline

> All dates in YYYY-MM-DD. Milestones are sequential; each unlocks the next.
> "Frontend-First" means UI is completed and approved before backend wiring begins for that milestone.

---

| Milestone | Target | Weeks | Status | Deliverable |
|---|---|---|---|---|
| **M0** — Project Scaffold | Week 1–2 | 2 | `[ ]` | Auth OTP Hub working end-to-end, layout shell, design system |
| **M1** — Core CRM | Week 3–6 | 4 | `[ ]` | Contacts, Companies, Deals, Tasks, Timeline — full CRUD with backend |
| **M2** — Service Center | Week 7–9 | 3 | `[ ]` | Repair ticket management, technician workflow, customer notifications |
| **M3** — Finance | Week 10–12 | 3 | `[ ]` | Invoices, payments, financial reports, PDF generation |
| **M4** — AI Bots | Week 13–15 | 3 | `[ ]` | Bot builder, streaming chat, LLM abstraction, usage logging |
| **M5** — SaaS Admin | Week 16–17 | 2 | `[ ]` | Tenant settings, user/role management, module marketplace, billing |
| **M6** — Polish & Prod | Week 18–20 | 3 | `[ ]` | Testing, accessibility, monitoring, CI/CD, deployment |

---

## Milestone Completion Criteria

### M0 — Project Scaffold
- [ ] `next dev` starts frontend on localhost:3000 with full layout shell
- [ ] `pnpm dev` starts backend on localhost:3001
- [ ] Auth flow works: login → OTP verify → redirect to `/contacts`
- [ ] Sidebar navigation renders all core links, Guard hides inaccessible items
- [ ] shadcn/ui theme is applied with slate-950/amber-500 palette

### M1 — Core CRM
- [ ] CRUD operations on contacts, companies, deals, tasks work end-to-end
- [ ] Kanban board drag-and-drop updates deal stage
- [ ] Timeline messages persist and display on entity detail panels
- [ ] All tables have RLS enforced, all queries include `tenant_id`
- [ ] Empty, loading, and error states handled for every view

### M2 — Service Center
- [ ] Repair tickets flow: create → diagnose → repair → ready → delivered
- [ ] Ticket detail shows full status timeline and notes
- [ ] Photo upload works for ticket attachments
- [ ] SMS/email notifications fire on status changes (BullMQ)
- [ ] Module is hidden when not installed

### M3 — Finance
- [ ] Invoice creation with dynamic line items
- [ ] Payment recording with partial payment support
- [ ] PDF invoice download
- [ ] Financial dashboard with revenue chart and overdue report
- [ ] Overdue invoice reminders via BullMQ

### M4 — AI Bots
- [ ] Bot creation with system prompt and model selection
- [ ] Streaming chat with typing indicator
- [ ] Context variables (`{{contact.name}}`) resolved at runtime
- [ ] Usage stats page: tokens, cost, latency
- [ ] All LLM calls logged to `ai_logs`

### M5 — SaaS Admin
- [ ] Tenant settings page saves to DB
- [ ] User CRUD with role assignment
- [ ] Permission editor with per-module checkboxes
- [ ] Module install/uninstall toggles
- [ ] Billing page shows Stripe plan and invoice history
- [ ] Audit log table renders filtered results

### M6 — Polish & Production Readiness
- [ ] Lighthouse score ≥ 90 on all pages
- [ ] All Playwright E2E tests pass in CI
- [ ] Frontend deployed to Vercel, backend deployed to Railway/Fly.io
- [ ] Sentry error monitoring active
- [ ] Health check endpoint monitored by UptimeRobot
- [ ] Zero `any` or `@ts-ignore` in codebase (CI-enforced)