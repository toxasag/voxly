# 01_01 — Обзор системы

> Статус: соответствует коду на 2026-08-18. Источник правды — `frontend/src/`, `backend/src/`.

---

## 1. Назначение

GETVOXLY — модульная B2B SaaS-платформа: ядро CRM плюс подключаемые модули (Сервисный центр, Финансы, AI-боты). Каждый арендатор (tenant) видит только свои данные и только те модули, которые у него установлены.

---

## 2. Стек

| Слой | Технология | Где в коде |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19 | `frontend/src/app/` |
| Стили | Tailwind CSS 4, dark-first палитра | `frontend/tailwind.config.ts` |
| Иконки | Lucide React | компоненты `frontend/src/components/` |
| Формы | React Hook Form + Zod | `frontend/src/schemas/` |
| Графики | Recharts | `frontend/src/components/analytics/`, `ai-bots/BotUsageStats.tsx` |
| Тосты | sonner | `frontend/src/app/layout.tsx` |
| Backend | Fastify 5 (TypeScript, ESM) | `backend/src/app.ts` |
| БД | PostgreSQL 16, JSONB, RLS | `backend/src/db/schema.sql` |
| Драйвер БД | `pg` (без ORM, параметризованный SQL) | `backend/src/db/client.ts` |
| Auth | `@fastify/jwt`, argon2 | `backend/src/plugins/authenticate.ts` |
| Конфигурация | Zod-валидация окружения при старте | `backend/src/config/env.ts` |
| Безопасность HTTP | helmet, cors, rate-limit | `backend/src/app.ts` |

**Redis 7 + BullMQ** заявлены в архитектуре для фоновых задач (очереди `notifications`, `service_notifications`, `invoice_reminders`, `ai_bots`), но **в коде пока не подключены** — соответствующие задачи M1.6.8, M2.2.6, M3.2.7, M4.2.9 в роадмапе открыты.

Как следствие, одноразовые коды входа хранятся не в Redis, а в таблице `otp_codes`: зависимости Redis ещё нет, а код, переживающий перезапуск, предпочтительнее кода, молча исчезающего вместе с процессом. Перенос в Redis станет возможен вместе с M6.2.x.

---

## 3. Структура репозитория

```
GETVOXLY/
├── frontend/          Next.js 15
│   └── src/
│       ├── app/       маршруты (route groups)
│       ├── components/ UI по домену
│       ├── lib/       хуки, контексты, типы, мок-данные
│       ├── schemas/    Zod-схемы форм
│       └── types/      глобальные типы
├── backend/           Fastify 5
│   └── src/
│       ├── app.ts     сборка приложения и монтирование префиксов
│       ├── server.ts  запуск, graceful shutdown
│       ├── db/        пул, транзакции, schema.sql
│       ├── plugins/   authenticate, authorize, errorHandler
│       └── modules/   auth, crm, repairs, finance, marketplace, admin
└── docs/              спецификации (этот каталог)
```

---

## 4. Маршрутизация frontend

Route groups в `frontend/src/app/`:

| Группа | Назначение | Провайдеры |
|---|---|---|
| `(auth)` | `/login` — OTP и email-вход | — |
| `(dashboard)` | рабочее пространство арендатора | `AuthProvider`, `TenantProvider`, `Sidebar` (только `md:`), `Header`, `MobileNavigationBar` (только мобильный) |
| `(admin)` | `/tenants` — платформенная админка | отдельный layout |
| без группы | `/`, `/onboarding` | — |

Страницы `(dashboard)`: `dashboard`, `analytics`, `crm/deals`, `crm/deals/[id]`, `crm/contacts`, `crm/companies`, `crm/tasks`, `repairs`, `repairs/[id]`, `finance`, `modules/ai-bots`, `modules/ai-bots/[id]`, `marketplace`, `settings/ai`, `settings/referral`.

---

## 5. Монтирование backend API

`backend/src/app.ts`:

| Префикс | Модуль | Защита |
|---|---|---|
| `/auth` | `modules/auth` (`otp/send`, `otp/verify`, `login`, `refresh`, `logout`) | публичный |
| `/api/v1/crm` | `modules/crm` (contacts, companies, deals, tasks) | JWT + права домена |
| `/api/v1/repairs` | `modules/repairs` | JWT + модуль `service_center` + права |
| `/api/v1/finance` | `modules/finance/finance.routes.ts` | JWT + модуль `finance` + права |
| `/api/v1/invoices` | `modules/finance/invoices.routes.ts` | JWT + модуль `finance` + права |
| `/api/v1/marketplace` | `modules/marketplace` | JWT + `tenant:admin` |
| `/api/v1/admin` | `modules/admin` | JWT + роль `owner` |
| `/health` | inline в `app.ts` | публичный, проверяет БД |

> Auth смонтирован под `/auth`, **не** под `/api/v1/auth`. Это фактическое состояние кода.

Каждая защищённая группа регистрирует `authenticatePlugin` первой строкой — до создания хуков `requireModule` / `requirePermission` / `requireRole`, которые читают заполняемые им поля запроса. Плагин обёрнут в `fastify-plugin`, иначе `addHook` привязывается к собственному контексту плагина и хук не выполняется ни для одного маршрута (см. `01_03_SECURITY_RBAC.md` §4).

---

## 6. Мультиарендность (`tenant_id`)

Три независимых контура изоляции:

**1. Источник tenant_id — только сервер.** `tenant_id` берётся из проверенного JWT и кладётся в `request.tenant_id` хуком `authenticate` (`backend/src/plugins/authenticate.ts`). Клиент никогда не передаёт `tenant_id` в теле запроса. Пользователь ищется одновременно по `id` и `tenant_id`, поэтому токен одного арендатора не разрешит пользователя другого.

**2. Явный фильтр в каждом запросе.** Все SQL-запросы содержат `WHERE tenant_id = $1`. Значения передаются только как bind-параметры.

**3. RLS как второй барьер.** `withTenant()` (`backend/src/db/client.ts`) открывает транзакцию и выполняет `SELECT set_config('app.tenant_id', $1, true)`. Политики `tenant_isolation` в `schema.sql` сравнивают `tenant_id` с `current_tenant_id()`. Если фильтр в приложении однажды забудут, RLS не отдаст чужие строки.

Особый случай: `invoice_items` не имеет своего `tenant_id` и наследует область через `EXISTS`-подзапрос к `invoices`.

---

## 7. Поток запроса

```
Клиент
  → helmet / cors / rate-limit
  → JWT verify (authenticate)         request.authUser, tenant_id, permissions, installed_modules
  → requireModule / requirePermission / requireRole (authorize)
  → Zod-парсинг params / query / body
  → Service: SQL с WHERE tenant_id, при записи — withTenant + транзакция
  → Ответ в конверте { data, meta? }
  → Ошибка → errorHandler → { error: { code, message, details? } }
```

---

## 8. Конверты ответов

```ts
interface ApiResponse<T> { data: T; meta?: Record<string, unknown> }
interface ApiErrorEnvelope {
  status: "error";
  error: { code: string; message: string; details?: Record<string, string[]> };
}
```

Коды ошибок: `VALIDATION_ERROR`, `UNAUTHORIZED`, `PERMISSION_DENIED`, `NOT_FOUND`, `MODULE_NOT_INSTALLED`, `INVALID_STATUS_TRANSITION`, `REPAIR_ORDER_CLOSED`, `INSUFFICIENT_FUNDS`, `INVOICE_ALREADY_PAID`, `TENANT_INACTIVE`, `OTP_ATTEMPTS_EXCEEDED`, `INTERNAL_SERVER_ERROR`. Стек-трейсы наружу не отдаются (`backend/src/plugins/errorHandler.ts`).

`ZodError` отображается в `400 VALIDATION_ERROR`: ключи `details` — путь до поля с точечной нотацией (`line_items.0.quantity`), значения — списки сообщений. Обработчики вызывают `schema.parse(...)` напрямую, а `ZodError` не несёт `statusCode`, поэтому без явной ветки любая ошибка валидации уходила клиенту как `500`. Клиентские ошибки плагинов (например `429` от rate-limit) сохраняют свой статус и код.

---

## 9. Состояние данных на frontend

Backend API реализован, но страницы frontend пока работают на мок-данных из `frontend/src/lib/**/mock-*.ts` и локальном состоянии React. Типизированный `apiClient` (`frontend/src/lib/api/apiClient.ts`) готов, перевод страниц на реальные запросы — открытые задачи роадмапа (`use-contacts.ts`, `use-deals.ts`, `use-invoices.ts` и др.).

---

## 10. Ссылки

- Схема БД: `docs/01_ARCHITECTURE/01_02_DATABASE_SCHEMA.md`
- Роли и авторизация: `docs/01_ARCHITECTURE/01_03_SECURITY_RBAC.md`
- Контракты API: `docs/03_API_CONTRACTS/`
- Стандарты кода: `.cursorrules`
