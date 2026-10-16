# 02_00 — Лендинг, Auth OTP Hub и онбординг

> Источник: `frontend/src/app/page.tsx`, `frontend/src/app/(auth)/login/page.tsx`, `frontend/src/components/auth/`, `frontend/src/schemas/auth.schema.ts`, `frontend/src/schemas/onboarding.schema.ts`, `frontend/src/lib/auth/use-auth.tsx`, `frontend/middleware.ts`.

---

## 1. Область

Вход в продукт: корневой маршрут, аутентификация по телефону/e-mail и первичная настройка рабочего пространства.

Отдельной маркетинговой лендинг-страницы в коде нет: `frontend/src/app/page.tsx` выполняет редирект на `/login`. Публичная посадочная страница — незакрытая задача.

---

## 2. Маршруты

| Маршрут | Файл | Назначение |
|---|---|---|
| `/` | `app/page.tsx` | редирект на `/login` |
| `/login` | `app/(auth)/login/page.tsx` | вход: OTP по телефону или e-mail + пароль |
| `/onboarding` | `app/onboarding/page.tsx` | визард первичной настройки |

Защита маршрутов — Edge middleware (`frontend/middleware.ts`): неаутентифицированный пользователь отправляется на `/login`.

---

## 3. Auth OTP Hub

Компонент `frontend/src/components/auth/PhoneOtpAuth.tsx`. Два режима, переключаемых вкладками.

### Шаг 1 — телефон и канал доставки

- Поле номера с маской `+7 999 999 99 99` (`formatPhone` в `frontend/src/lib/utils.ts`).
- Выбор канала: Telegram, WhatsApp, RuMAX, SMS.
- Валидация: `phoneSchema` в `frontend/src/schemas/auth.schema.ts` — формат номера и обязательный канал.

### Шаг 2 — код подтверждения

- Ввод 6 цифр, `inputMode="numeric"`, автофокус.
- Таймер обратного отсчёта 60 секунд, кнопка повторной отправки после его истечения.
- Валидация: `otpSchema`.

### Альтернатива — e-mail и пароль

Форма `email` + `password`, схема `emailLoginSchema`.

### Состояние

`AuthProvider` (`frontend/src/lib/auth/use-auth.tsx`) предоставляет `login`, `loginWithOtp`, `logout`, `switchTenant` и хуки `useCurrentUser`, `useRole`, `useIsAuthenticated`. Сессия сейчас мок-овая: токен-заглушка кладётся в `localStorage` под ключом `getvoxly_auth_token` и восстанавливается при загрузке.

Backend-контракт описан в `docs/03_API_CONTRACTS/03_01_AUTH_API.md`. Frontend на него пока не переведён.

---

## 4. Онбординг-визард

Компонент `frontend/src/components/auth/OnboardingWizard.tsx`, схемы в `frontend/src/schemas/onboarding.schema.ts`. Четыре шага, переход вперёд заблокирован до `formState.isValid`.

| Шаг | Поля | Правила |
|---|---|---|
| 1. Владелец | `first_name`, `last_name` | оба обязательны |
| 2. Рабочее пространство | `company_name`, `slug`, `currency`, `timezone` | slug по `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–30 символов, генерируется из названия; валюта RUB/USD/EUR/KZT/BYN; 15 таймзон |
| 3. Сфера деятельности | Сервисный центр / Торговля / Услуги | обязательный выбор, показывает предустанавливаемые модули |
| 4. Итог | обзор введённого | сохранение и переход в `/dashboard` |

**Автоподбор модулей по сфере:**

| Сфера | Модули |
|---|---|
| Сервисный центр | `service_center`, `ai_bots` |
| Торговля | `finance` |
| Услуги | `finance`, `ai_bots` |

Индикация прогресса: полоса `amber-500` и четыре кружка-шага; кликабельны только пройденные шаги.

Финал сохраняет состояние в `localStorage` под ключом `getvoxly_onboarding` и редиректит на `/dashboard`. Записи в БД пока нет.

---

## 5. Правила интерфейса

Палитра и паттерны — `.cursorrules` §6: фон `slate-950`, карточки `slate-900`, границы `slate-800/700`, акцент `amber-500`, вторичный `orange-400`, ошибки `rose-500`. Иконки только Lucide.

Все мутации показывают состояние загрузки, блокируют кнопку отправки и выводят ошибки через `<FormMessage />`.

---

## 6. Открытые задачи

- Публичная лендинг-страница.
- `M0.4.2` — вынести шаг ввода кода на отдельный `/verify` (сейчас внутри `PhoneOtpAuth`).
- `M0.4.5` — хранение JWT в httpOnly-cookie.
- `M0.4.8` — состояния ошибок: неверный код, истёкший код, превышение попыток.
- `M0.6.2`–`M0.6.5` — реальная отправка OTP через Redis (TTL 5 минут), верификация, refresh, logout.
- Сохранение результата онбординга в `tenants` и `installed_modules`.
