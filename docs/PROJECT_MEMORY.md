# GETVOXLY — Память проекта

## Ссылки на мастер-документы:
- docs/00_INDEX.md
- docs/01_ARCHITECTURE
- docs/04_PROJECT_STATE
- docs/ACTION_PLAN_TRACKER.md

## Стек и окружение
- Next.js (App Router), Node.js, Prisma / SQLite / Postgres.
- Внешний домен: https://getvoxly.com / https://vibecode.team-big.ru/.
- Интеграции: Telegram bot / user api, CRM deals & contacts pipeline.

## 2026-11-20: Устранение сбоя RLS при регистрации и внедрение бесшовной Telegram-авторизации
- **Root Cause (P0):** При регистрации (`POST /auth/register`) на этапе создания арендатора выполнялась вставка в `ai_balance_topups` (стартовый баланс 50 000 коп) и `tenant_notification_channels`. Обе таблицы имеют `FORCE ROW LEVEL SECURITY` с политикой `tenant_id = current_tenant_id()`. Так как регистрирующийся пользователь ещё не авторизован, параметр PostgreSQL `app.tenant_id` был равен `NULL`, что приводило к ошибке `42501 new row violates row-level security policy for table "ai_balance_topups"` и возвращало 500 Internal Server Error (toast в UI).
- **Решение:** В `AuthService.register()` сразу после создания записи в `tenants` вызывается `await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);` и `setRequestTenant(tenant.id);`. Это устанавливает транзакционный контекст RLS для последующих вставок баланса и каналов уведомлений. Также фиксируется запись в `tenant_audit_log` с действием `tenant.register`.
- **Аудит и логирование авторизации:** Внедрено структурированное логирование во все шаги авторизации: `AuthSessionService` (`requestCode`, `status`, `bindRecipient`, `verifyCode`, `consumeVerifiedIn`), Fastify роуты (`/auth/code/request`, `/telegram/webhook`, `/auth/register`). Все персональные данные (номера телефонов, e-mail, токены) маскируются (`maskPhone`, `maskEmail`, `maskToken`).
- **Бесшовная Telegram-авторизация (реверс-инжиниринг noovkus):** При старте бота по ссылке `https://t.me/<bot>?start=auth_<token>` Telegram Bot API webhook привязывает чат и выставляет `verified_at = now()` в сессии. Опрос `/auth/code/status` сообщает фронтенду `verified: true`, форма `RegisterForm` отображает подтверждённый статус Telegram и позволяет завершить регистрацию в 1 клик без ручного ввода цифр, сохраняя при этом возможность ручного ввода OTP при необходимости.
