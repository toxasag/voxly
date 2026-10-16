# 02_06 — SaaS-админка, маркетплейс и реферальная программа

> Frontend: `frontend/src/app/(admin)/tenants/page.tsx`, `frontend/src/app/(dashboard)/marketplace/page.tsx`, `frontend/src/app/(dashboard)/settings/referral/page.tsx`, `frontend/src/components/admin/`.
> Backend: `backend/src/modules/admin/`, `backend/src/modules/marketplace/`.

---

## 1. Область

Три связанных блока: платформенное управление арендаторами, каталог подключаемых модулей и партнёрская программа.

---

## 2. Маршруты

| Маршрут | Файл | Доступ |
|---|---|---|
| `/tenants` | `app/(admin)/tenants/page.tsx` | владелец платформы |
| `/marketplace` | `app/(dashboard)/marketplace/page.tsx` | администратор арендатора |
| `/settings/referral` | `app/(dashboard)/settings/referral/page.tsx` | арендатор |

`(admin)` — отдельная route group со своим layout, вне оболочки рабочего пространства.

---

## 3. Администрирование арендаторов

**Компоненты:** `TenantsTable.tsx`, `TenantManageModal.tsx`.

**Backend:** `backend/src/modules/admin/admin-tenants.routes.ts`, префикс `/api/v1/admin`, защита `requireRole(["owner"])`.

| Эндпоинт | Назначение |
|---|---|
| `GET /api/v1/admin/tenants` | список арендаторов |
| `PATCH /api/v1/admin/tenants/:id` | изменение подписки, статуса и баланса AI |

**Поля арендатора** (`tenants`): `name`, `plan`, `status`, `ai_tokens_balance`, `subscription_expires_at`.

**Статусы подписки:** `trial`, `active`, `past_due`, `suspended`.

**Изменяемые через API поля** (`backend/src/modules/admin/admin.types.ts`):

| Поле | Правило |
|---|---|
| `status` | одно из четырёх значений |
| `subscription_expires_at` | ISO-дата или `null` (продление либо снятие срока) |
| `ai_tokens_balance` | целое неотрицательное |

Каждое изменение пишется в `tenant_audit_log`: `action = 'tenant.update'`, `entity_type = 'tenant'`, снимок изменений в JSONB-поле `details`.

Модальное окно `TenantManageModal.tsx` дополнительно показывает данные владельца и переключатели модулей.

---

## 4. Маркетплейс модулей

**Backend:** `backend/src/modules/marketplace/marketplace.routes.ts`, префикс `/api/v1/marketplace`, защита `requirePermission("tenant:admin")`.

| Эндпоинт | Назначение |
|---|---|
| `GET /api/v1/marketplace/modules` | каталог с признаком установки для текущего арендатора |
| `POST /api/v1/marketplace/modules/:slug/toggle` | включение или отключение модуля |

**Каталог** — таблица `marketplace_modules` (не арендуемая): `slug`, `name`, `description`, `price_monthly`, `is_available`. Засеяны три модуля:

| Slug | Название | Цена, ₽/мес |
|---|---|---|
| `service_center` | Service Center | 1990 |
| `finance` | Finance & Invoices | 2490 |
| `ai_bots` | AI Bots | 3990 |

Список формируется `LEFT JOIN` каталога с `installed_modules` по текущему `tenant_id`, поэтому в ответе сразу есть `installed` и `installedAt`. Недоступные модули (`is_available = false`) не показываются.

**Переключение** выполняется в транзакции:

- включение — `INSERT INTO installed_modules … ON CONFLICT DO NOTHING` (повторный вызов безопасен);
- отключение — `DELETE FROM installed_modules`;
- в обоих случаях запись в `tenant_audit_log` с действием `module.install` или `module.uninstall`.

**Последствия.** `installed_modules` читает хук `authenticate` при каждом запросе, а `requireModule` опирается на этот список. Отключение модуля немедленно закрывает его API (`403 MODULE_NOT_INSTALLED`) и убирает пункты из навигации: `Sidebar` фильтрует ссылки, а `Guard` скрывает содержимое.

Frontend-каталог (`frontend/src/lib/mock/marketplace-data.ts`) содержит шесть карточек, включая ещё не реализованные интеграции Telegram и WhatsApp; на backend их пока нет.

---

## 5. Реферальная программа

**Компонент:** `ReferralTab.tsx`, страница `/settings/referral`.

Модель данных (`frontend/src/types/index.ts`):

- `ReferralStats` — `referral_code`, `referral_link`, `total_invited`, `total_earned`, `available_payout`;
- `ReferralPayout` — `amount`, `currency`, `status` (`pending`/`completed`), `method`, `created_at`, `paid_at`.

Интерфейс: реферальный код и ссылка для копирования, счётчик приглашённых, накопленное вознаграждение, доступная к выплате сумма, история выплат.

**Состояние:** только frontend на мок-данных (`MOCK_REFERRAL_STATS`, `MOCK_REFERRAL_PAYOUTS`). Таблиц и эндпоинтов для программы в backend нет.

---

## 6. Аудит

Таблица `tenant_audit_log`: `tenant_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `details JSONB`, `created_at`.

Сейчас пишется точечно — при переключении модулей и правках арендатора. Автоматическое логирование всех операций записи и эндпоинт чтения журнала — открытые задачи.

---

## 7. Права

| Действие | Требования |
|---|---|
| Просмотр и переключение модулей | `tenant:admin` |
| Управление арендаторами | роль `owner` |
| Биллинг | `billing:manage` (объявлено, эндпоинтов нет) |

---

## 8. Открытые задачи

- `M5.1.2` — настройки арендатора: название, логотип, таймзона, язык.
- `M5.1.4` — редактор ролей с правами по модулям.
- `M5.1.6` — лимиты тарифа и счётчики потребления.
- `M5.1.7` — интерфейс журнала аудита.
- `M5.1.8` — обзор биллинга и история счетов.
- `M5.1.9` — обёртка админ-страниц в `Guard` с правом `tenant:admin`.
- `M5.2.1`–`M5.2.3` — API настроек арендатора, пользователей и ролей.
- `M5.2.5` — эндпоинт чтения журнала аудита.
- `M5.2.6`, `M5.2.10` — интеграция со Stripe и обработчик вебхуков.
- `M5.2.7` — таблицы `roles`, `user_roles`, `plans`, `subscriptions`.
- `M5.2.8` — автоматический аудит всех операций записи.
- Перенос реферальной программы на backend.
