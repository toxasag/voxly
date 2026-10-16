# 01_03 — Безопасность и RBAC

> Источник: `backend/src/plugins/authenticate.ts`, `backend/src/plugins/authorize.ts`, `backend/src/types/index.ts`, `frontend/src/components/shared/Guard.tsx`.

---

## 1. Принцип

Backend — источник правды по правам. UI скрывает недоступное, но решение о доступе всегда принимает сервер. Проверка в интерфейсе косметическая.

---

## 2. Роли

`Role = "owner" | "admin" | "manager" | "technician" | "viewer"`

Иерархия (`ROLE_HIERARCHY`, одинаково в `backend/src/plugins/authorize.ts` и `frontend/src/components/shared/Guard.tsx`):

| Роль | Наследует |
|---|---|
| `owner` | owner, admin, manager, technician, viewer |
| `admin` | admin, manager, technician, viewer |
| `manager` | manager, technician, viewer |
| `technician` | technician, viewer |
| `viewer` | viewer |

Назначение:

| Роль | Назначение |
|---|---|
| `owner` | владелец: подписка, баланс AI, статус арендатора |
| `admin` | администратор рабочего пространства, модули |
| `manager` | продажи: сделки, контакты, компании, задачи |
| `technician` | мастер сервиса: заказ-наряды, работы, запчасти |
| `viewer` | чтение |

---

## 3. Права

`Permission` (19 значений, `backend/src/types/index.ts`):

```
contacts:read | contacts:write | contacts:delete
companies:read | companies:write | companies:delete
deals:read | deals:write
tasks:read | tasks:write
service_center:read | service_center:write
finance:read | finance:write | finance:admin
ai_bots:read | ai_bots:configure
tenant:admin | billing:manage
```

Права хранятся в `users.permissions TEXT[]`. При загрузке пользователя значения, отсутствующие в модели, отбрасываются — устаревшая строка в БД не создаёт неизвестного права.

`tenant:admin` — надмножество: `requirePermission` пропускает такого пользователя к любому арендуемому праву.

---

## 4. Аутентификация

Плагин `authenticate` (`backend/src/plugins/authenticate.ts`), хук `onRequest`:

1. Публичные пути пропускаются: `/auth/otp/send`, `/auth/otp/verify`, `/auth/login`, `/auth/refresh`, `/health`.
2. Требуется заголовок `Authorization: Bearer <jwt>`; иначе `401 UNAUTHORIZED`.
3. `fastify.jwt.verify` проверяет подпись и срок. Невалидный токен — `401`.
4. Полезная нагрузка сужается типовым guard-ом: обязательны строковые `sub` и `tenant_id`.
5. Пользователь загружается запросом `WHERE id = $1 AND tenant_id = $2` — токен одного арендатора не разрешит пользователя другого.
6. В `request` кладутся `authUser`, `tenant_id`, `permissions: Set<Permission>`, `installed_modules: string[]`.

Дополнительно шаг 4.5: токены с `typ`, отличным от `access`, отклоняются — refresh-токен нельзя предъявить как bearer.

Плагин обёрнут в `fastify-plugin`, и это принципиально. Без обёртки `addHook` привязывается к собственному (не содержащему маршрутов) контексту инкапсуляции плагина, поэтому хук не выполняется **ни для одного** маршрута: `request.authUser` остаётся `undefined`, и запрос падает в `assertAuthenticated` из `authorize.ts` с `401 "Authentication required"`. Именно в этом состоянии находился код до 2026-08-18 — включая группы `/api/v1/crm` и `/api/v1/repairs`, где плагин формально регистрировался.

Скоуп при этом сохраняется: хук поднимается только до контекста той группы, которая его зарегистрировала, и не затрагивает публичные `/auth/*` и `/health`. Проверено эмпирически: регистрация в трёх разных группах даёт по одному срабатыванию на запрос и ноль срабатываний на публичных маршрутах. Список `PUBLIC_PATHS` внутри хука сохранён как второй барьер на случай будущей ошибочной регистрации.

Ошибки БД намеренно не попадают в `catch` вокруг `jwt.verify`, иначе сбой базы маскировался бы под `401`.

JWT: `@fastify/jwt`, секрет из валидированного `JWT_SECRET`, срок из `ACCESS_TOKEN_TTL` (по умолчанию 15 минут). Пароли — argon2 (`AuthService.hashPassword` / `verifyPassword`).

Текущее состояние: выдача токенов работает на реальных `users` и `tenants`. Заглушки `temp-user-id` / `temp-tenant-id` удалены; OTP хранится в `otp_codes` как argon2-хеш с лимитом попыток, refresh-токены — в `refresh_tokens` как SHA-256-дайджесты с ротацией и обнаружением повторного использования. Открыты: реальная доставка OTP (M0.6.2) и httpOnly-cookie (M0.6.5). Подробности контракта — `03_01_AUTH_API.md`.

---

## 5. Авторизация

Плагин `authorize` (`backend/src/plugins/authorize.ts`) добавляет три фабрики хуков:

| Декоратор | Поведение | Ошибка |
|---|---|---|
| `requirePermission(p)` | пропускает при наличии `p` или `tenant:admin` | `403 PERMISSION_DENIED` |
| `requireModule(slug)` | пропускает, если `slug` в `installed_modules` | `403 MODULE_NOT_INSTALLED` |
| `requireRole(roles)` | пропускает, если роль покрывает одну из `roles` по иерархии | `403 PERMISSION_DENIED` |

Плагин обёрнут в `fastify-plugin` осознанно: декораторы должны жить на корневом инстансе, чтобы любая группа вызывала `app.requirePermission(...)`. Сами фабрики хуков не добавляют, поэтому подъём в корень не влияет на маршрутизацию. Регистрируется один раз в `app.ts`.

`MODULE_NOT_INSTALLED` отделён от `PERMISSION_DENIED`, чтобы клиент мог предложить установку модуля, а не сообщать о нехватке прав.

Все хуки предварительно проверяют, что `request.authUser` заполнен, иначе `401`.

---

## 6. Защита по маршрутам

| Префикс | Модуль | Права |
|---|---|---|
| `/api/v1/crm/contacts` | — | `contacts:read` / `contacts:write` / `contacts:delete` |
| `/api/v1/crm/companies` | — | `companies:read` / `companies:write` / `companies:delete` |
| `/api/v1/crm/deals` | — | `deals:read` / `deals:write` |
| `/api/v1/crm/tasks` | — | `tasks:read` / `tasks:write` |
| `/api/v1/repairs` | `service_center` | `service_center:read` / `service_center:write` |
| `/api/v1/finance` | `finance` | `finance:read` / `finance:write` |
| `/api/v1/invoices` | `finance` | `finance:read` / `finance:write` |
| `/api/v1/marketplace` | — | `tenant:admin` |
| `/api/v1/admin` | — | роль `owner` |

Удаление в CRM — мягкое (`deleted_at`), отдельным правом `*:delete` там, где оно объявлено.

---

## 7. Изоляция арендатора

Три контура (подробнее — `01_01_SYSTEM_OVERVIEW.md` §6 и `01_02_DATABASE_SCHEMA.md` §7):

1. `tenant_id` только из JWT, никогда из тела запроса.
2. Явный `WHERE tenant_id = $1` в каждом запросе, значения — bind-параметры.
3. RLS-политики поверх GUC `app.tenant_id`, выставляемого `withTenant()`.

---

## 8. Guard на frontend

`frontend/src/components/shared/Guard.tsx` — композитный компонент:

```tsx
<Guard requiredPermission="finance:read" requiredModule="finance">…</Guard>
```

Проверяет `requiredRole`, `requiredPermission`, `requiredModule`. При непрохождении рендерит `fallback` (по умолчанию `null`) — элемент **скрывается**, а не блокируется. Навигация в `Sidebar` фильтрует пункты модулей по `installed_modules`.

Применён на страницах `repairs`, `finance`, `modules/ai-bots` (список и деталь), а также на действии «Configure» бота (`ai_bots:configure`).

---

## 9. Транспорт и ограничения

`backend/src/app.ts`: `@fastify/helmet`, `@fastify/cors` (origin из валидированного `CORS_ORIGIN`, `credentials: true`), `@fastify/rate-limit` (100 запросов в минуту по IP).

Конфигурация проверяется Zod-схемой при старте (`backend/src/config/env.ts`): сервер не поднимается при отсутствии `DATABASE_URL` или `JWT_SECRET`, а в `production` дополнительно запрещены placeholder-секреты и секреты короче 32 символов. Прежний инлайновый фолбэк `"change-me-in-production"` удалён, поэтому production не может подняться с публично известным ключом подписи.

Открыто: пер-арендаторные лимиты (M6.2.1), структурное логирование (M6.2.2).

---

## 10. Обработка ошибок

`backend/src/plugins/errorHandler.ts` приводит всё к конверту `{ status: "error", error: { code, message, details? } }`. Наружу уходят только `code`, `message` и опциональные `details` с ошибками по полям. Внутренние исключения превращаются в `500 INTERNAL_SERVER_ERROR` без стека; ошибки от 500 и выше логируются.

`ZodError` обрабатывается отдельной ветвью и даёт `400 VALIDATION_ERROR`. Это существенно с точки зрения безопасности и наблюдаемости: обработчики маршрутов вызывают `schema.parse(...)` напрямую, а `ZodError` не несёт `statusCode`, поэтому ранее любая ошибка валидации возвращалась клиенту как `500` и попадала в лог как внутренняя ошибка, маскируя реальные сбои.

---

## 11. Открытые задачи безопасности

- `M0.6.2` — реальная доставка OTP; сейчас код пишется в лог на уровне `debug`.
- `M0.6.5` — httpOnly-cookie для токенов (`@fastify/cookie` не установлен); сейчас токены возвращаются в теле ответа.
- `M0.6.9` — RLS-политики описаны в `schema.sql`, но не проверены на живой БД и не форсированы: `FORCE ROW LEVEL SECURITY` не выставлен, поэтому подключение от владельца таблиц политики обходит. Отдельно: `authenticate` читает `installed_modules` вне `withTenant`, что при переходе на ограниченную роль превратит все модульные маршруты в `403`.
- `M5.2.3` — управление ролями через API.
- `M5.2.8` — автоматический аудит операций записи (`tenant_audit_log` пока пишется точечно: смена модулей и правки арендатора).
- `M6.3.3` — интеграционные тесты на auth-поток; регрессия неработающего хука `authenticate` не была бы замечена без них.
- `M6.4.10` — аудит зависимостей и секретов.
- `M7.2.*` — контур аутентификации на frontend: `middleware.ts` не защищает реальные URL, права захардкожены в контексте.
