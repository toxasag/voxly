# GETVOXLY — Documentation Index

> B2B SaaS Modular Platform: Core CRM + Pluggable Modules (Service Center, Finance, AI Bots).
> Stack: Next.js 15 + Fastify 5 + PostgreSQL 16 + Redis 7.

---

## Quick Navigation

| Section | Path | Description |
|---|---|---|
| **Architecture** | [`docs/01_ARCHITECTURE/`](./01_ARCHITECTURE/) | System overview, database schema, RBAC security model, module system design |
| **PRD & Modules** | [`docs/02_PRD_AND_MODULES/`](./02_PRD_AND_MODULES/) | Product requirements per module: Core CRM, Auth OTP Hub, Service Center, Finance, AI Bots, SaaS Admin |
| **API Contracts** | [`docs/03_API_CONTRACTS/`](./03_API_CONTRACTS/) | REST API endpoint specifications: request/response schemas, auth, error codes |
| **Project State** | [`docs/04_PROJECT_STATE/`](./04_PROJECT_STATE/) | Roadmap, atomic task checklist, milestone tracking |
| **Operations** | [`docs/05_OPERATIONS/`](./05_OPERATIONS/) | **Доступ к серверу, диагностика недоступности, деплой, инциденты** |

---

## 01 — Architecture (`01_ARCHITECTURE/`)

```
01_ARCHITECTURE/
├── 01_01_SYSTEM_OVERVIEW.md     ← Stack, repo layout, route mounting, tenant isolation, request flow
├── 01_02_DATABASE_SCHEMA.md     ← All 27 tables, relations, JSONB fields, GIN indexes, triggers, RLS
├── 01_03_SECURITY_RBAC.md       ← Roles, permissions, authenticate/authorize plugins, JWT flow
├── 01_04_DATABASE_MIGRATIONS.md ← Раннер миграций, порядок работы, baseline, откат
├── 01_05_UI_CONVENTIONS.md      ← Брейкпоинт 768px, структура на CSS против поведения на хуке, оверлеи
└── 01_06_DESIGN_SYSTEM.md       ← Спецификация дизайн-системы Twenty CRM / Table, токены, матрица аудита
```

## 02 — PRD & Modules (`02_PRD_AND_MODULES/`)

```
02_PRD_AND_MODULES/
├── 02_00_LANDING_AND_AUTH.md    ← Root redirect, Auth OTP Hub, onboarding wizard
├── 02_01_CORE_CRM.md            ← Deals kanban, contacts, companies, tasks, deal timeline
├── 02_03_MODULE_REPAIRS.md      ← Repair orders, 6-step workflow, works & parts, receipts
├── 02_04_MODULE_FINANCE.md      ← Cash accounts, transfers, transactions, RF invoices, P&L
├── 02_05_MODULE_AI_BOTS.md      ← Bot config, prompt templates, streaming chat, usage logs
└── 02_06_SAAS_ADMIN.md          ← Tenant admin, module marketplace, referral programme
```

## 03 — API Contracts (`03_API_CONTRACTS/`)

```
03_API_CONTRACTS/
├── 03_01_AUTH_API.md                  ← /auth/* (OTP, login, refresh, logout), формат токенов, /health
├── 03_02_CRM_API.md                   ← /api/v1/crm: contacts, companies, deals, tasks
├── 03_03_REPAIRS_AND_FINANCE_API.md   ← /api/v1/repairs, /finance, /invoices, /marketplace, /admin
├── 03_04_ADMIN_API.md                 ← /api/v1/admin: платформенные разделы под requirePlatformOwner
├── 03_05_TENANT_AND_TEAM_API.md       ← /api/v1/tenant: сотрудники, роли, места в тарифе, подписка
├── 03_06_CHANNELS_API.md              ← /api/v1/channels: подключения аккаунтов пяти каналов связи
└── 03_07_AI_API.md                    ← /api/v1/ai: агенты, баланс ИИ, тарификация токенов, наценка
```

> Вызовы моделей реализованы через `GatewayChatProvider` и `AgentPipelineService`.
> Production-конфигурация была подтверждена аудитом; пустой `ai_usage_log` не означает
> отсутствие реализации. Пробный чат UI остаётся демонстрационным. Статусы проверок — ниже.

## 04 — Project State (`04_PROJECT_STATE/`)

```
04_PROJECT_STATE/
├── ROADMAP_TASKS.md             ← Atomic full-stack task checklist (Frontend-First)
├── MILESTONES.md                ← Milestone definitions, dates, completion criteria
├── DESIGN_SYSTEM_AUDIT_TWENTY.md ← Аудит соответствия дизайн-системе Twenty CRM (Table)
└── CHANGELOG.md                 ← Итерации изменений (Keep a Changelog)
```

Актуальная сверка старого проекта, нового кода и production: [LEGACY_REUSE_AUDIT_2026-09-19.md](04_PROJECT_STATE/LEGACY_REUSE_AUDIT_2026-09-19.md). Включает матрицу переиспользования CRM-PLUS, ограничения проверки VPS и требования к паритету интерфейса Twenty.

Процесс реализации и план вертикальных срезов: [IMPLEMENTATION_LOG.md](04_PROJECT_STATE/IMPLEMENTATION_LOG.md), [REUSE_IMPLEMENTATION_PLAN.md](04_PROJECT_STATE/REUSE_IMPLEMENTATION_PLAN.md).

Проверки и ограничения: [BROWSER_VERIFICATION.md](04_PROJECT_STATE/BROWSER_VERIFICATION.md). Допуск к релизу и откат: [05_03_SAFE_RELEASE.md](05_OPERATIONS/05_03_SAFE_RELEASE.md).

## 05 — Operations (`05_OPERATIONS/`)

```
05_OPERATIONS/
├── 05_01_SERVER_ACCESS.md       ← Как попасть на сервер (SSH, ключ, пароль для VNC),
│                                   диагностика «сайт не открывается», порядок при зависании,
│                                   инцидент 25.08.2026 и защита от брутфорса
└── 05_02_DEPLOY.md              ← Деплой по ключу: ControlMaster (обязателен), scripts/deploy.sh,
                                    отсоединённая сборка, ослабленные правила fail2ban
```

> Читается в момент аварии: команды даны копипастой, без отсылок к другим документам.

---

## Conventions Referenced

- **Code standards**: see project root [`.cursorrules`](../.cursorrules)
- **All dates** in docs: `YYYY-MM-DD`.
- **Status badges** used in tasks: `[ ]` pending, `[~]` in-progress, `[x]` done, `[-]` cancelled.