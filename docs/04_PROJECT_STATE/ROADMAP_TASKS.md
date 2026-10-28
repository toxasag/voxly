# ROADMAP — Atomic Task Checklist (Frontend-First)

> **Frontend-First Strategy:** All UI is built first against mock data / MSW handlers.
> Backend wiring happens after the UI is reviewed and approved.
> Each task is an atomic unit of work — one PR, one feature slice.

---

## Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done |
| `[-]` | Cancelled / Descoped |

---

## Milestone 0 — Project Scaffold

### M0.1 — Repository & Tooling
- [x] `M0.1.1` Initialize monorepo: `/frontend` (Next.js 15) + `/backend` (Fastify 5) — both packages exist, build and typecheck cleanly
- [~] `M0.1.2` Configure TypeScript strict mode, ESLint, Prettier across both packages — strict mode + ESLint configured in both, `tsc --noEmit` passes with 0 errors; Prettier not set up
- [ ] `M0.1.3` Set up Husky pre-push hook: lint + typecheck on staged files
- [x] `M0.1.4` Configure Tailwind CSS 4 + `@/` path alias in `tsconfig`
- [ ] `M0.1.5` Install shadcn/ui, initialize `components.json`, add base primitives (Button, Input, Card, Dialog, DropdownMenu, Skeleton, Separator, Badge, Table, Form, Toast)

### M0.2 — Design System Foundation
- [ ] `M0.2.1` Define CSS custom properties: `--background: slate-950`, `--card: slate-900`, `--primary: amber-500`, `--destructive: rose-500`, etc.
- [x] `M0.2.2` Apply dark theme to `<html>` / `<body>` in root layout
- [x] `M0.2.3` Build `<StatusBadge>` shared component — 5 variants (success/warning/destructive/info/neutral) using cn() and 21st-shadcn palette
- [x] `M0.2.4` Build `<EmptyState>` shared component (icon + title + description + optional action)
- [~] `M0.2.5` Build `<PageHeader>` shared component (inlined in pages)
- [ ] `M0.2.6` Build `<ConfirmDialog>` wrapper (shadcn AlertDialog preset)

### M0.3 — Base Layout Shell (Frontend)
- [x] `M0.3.1` Create `app/(dashboard)/layout.tsx` — sidebar + header + content area
- [x] `M0.3.2` Build `<Sidebar>` — collapsible `w-60` / `w-16`, nav links, tenant switcher placeholder
- [x] `M0.3.3` Build `<Header>` — `h-16` sticky, search, notifications bell, quick-create dropdown, theme toggle
- [x] `M0.3.4` Build `<SidebarLink>` — active state highlight (`amber-500`), collapsed tooltip, icon-only mode
- [x] `M0.3.5` Create `app/(auth)/layout.tsx` — centered card layout for login/OTP pages (via root layout + page centering)
- [ ] `M0.3.6` Build responsive mobile sidebar (sheet overlay via shadcn `<Sheet>`)

### M0.4 — Auth OTP Hub (Frontend)
- [x] `M0.4.1` Create `app/(auth)/login/page.tsx` — phone/email input, send OTP button, countdown timer
- [ ] `M0.4.2` Create `app/(auth)/verify/page.tsx` — 6-digit OTP input (auto-focus, paste support) (integrated into PhoneOtpAuth component)
- [x] `M0.4.3` Build `auth.schema.ts` — Zod schemas for login + verify
- [x] `M0.4.4` Build `use-auth.tsx` — auth context provider with `login`, `loginWithOtp`, `logout`, `switchTenant`, `useCurrentUser`, `useRole`, `useIsAuthenticated` hooks
- [ ] `M0.4.5` Store JWT in httpOnly cookie (handled by backend; frontend just calls `/auth/*`)
- [x] `M0.4.6` Implement route protection: middleware redirects unauthenticated users to `/login` — Edge middleware в `frontend/src/middleware.ts` (не в корне пакета: при каталоге `src/` Next.js ищет его только там, иначе он не компилируется)
- [x] `M0.4.7` Build "Resend OTP" with cooldown timer (60s timer)
- [x] `M0.4.8` Handle error states: invalid code, expired code, too many attempts → toast — ошибки сервера переводятся на русский и показываются и на поле, и как toast (`sonner`, `richColors`); `401` от `/auth/*` больше не трактуется как истёкшая сессия

### M0.7 — Публичная регистрация и поддомены арендаторов
- [x] `M0.7.1` `tenants.slug` + `reserved_slugs` — миграция `0003_tenant_slug.sql`: глобальная уникальность, CHECK формата DNS-метки, 32 служебных имени; заполнение существующих арендаторов транслитерацией с разведением коллизий, идемпотентна
- [x] `M0.7.2` `POST /auth/register` — арендатор + поддомен + владелец (`owner`, 19 permissions) в одной транзакции, сразу выдаёт токены; гонку за slug разрешает уникальный индекс (`23505` → ошибка поля)
- [x] `M0.7.3` `GET /auth/slug-available` — живая проверка занятости (рекомендательная, арбитр — индекс в БД)
- [x] `M0.7.4` `tenant.slug` в ответах `/auth/*` и в `Tenant` на frontend
- [x] `M0.7.5` Разбор поддомена из `Host` в middleware → заголовок `x-tenant-slug`; платформенные хосты (`getvoxly.ru`, `www`, `app`, `api`, `admin`) не считаются арендаторскими; `/superadmin` недоступен на поддомене арендатора. 16 кейсов
- [x] `M0.7.6` Страница `/register` — автогенерация slug с транслитерацией кириллицы, индикатор занятости, подтверждение пароля, редирект на `https://{slug}.getvoxly.ru/dashboard`
- [x] `M0.7.7` `TenantPortalGuard` — возврат в свой портал при открытии чужого поддомена (навигационное удобство; изоляцию держат токен и RLS)
- [x] `M0.7.8` Перенос сессии между поддоменами — оба токена дублируются в cookie с `Domain=.getvoxly.ru`, потому что `localStorage` привязан к origin и после редиректа на поддомен сессия не восстанавливалась
- [ ] `M0.7.9` Смена поддомена после регистрации (сейчас задаётся только при создании) — вместе с `M5.1.2`
- [ ] `M0.7.10` Подтверждение e-mail при регистрации: телефон теперь подтверждается кодом из Telegram (`M0.8`), но адрес по-прежнему не верифицируется
- [~] `M0.7.11` Rate limit строже общего: `POST /auth/code/request` ограничен 5/мин (каждый вызов пишет в чужой Telegram-чат); для `/auth/register` и `/auth/slug-available` остаётся общий лимит 100/мин

### M0.8 — Авторизация через Telegram-бота (@GetVoxlybot)
- [x] `M0.8.1` `users.telegram_chat_id` + `telegram_username` с частичным уникальным индексом (миграция `0004_telegram_auth.sql`): один Telegram-аккаунт не может управлять несколькими учётными записями
- [x] `M0.8.2` Таблица `auth_sessions` — OTP до создания пользователя (регистрация) и второй фактор входа; хранит канал, хеш кода, `deep_link_token`, признаки `delivered/verified/consumed`. Прежняя `otp_codes` ключуется по телефону существующего пользователя и для регистрации не годится
- [x] `M0.8.3` `TelegramService` — `sendMessage` при известном `chat_id`, deep-link `?start=auth_<token>` при первой привязке, таймаут 10 с на вызовы Bot API
- [x] `M0.8.4` `POST /auth/telegram/webhook` — обработка `/start`, привязка `chat_id` к сессии и мгновенная отправка кода; защита секретом в заголовке `X-Telegram-Bot-Api-Secret-Token` (без него `401`)
- [x] `M0.8.5` Автоматическая регистрация webhook при старте — у бота был прописан адрес удалённого легаси-стека, отдающий `404`, и обновления уходили в никуда
- [x] `M0.8.6` `POST /auth/code/request` (лимит 5/мин) + `GET /auth/code/status` для опроса доставки: код приходит не в ответе, а после нажатия Start в боте
- [x] `M0.8.7` `POST /auth/login/verify` — вход по паролю **и** коду; пароль проверяется первым, чтобы код не подменял пароль
- [x] `M0.8.8` `POST /auth/register` требует подтверждённую сессию; код проверяется до создания арендатора, поэтому неподтверждённый номер не может занять поддомен
- [x] `M0.8.9` Форма `/register` сведена к 5 полям (адрес портала, e-mail, пароль, повтор, телефон) + выбор Telegram/MAX + код; «Название компании» и «Имя» убраны
- [x] `M0.8.10` Форма `/login`: e-mail, пароль, выбор канала, код
- [x] `M0.8.11` Транспорт MAX (@id505030516451_bot): `users.max_user_id` + `auth_sessions.max_user_id` (миграция `0006_max_auth.sql`), `MaxService` на `platform-api2.max.ru` (токен в заголовке `Authorization`, адресат в query, `format: html`), `POST /auth/max/webhook` с секретом `X-Max-Bot-Api-Secret`, подписка `POST /subscriptions` при каждом старте (MAX отписывает бота после 8 ч неудач). Канал стал параметром пути в `AuthSessionService`, а не веткой: deep-link токен сверяется вместе с каналом, поэтому ссылка Telegram не привязывает MAX-аккаунт
- [x] `M0.8.12` Очистка просроченных строк аутентификации: `services/auth-maintenance.service.ts`, расписание раз в сутки в процессе API (Redis/BullMQ в стеке нет, а работа идемпотентна). Покрыты `otp_codes`, `auth_sessions`, `password_reset_tokens`, `refresh_tokens` и токены просроченных приглашений. Сроки хранения разные и не нулевые: удалив просроченный код сразу, сервер отвечал бы «Неверный код» вместо «Срок действия истёк»; refresh-токен хранится 30 дней, иначе кража токена перестала бы гасить семью сессий; у приглашения снимается только токен — строка занимает место в тарифе, и её удаление остаётся решением администратора. `replaced_by` без `ON DELETE` учтён: удаляются звенья без потомков, цепочка ротации разбирается с хвоста
- [x] `M0.8.13` Второй фактор сделан обязательным: legacy `POST /auth/login` теперь всегда отвечает `401 SECOND_FACTOR_REQUIRED`, а рабочий вход идёт через `/auth/code/request` → `/auth/login/verify`; восстановление сессии продолжает использовать `/auth/me` и `/auth/refresh`, не логин без кода.
- [x] `M0.8.14` Смена собственного пароля с проверкой текущего (`POST /api/v1/profile/password`) — прежде пароль можно было изменить только по ссылке из письма

### M0.9 — Восстановление пароля и UX формы входа
- [x] `M0.9.1` Таблица `password_reset_tokens` (миграция `0007_password_reset.sql`): SHA-256 от токена, `consumed_at`, TTL 60 мин, вне RLS (строка ищется по хешу до появления tenant-контекста, как `otp_codes`)
- [x] `M0.9.2` `POST /auth/forgot-password` (лимит 5/мин) — ответ одинаков для известного и неизвестного адреса, включая отказ SMTP: иначе эндпоинт проверял бы регистрацию e-mail
- [x] `M0.9.3` `POST /auth/reset-password` (лимит 10/мин) — argon2id-хеш, токен одноразовый (`FOR UPDATE` против параллельных переходов), **все refresh-токены пользователя отзываются**
- [x] `M0.9.4` Брендированное письмо сброса (`EmailService.sendPasswordResetEmail`) — кнопка + дублирующая текстовая ссылка, потому что часть клиентов вырезает кнопки-таблицы
- [x] `M0.9.5` Компонент `PasswordField` с иконкой глаза (`Eye`/`EyeOff`) — общий для входа, регистрации и сброса; `tabIndex={-1}` у переключателя, чтобы он не вставал между паролем и кнопкой отправки
- [x] `M0.9.6` Форма входа: при `401` на пароле появляется «Забыли пароль? Восстановить доступ»; ссылка доступна и до ошибки — знающий о забытом пароле не должен сначала получать отказ
- [x] `M0.9.7` Кликабельные подсказки подключения каналов вместо жёлтого текста: `awaiting_bot` показывает «Подключить {канал} через @{бот}» с deep-link; кнопка «Получить код» больше не блокируется при выборе MAX
- [x] `M0.9.8` Страница `/reset-password` — серверный компонент читает `token` из `searchParams` (без мигания состояния до гидрации), два поля с показом пароля, состояния «ссылка без токена» и «пароль обновлён»
- [x] `M0.9.9` Уведомление владельца о смене пароля отдельным письмом: после смены из профиля или по ссылке восстановления отправляется асинхронное предупреждение; отказ SMTP не отменяет успешную смену.

### M0.12 — Исправления по code review авторизации
- [x] `M0.12.1` `optionalNonEmpty` в `config/env.ts`: пустая строка приравнена к «не задано». Форма `${VAR:-}` в compose подставляет `""`, из-за чего необязательный `MAX_WEBHOOK_SECRET` валил валидацию окружения и уводил бэкенд в restart-loop
- [x] `M0.12.2` Секрет webhook обязателен, если задан токен соответствующего бота (проверка в `env.ts`); отсутствие ожидаемого секрета в обработчике = `401`, а не пропуск проверки; сравнение constant-time. Применено к Telegram и MAX
- [x] `M0.12.3` Запись `telegram_chat_id`/`max_user_id` убрана из обработчика `/start`: телефон `register`-сессии не подтверждён, и по совпадению номера привязка жертвы указывала на чужой чат (обход второго фактора). Адресат сохраняется только после доказанного входа (`linkVerifiedRecipient`, по `users.id`) либо переносится на создаваемого владельца при регистрации
- [x] `M0.12.4` Потолок 600/мин на webhook-ах вместо полного отсутствия лимита; исключение из общего лимита сверяется по точному пути, а не по префиксу
- [x] `M0.12.5` argon2 вынесен за пределы транзакций в `requestCode` и `bindRecipient` — хеширование удерживало соединение из пула (max 10) и блокировку `FOR UPDATE`
- [x] `M0.12.14` Корень «Russian Trusted Root CA» (Минцифры) вкомпилирован в образ бэкенда (`backend/certs/` + `update-ca-certificates`) и подключён к Node через `NODE_EXTRA_CA_CERTS`: `platform-api2.max.ru` предъявляет сертификат этого УЦ, без него любой вызов MAX Bot API падает с `fetch failed`. Одной установки в системный store недостаточно — Node использует собственный набор корней
- [x] `M0.12.6` Адресат кода второго фактора резолвится по e-mail, а не по телефону: `UNIQUE (tenant_id, phone)` допускает один номер у сотрудников разных компаний, и прежний резолв по номеру среди всех арендаторов отправлял код входа в чужой чат. Адресат читается из той же строки `users`, что и телефон, поэтому сцепка «телефон одного, чат другого» невозможна по построению; отбор совпадает с выборками входа через общий `activeUserPredicate()`. `register` больше не переиспользует существующие привязки — учётной записи ещё нет, а прежний путь всё равно упирался в уникальный `idx_users_telegram_chat_id` уже после погашения кода
- [x] `M0.12.7` Неудачная доставка сразу после `/start` откатывает шаг привязки целиком (`code_hash`, адресат, `delivered_at`) и возвращает **тот же** deep-link токен: прежде `code_hash` оставался при погашенной ссылке, `verifyCode` списывал попытки за код, которого пользователь не получал, а повторный «Start» уже ничего не находил
- [x] `M0.12.8` Гашение подтверждённой сессии перенесено внутрь транзакции создания арендатора (`consumeVerifiedIn(tx)`): при `SLUG_TAKEN`, занятом e-mail или занятом Telegram оно откатывается вместе с ошибкой, и пользователь исправляет поле тем же кодом. Повторное использование по-прежнему исключено — `FOR UPDATE` на строке сессии сериализует две одновременные регистрации
- [x] `M0.12.9` Ошибки `TENANT_INACTIVE` и `CODE_NOT_DELIVERED` переводятся в понятный текст; ошибки потока кода отображаются на форме, включая завершение таймаута `awaiting_bot` с возможностью запросить новый код.
- [x] `M0.12.10` `awaiting_bot` больше не становится тупиком: по истечении 5 минут polling останавливается, состояние возвращается в `idle`, пользователю показывается причина и доступен повторный запрос/смена канала.
- [x] `M0.12.11` Отправка письма в `/auth/forgot-password` больше не ожидается: тело ответа было одинаковым и прежде, но время — нет (SMTP-обмен против одного `SELECT`), и разница измерима с клиента. Остаточная разница в единицы миллисекунд (транзакция записи токена) сохранена сознательно: выравнивание потребовало бы фиктивных записей для неизвестных адресов
- [x] `M0.12.15` **Счётчик попыток кода не работал вовсе** (найдено новыми тестами). `verifyCode`, `verifyOtp` и `refreshToken` писали инкремент попыток и гашение внутри транзакции, а затем бросали из её тела исключение — `ROLLBACK` отменял записи. Следствия: лимит `OTP_MAX_ATTEMPTS` не срабатывал никогда, код можно было подбирать без ограничения; повторное предъявление отозванного refresh-токена не гасило семью, то есть кража токена оставалась без последствий. Исход теперь покидает транзакцию значением, ошибка формируется после коммита; `FOR UPDATE` сохранён, поэтому параллельные проверки по-прежнему сериализуются
- [ ] `M0.12.12` Выражения `regexp_replace(phone, …)` и `lower(email)` не покрыты индексами: неаутентифицированные эндпоинты сканируют `users` целиком
- [ ] `M0.12.13` Текст «Код действует 5 минут» захардкожен в обоих бот-сервисах, тогда как `OTP_TTL_MINUTES` настраивается
- [x] `M0.12.12` Индексы `idx_users_phone_digits` и `idx_users_email_lower` (миграция `0008`): выражения совпадают с запросами байт в байт, иначе планировщик их не выберет

### M0.13 — Управление сотрудниками, тариф и настройки
- [x] `M0.13.1` Миграция `0008_team_management.sql`: nullable `password_hash`/`phone` с CHECK `users_active_needs_password`, поля приглашения, `deleted_at`, частичные уникальные индексы по живым строкам, `tenants.trial_ends_at`
- [x] `M0.13.2` `config/permissions.ts`: устранён дубль `VALID_PERMISSIONS` (был в двух файлах), добавлены `ROLE_PERMISSIONS` для пяти ролей, `ROLE_LABELS`, `ASSIGNABLE_ROLES` (без `owner`)
- [x] `M0.13.3` `TeamService`: список с занятыми местами, приглашение с серверной проверкой лимита (`409 SEAT_LIMIT_CONFIRMATION_REQUIRED`), смена роли с приведением прав, мягкое удаление с отзывом refresh-токенов, повторная отправка
- [x] `M0.13.4` `InviteService` + публичные `GET /auth/invite` и `POST /auth/invite/accept`: одноразовый токен под `FOR UPDATE`, обязательный телефон для второго фактора
- [x] `M0.13.5` `GET /tenant/info` — план, статус и остаток триала аккаунта; прежде `trial_ends_at` был доступен только платформенному владельцу
- [x] `M0.13.6` Выборки входа и `resolveUser` фильтруют `deleted_at IS NULL AND activated_at IS NOT NULL` — уволенный терял бы доступ только через 15 минут, а приглашённый ронял argon2
- [x] `M0.13.7` Страница `/settings/team` с модальным окном приглашения и подтверждением платного места вторым шагом
- [x] `M0.13.8` Страница `/settings/billing`: детализация на реальных данных, честное состояние «оплата не подключена» вместо нерабочих кнопок
- [x] `M0.13.9` Страница `/accept-invite` для активации по ссылке
- [x] `M0.13.10` `/settings` — индекс разделов; пункт «Настройки» в сайдбаре иначе отдавал бы 404
- [x] `M0.13.11` Выпадающее меню в блоке компании — прежде стрелка обещала меню, которого не было (кнопка без обработчика)
- [x] `M0.13.12` Кнопки в маркетплейсе: «Оплатить и управлять подпиской» и «Управление пользователями» на карточке `per_seat`
- [x] `M0.13.13` Вывод одноразовой ссылки приглашения в интерфейсе, когда SMTP не настроен: backend возвращает `inviteUrl` только при неудачной доставке, frontend показывает ссылку и копирование; повторная отправка копирует ссылку в буфер.
- [ ] `M0.13.14` Точечная выдача отдельных прав помимо роли
- [x] `M0.13.15` Цикл перезагрузок на `localhost` устранён. Формулировка задачи была неверной: cookie ставится корректно, `cookieDomainAttribute()` опускает `Domain` для однометочного хоста и IP — проверено в браузере. Причина в навигации: `TenantPortalGuard` сравнивал `currentTenantSlug() !== tenantSlug`, на localhost первое всегда `null`, а `tenantPortalUrl` возвращает относительный путь текущей страницы (`slug.localhost` не разрешается в DNS), поэтому `window.location.href` присваивался тем же адресом. Восстановление сессии повторялось на каждой итерации — отсюда «цикл `/auth/refresh`», хотя каждый вызов отвечал `200`. Условие вынесено в `shouldRedirectToOwnPortal()` с проверкой `tenantHostsSupported()`; прежде оно было записано в трёх местах и во всех трёх не учитывало окружения без персональных хостов
- [x] `M0.13.16` Страница `/settings/profile`: личные данные, аватар Base64 (клиентское сжатие в canvas до 256×256, WebP с откатом на JPEG), смена пароля с проверкой текущего, привязка и отвязка каналов. Миграция `0009_user_profile.sql` — `users.avatar_url`, `auth_sessions.user_id`, назначение `link` с CHECK `auth_sessions_link_needs_user`
- [x] `M0.13.17` Рефакторинг навигации: убран дублирующий пункт «Настройки» из нижнего блока сайдбара (те же разделы уже в меню компании), блок пользователя стал ссылкой на профиль, выход закрыт подтверждением — прежде клик по иконке немедленно завершал сессию
- [x] `M0.13.20` Устранён дубль `VALID_PERMISSIONS`, вынесены общие тексты ботов (`services/bot-messages.ts`); закрыт `M0.12.13` — срок действия кода берётся из `OTP_TTL_MINUTES`, а не из захардкоженных «5 минут»
- [ ] `M0.13.18` Смена собственного e-mail с подтверждением владения новым адресом
- [ ] `M0.13.19` Перенос аватаров в объектное хранилище (S3/MinIO): Base64 в TEXT возвращается в каждом ответе профиля и не кэшируется браузером отдельно

### M0.14 — UI-доработки, фиксация базовой CRM, локализация
- [x] `M0.14.1` Модальное окно кадрирования аватара: зум (ползунок, кнопки ±, колесо), перетаскивание, вывод ровно 256×256 в WebP. Реализовано на canvas без `react-easy-crop` — библиотека совместима с React 19, но ~300 КБ на один экран несоразмерны; состояние хранится в координатах исходного изображения, иначе рамка смещалась бы при изменении размера окна
- [x] `M0.14.2` Базовая CRM зафиксирована: переключатель убран, статичная плашка «Базовый тариф», запрет на трёх уровнях (UI → `409 BASE_MODULE_REQUIRED` → триггер в БД). На её контакты и сделки ссылаются остальные модули, отключение сломало бы систему
- [x] `M0.14.3` Отключение модуля действительно удаляет данные — миграция `0010_module_data_purge.sql`: мягкое удаление с окном восстановления 30 дней, журнал `module_data_purges` под RLS, `ModuleDataService` (preview/softDelete/restore), 5 фильтров `deleted_at` в `finance.service.ts`. Прежде удалялась только строка `installed_modules`, а данные оставались в БД — интерфейс обещал то, чего не происходило
- [x] `M0.14.4` Диалог подтверждения отключения с реальными числами (`GET /modules/:slug/impact`): «Скрыто будет: 3 кассы» вместо абстрактного предупреждения; кнопка недоступна, пока последствия не загружены
- [x] `M0.14.6` Полная русификация `/analytics` (KPI, заголовки графиков, легенды, тултипы, месяцы, этапы воронки, названия ремонтов, имена мастеров) и `/modules/ai-bots` (режимы, статусы, боты, промпты, шаблоны, чат, переменные). Попутно `/settings/ai` и методы выплат в `ReferralTab`
- [x] `M0.14.7` Исправлен побочный эффект триггера `core_crm` (миграция `0011`): каскад от `DELETE FROM tenants` блокировал удаление арендатора
- [x] `M0.14.8` Исправлена геометрия кадрирования аватара: `max-width: 100%` из preflight Tailwind перебивал инлайновую ширину и сжимал изображение (у снимка 900×400 — 842 px вместо 288 по расчёту), из-за чего пропорции ломались, а перетаскивание казалось неработающим. Ограничение рамки переведено на «cover» по каждой оси отдельно: прежняя формула `min(w,h)/zoom` с общим ограничением давала по короткой оси диапазон нулевой ширины, и вертикальное перетаскивание не работало вовсе. Зум сохраняет точку фокуса и поджимается в одном обновлении со сменой масштаба
- [x] `M0.14.5` Воркер окончательной очистки данных после `purge_after`: `module-data-purge-maintenance.service.ts` выбирает просроченные журналы пакетами, удаляет tenant-scoped строки, учитывает канал в `channel_accounts`, ставит `purged_at`; планировщик подключён к `server.ts`. Интеграционный прогон требует PostgreSQL runtime.
- [x] `M0.14.9` **Закрыто 2026-09-04** (`M7.13.10`): таблица перенесена в `schema.sql` вместе со списком RLS; дефект подтверждён падением `POST /marketplace/modules/:slug/toggle` с `42P01` на чистой тестовой БД, после переноса тесты зелёные. Исходная формулировка: перенести `module_data_purges` из миграции `0010` в `schema.sql`. Выявлено при сверке 2026-08-24: таблица есть только в миграции, поэтому **чистая установка её не создаёт** — `ModuleDataService` на новой БД упал бы на `relation does not exist`. Прод не затронут (там миграция применена), но развёртывание с нуля сломано. Тот же класс расхождения, что закрывался для `platform_role` при внедрении раннера миграций

### M7.5 — Каналы связи и омниканальность
> Модули каналов продавались в маркетплейсе (`telegram`, `whatsapp`, `max`, `avito`, `instagram`), но интерфейса настройки не было: подключить канал можно, работать с ним негде. Разделы появились, транспорт сообщений — нет.
- [x] `M7.5.1` Страницы интеграций `/integrations/[channel]`: один динамический маршрут на пять каналов (различаются только название, иконка и подсказка идентификатора — они лежат в реестре), шапка со статусом и счётчиком «N из M по тарифу», таблица подключений, модальное окно подключения
- [x] `M7.5.5` Единый реестр модулей `lib/modules/registry.ts`: связь «слаг маркетплейса → маршрут, иконка, право». Прежде она жила внутри `Sidebar.tsx`, и пять каналов в неё не попали
- [x] `M7.5.6` `MODULE_SLUGS` / `CHANNEL_SLUGS` как единый источник слагов на бэкенде: список существовал в `ModuleSlug` и в `marketplace.types.ts` независимо, каналы попали только в один — маркетплейс их продавал, `requireModule` о них не знал
- [x] `M7.5.7` Таблица `channel_accounts` (миграция `0012`) под RLS: одна на пять каналов, мягкое удаление, частичный уникальный индекс на `(tenant_id, channel, external_id)`
- [x] `M7.5.8` `GET/POST/PATCH/DELETE /api/v1/channels/:channel/accounts` под `tenant:admin` + `requireModuleFromParam` — новый гейт: слаг приходит параметром URL, потому что одна группа роутов обслуживает пять каналов
- [x] `M7.5.9` Лимит подключений по оплаченному `quantity` (`409 CHANNEL_LIMIT_REACHED`): проверяется на сервере — запрос можно отправить минуя интерфейс и получить пять аккаунтов по цене одного
- [x] `M7.5.10` Гейт по праву в сайдбаре: прежде менеджер видел пункт «Финансы», проходил по ссылке и получал заглушку «нет доступа»
- [ ] `M7.5.2` Омниканальный Inbox `/inbox`: единая лента сообщений из всех подключённых каналов со связью с контактом и сделкой
- [x] `M7.5.3` Авторизация аккаунта Telegram через MTProto (GramJS 2.26): `sendCode` → `auth.SignIn` → `auth.CheckPassword`, реальные пользовательские аккаунты вместо ботов. Проверено на живом Telegram: аккаунт `@genadich_agency` подключён с вводом кода и облачного пароля
- [x] `M7.5.4` Шифрование `channel_accounts.credentials` (AES-256-GCM, `services/credentials-cipher.ts`): сохранённая MTProto-сессия — полный доступ к аккаунту, дампа БД хватило бы для чтения чужих переписок. Ключ `CREDENTIALS_ENCRYPTION_KEY` обязателен при включённом MTProto
- [x] `M7.5.13` `telegram_auth_sessions` (миграция `0013`): состояние клиента GramJS между двумя запросами с TTL 10 минут. Без него `phone_code_hash` от одного auth_key проверялся бы другим соединением и верный код давал бы `PHONE_CODE_INVALID`
- [x] `M7.5.14` Пошаговый мастер `/integrations/telegram`: телефон с маской → код с таймером повторной отправки 60 с → облачный пароль через `PasswordField`. Шаг 2FA появляется только когда Telegram его запросил
- [x] `M7.5.15` Лимит 5 попыток на сессию и перевод ошибок протокола в человеческие тексты (`FLOOD_WAIT_x` → «повторите через N мин»); попытку расходуют только ошибки ввода
- [x] `M7.5.16` **Приём и отправка сообщений через подключённый аккаунт Telegram** — `telegram-transport.service.ts`: подписка GramJS `NewMessage` по всем подключённым аккаунтам, подъём сессий через 15 с после старта, сверка списка раз в минуту (аккаунт могли подключить после запуска; `LISTEN/NOTIFY` потребовал бы отдельного соединения из пула). Фильтруются группы, каналы, собственные исходящие (`incoming: true` — иначе агент отвечал бы на свои реплики и диалог зациклился бы) и медиа без подписи. Отправка с `SetTyping` перед каждым сообщением: Telegram гасит статус через ~5 с, а пауза доходит до 4.5 с. **Найдено при проверке:** RLS скрывала `channel_accounts` от фонового процесса — вне tenant-контекста `current_tenant_id()` NULL, политика не пропускала ни строки, и слушатель молчал бы всегда (подтверждено запросом под `app_user` с пустым GUC). Добавлен `runWithPlatformScope()` для чтения; записи и пайплайн идут в `runWithTenantContext`, потому что `WITH CHECK` политики не содержит `platform_scope()`
- [ ] `M7.5.12` Ротация `CREDENTIALS_ENCRYPTION_KEY`: конверт версионирован (`v1:`), но перешифрования при смене ключа нет — существующие сессии станут нечитаемыми
- [ ] `M7.5.17` Транспорт остальных четырёх каналов (WhatsApp, MAX, Avito, Instagram): подключение там по-прежнему создаёт запись без реального соединения
- [x] `M7.5.18` **Сохранение переписки**: добавлена миграция `0016_crm_pipeline_fields.sql` (`contacts.telegram_chat_id`, `deal_messages.channel_account_id`), создан `CrmPipelineService` с дедупликацией контактов (phone / telegram_chat_id) и автосозданием сделки «Заявка от {Имя} ({Канал})» в первом этапе воронки, интегрирован в `TelegramTransportService.handleBatch` — входящие и ответы агента сохраняются в `deal_messages` с `channel` и `sender` (`client`/`ai`/`manager`)
- [ ] `M7.5.11` Сверка `quantity` с фактическим числом подключений при уменьшении количества в маркетплейсе: сейчас можно оплатить 1 аккаунт, имея 3 подключённых (та же незакрытая задача, что `M0.11.12`)

### M0.11 — Тарифная модель маркетплейса и пробный период
- [x] `M0.11.1` `marketplace_modules`: `billing_kind` (`flat`/`per_seat`/`per_unit`) + `base_price`, `unit_price`, `included_units`, `unit_label`, `is_multi`, `category`, `icon`, `trial_days`, `features`, `sort_order` (миграция `0005_marketplace_pricing.sql`)
- [x] `M0.11.2` `installed_modules`: `quantity` (CHECK `>= 1`) и `trial_ends_at`
- [x] `M0.11.3` Каталог из 9 модулей с русскими названиями и ценами: CRM 600 ₽ за 10 пользователей + 200 ₽ за каждого, Сервисный центр и Финансы по 500 ₽, AI-агенты и 5 каналов по 500 ₽ за единицу
- [x] `M0.11.4` `modules/marketplace/pricing.ts` — расчёт на чистых данных, общий для карточки и сводки, чтобы цена в UI не расходилась со счётом; 11 проверок включая границы (10 → 600 ₽, 11 → 800 ₽, 0 → 600 ₽)
- [x] `M0.11.5` Пробный период 14 дней при первой установке; повторное включение после отключения новых дней не даёт (история по `tenant_audit_log`, так как строка `installed_modules` удаляется). Активность считается на сервере, а не по часам браузера
- [x] `M0.11.6` `GET /api/v1/marketplace/billing` — сумма сейчас, сумма после окончания пробных, число пользователей
- [x] `M0.11.7` `PATCH /api/v1/marketplace/modules/:slug/quantity` + `quantity` в `toggle`; лимит 100 единиц, `quantity` у `flat`-модуля отклоняется
- [x] `M0.11.8` Страница `/marketplace` на реальном API: счётчик подключений со склонением, расчёт `N × 500 ₽`, бейджи «14 дней бесплатно» / «Бесплатно ещё N дн.», полоса подписки. Иконки из каталога по имени — новый канал добавляется строкой в БД
- [ ] `M0.11.9` Списания и ограничение доступа по окончании пробного периода — платёжный провайдер не подключён (связано с `M5.2.6`, `M5.2.10`)
- [ ] `M0.11.10` Транспорт каналов: разделы `/integrations/*` и хранение подключений сделаны (`M7.5.1`), но авторизация аккаунтов и приём сообщений — нет (см. `M7.5.3`)
- [ ] `M0.11.11` Пробный период на каждый аккаунт канала: `installed_modules` — одна строка на модуль, поэтому второй аккаунт попадает в уже начатый период. Таблица подключений появилась (`channel_accounts`, `M7.5.7`), но своего `trial_ends_at` у строки нет
- [ ] `M0.11.12` Сверка `quantity` с фактическими сущностями: можно указать 5 агентов, создав одного
- [ ] `M0.11.13` Гейт на добавление пользователей сверх тарифа: сумма пересчитывается, лимит не проверяется

### M0.10 — Почта, светлая тема, локализация
- [x] `M0.10.1` `services/email.service.ts` — Nodemailer + SMTP.bz, пул соединений и таймауты; порт 465 выбран после проверки открытости портов с сервера (465/587/25/2525 все доступны)
- [x] `M0.10.2` Брендированный HTML-шаблон письма (логотип, прехедер, блок кода/кнопка, подпись команды) + текстовая версия у каждого письма
- [x] `M0.10.3` `sendVerificationEmail` / `sendWelcomeEmail` / `sendTestEmail` / `verifyConnection`
- [x] `M0.10.4` `POST /api/v1/admin/test-email` под `requirePlatformOwner`: сначала `verify()`, затем письмо; `502` с причиной при отказе SMTP
- [x] `M0.10.5` Приветственное письмо при регистрации отправляется без ожидания — недоступность SMTP не отменяет созданного арендатора
- [x] `M0.10.6` Светлая тема по умолчанию: `<html class="light">` + инлайновый скрипт, включающий тёмную только при явно сохранённом выборе (без мигания)
- [x] `M0.10.7` Палитра светлой темы в hex: фон `#f8fafc`, карточки/сайдбар `#ffffff`, границы `#e2e8f0`, текст `#0f172a` / `#475569`
- [x] `M0.10.8` Акцент переведён на оранжевый (`#F97316` / `#EA580C`) переопределением токенов на `:root` — единый в обеих темах без правки сотен вхождений
- [x] `M0.10.9` Полная русификация: сайдбар, шапка, страницы CRM, модули, админ-разделы, модальные окна, пустые состояния, уведомления и toast-сообщения. Ключи, `value` селектов и статусы (`closed_won`, `intake`) не переводились — они сравниваются с данными бэкенда
- [x] `M0.10.10` Портал владельца платформы `voxly` (`Voxly Platform`) + почта суперадмина `anton@genadich.com`; `telegram_chat_id` и `platform_role` сохранены, все три модуля установлены, `02-seed.sql` приведён к тем же значениям
- [ ] `M0.10.11` SPF/DKIM/DMARC для `getvoxly.ru`: письма доставляются, но без записей часть провайдеров может складывать их в спам
- [ ] `M0.10.12` Подключить `sendVerificationEmail` к потоку входа как резервный канал: метод реализован, но в UI выбора «код на почту» нет
- [ ] `M0.10.13` Визуальный аудит светлой темы по экранам: проверена структура и точечные наложения, попиксельный контраст всех экранов — нет
- [ ] `M0.10.14` Перевести мок-фикстуры `lib/mock/*` вместе с подключением соответствующих API

### M0.9 — Единый интерфейс владельца платформы
- [x] `M0.9.1` Блок «Управление платформой» в общем сайдбаре (не отдельная панель); видимость по `platform_role`, а не по тенантной роли `owner`
- [x] `M0.9.2` Страницы `/admin/tenants|billing|metrics|logs` внутри группы `(dashboard)` — сайдбар и header общие с рабочей CRM
- [x] `M0.9.3` `GET /api/v1/admin/billing` — распределение арендаторов по планам и расчётный MRR с явной оговоркой, что провайдер платежей не подключён
- [x] `M0.9.4` `GET /api/v1/admin/logs` — аудит по всем арендаторам с фильтром и пагинацией
- [x] `M0.9.5` `PlatformOwnerGuard` — состояние «Доступ закрыт» вместо пустой страницы; проверено: обычный владелец арендатора получает `403` на всех четырёх маршрутах
- [ ] `M0.9.6` Реальный биллинг: таблицы `plans`/`subscriptions` и платёжный провайдер (`M5.2.6`, `M5.2.7`, `M5.2.10`) — сейчас прайс задан в коде
- [ ] `M0.9.7` Логи приложения (stdout) в разделе «Системные логи»: нужен внешний сборщик, сейчас показывается только аудит действий

### M0.5 — Tenant Context & Permission Guard
- [x] `M0.5.1` Create `TenantContext` — provides `{ tenantId, tenantName, plan, installedModules }` via mock
- [x] `M0.5.2` Build `useTenant()` hook (as `useTenantContext()`)
- [~] `M0.5.3` Build `usePermissions()` hook — returns `Set<Permission>` from current user (set hardcoded in context)
- [x] `M0.5.4` Build `<Guard>` component — composable guard with `requiredRole`, `requiredPermission`, `requiredModule` checks (in `components/shared/Guard.tsx`)
- [x] `M0.5.5` Build `lib/permissions/guards.ts` — `hasPermission(user, perm)`, `isModuleInstalled(modules, slug)` (in lib/context/tenant.tsx)
- [x] `M0.5.6` Build `apiClient.ts` — thin typed wrapper around `fetch` with `get/post/put/patch/delete`, `Authorization: Bearer <token>`, error normalization to `ApiError` envelope, 401 → redirect to `/login` (in `lib/api/apiClient.ts`)

### M0.6 — Backend Auth & Tenant Middleware
- [~] `M0.6.1` Initialize Fastify server with `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit` — app.ts + server.ts, CORS, Helmet, rate-limit, JWT done; `@fastify/cookie` not installed (needed for M0.6.5)
- [x] `M0.6.2` Доставка кода подтверждения — **работает через Telegram (@GetVoxlybot) и MAX (@id505030516451_bot)**: `telegram.service.ts` + `services/max.service.ts`, привязка чата по deep-link, webhook с секретом, опрос доставки. Устаревший `POST /auth/otp/send` (код в лог на уровне `debug`) остаётся для обратной совместимости; SMS и WhatsApp не подключены
- [x] `M0.6.3` Implement `POST /auth/otp/verify` — attempt limit + expiry + single-use consumption under `FOR UPDATE`, issues real access + refresh tokens bound to `User`/`Tenant`; httpOnly cookie deferred to M0.6.5
- [x] `M0.6.4` Implement `POST /auth/refresh` — full rotation: presented token revoked, reuse of a revoked token revokes the whole family; SHA-256 digests stored, never raw tokens
- [~] `M0.6.5` Implement `POST /auth/logout` — endpoint added, idempotently revokes the refresh token; httpOnly cookie handling still pending (`@fastify/cookie` not installed)
- [x] `M0.6.6` Build `authenticate` Fastify plugin — verify JWT, attach `authUser`, `tenant_id`, `permissions`, `installed_modules`; wrapped in `fastify-plugin` so the hook lands on the route-group context, plus `typ` guard rejecting refresh tokens
- [x] `M0.6.7` Build `requirePermission(perm)` Fastify plugin — 403 if missing permission (`plugins/authorize.ts`, alongside `requireModule` and `requireRole`)
- [~] `M0.6.8` Create PostgreSQL tables: `tenants`, `users`, `installed_modules`, `otp_codes`, `refresh_tokens` — DDL in `backend/src/db/schema.sql` with GIN indexes on JSONB + tenant_id indexes; `roles`/`user_roles` still absent (tracked in M5.2.7)
- [x] `M0.6.9` Set up RLS policies on all tenant-scoped tables — политики реально ограничивают строки на живой БД: миграция `0002_rls_enforce.sql` выставила `FORCE ROW LEVEL SECURITY` на 18 таблицах и создала непривилегированную роль `app_user` (`NOSUPERUSER`, `NOBYPASSRLS`), которой подключается backend. Одного `FORCE` было недостаточно: прежняя роль `getvoxly` — `SUPERUSER` с `rolbypassrls`. GUC `app.tenant_id` выставляется автоматически на каждом checkout соединения (`db/client.ts`), поэтому все ~40 существующих `query()` защищены без правок. Проверено 8 негативными тестами ролью `app_user` + API-тестом с двумя арендаторами (чужая запись не видна ни в списке, ни в поиске, кросс-тенантная запись отклоняется БД)
- [x] `M0.6.10` Реализовано двумя эндпоинтами: `GET /api/v1/tenant/info` (план, статус, остаток пробного периода) и `GET /api/v1/tenant/modules` (установленные модули — источник истины для Sidebar и `<Guard>`)
- [x] `M0.6.11` Validate environment variables with Zod on startup — `config/env.ts`, forbids placeholder/short `JWT_SECRET` in production, `.env.example` added (closes the config half of M6.2.6)

---

## Milestone 1 — Core CRM (Frontend-First)

### M1.1 — Contacts CRUD
- [x] `M1.1.1` Create `contact.schema.ts` — Zod schemas for create/update, synchronised field-by-field with the backend schema (verified: 10 payloads, identical verdicts)
- [x] `M1.1.2` Create `app/(dashboard)/crm/contacts/page.tsx` — server component shell
- [x] `M1.1.3` Build `<ContactsTable>` — columns: name, contact info, channel, company, deals, tasks
- [x] `M1.1.4` Build `<ContactsTableToolbar>` — search input, channel filters, pagination
- [x] `M1.1.5` Build `<CreateContactForm>` — React Hook Form, Dialog wrapper, Zod validation (as ContactModal)
- [x] `M1.1.6` Build `<EditContactForm>` — pre-fill form from existing data, optimistic UI (ContactModal with `initial` prop)
- [x] `M1.1.7` Build `<ContactDetailPanel>` — slide-over sheet with full contact info, custom fields, activity timeline (as ContactCard)
- [~] `M1.1.8` Delete flow — wired to `DELETE /contacts/:id` with the backend cascade warning surfaced as a toast; still uses `window.confirm` rather than a `<ConfirmDialog>` (see M7.2.7)
- [x] `M1.1.9` Build `use-contacts.ts` — TanStack Query hooks: `useContacts`, `useContact`, `useCreateContact`, `useUpdateContact`, `useDeleteContact`, invalidating the `['contacts']` root key
- [x] `M1.1.10` Handle states: loading (`SkeletonTable`), empty (`EmptyState`, distinct copy for no-data vs no-match), error (inline panel with retry), server validation mapped onto form fields
- [x] `M1.1.11` Connect to backend: `GET/POST/PATCH/DELETE /api/v1/crm/contacts` with server-side search, channel filter and pagination

### M1.2 — Companies CRUD
- [x] `M1.2.1` Create `company.schema.ts`
- [x] `M1.2.2` Create `app/(dashboard)/crm/companies/page.tsx`
- [x] `M1.2.3` Build `<CompaniesTable>` — name, INN, phone/email, manager, deals count
- [x] `M1.2.4` Build `<CreateCompanyForm>` (as CompanyModal)
- [x] `M1.2.5` Build `<EditCompanyForm>` (CompanyModal with `initial` prop)
- [x] `M1.2.6` Build `<CompanyDetailPanel>` — info + requisites + tabbed view (contacts/deals/invoices) (as CompanyCard)
- [ ] `M1.2.7` Build `<DeleteCompanyConfirm>`
- [ ] `M1.2.8` Build `use-companies.ts` (state-based currently)
- [x] `M1.2.9` Handle states: loading, empty, error

### M1.3 — Deals Pipeline
- [x] `M1.3.1` Create `deal.schema.ts` — deal stages enum
- [x] `M1.3.2` Create `app/(dashboard)/crm/deals/page.tsx` — Kanban board with stats bar
- [x] `M1.3.3` Build `<DealsKanban>` — columns per stage, drag-and-drop cards (HTML5 drag-and-drop)
- [x] `M1.3.4` Build `<DealCard>` — title, budget, company name, contact, channel badge, manager, task indicator
- [ ] `M1.3.5` Build `<DealsTable>` — alternate list view
- [x] `M1.3.6` Build `<CreateDealForm>` — company selector, contact selector, amount, channel, manager (as CreateDealModal)
- [ ] `M1.3.7` Build `<EditDealForm>` — inline stage change + full edit dialog
- [x] `M1.3.8` Build `<DealDetailPanel>` — 3-panel layout: info+custom_fields, timeline/chat, tasks+quick-actions
- [ ] `M1.3.9` Build `use-deals.ts` — `useDealsList`, `useDeal`, `useCreateDeal`, `useUpdateDeal`, `useMoveDeal`
- [x] `M1.3.10` Drag-and-drop → stage update (local state via HTML5 drag-and-drop, no backend)
- [x] `M1.3.11` Handle states: loading, empty pipeline, error (empty state in columns, error boundaries)

### M1.4 — Tasks
- [x] `M1.4.1` Create `task.schema.ts` — task types, priority enum
- [x] `M1.4.2` Create `app/(dashboard)/crm/tasks/page.tsx` — table/kanban toggle
- [x] `M1.4.3` Build `<TasksTable>` — title, assignee, linked entity, due date, priority, status
- [x] `M1.4.4` Build `<TaskFilters>` — quick filters: Today, Overdue, My Tasks
- [x] `M1.4.5` Build `<CreateTaskForm>` — assignee picker, entity link selector, due date picker (as TaskModal)
- [ ] `M1.4.6` Build `<EditTaskForm>`
- [x] `M1.4.7` Build `<TaskQuickComplete>` — checkbox toggle with scale+color animation (in table + TaskCard)
- [ ] `M1.4.8` Build `use-tasks.ts` (state-based currently)
- [x] `M1.4.9` Handle states: loading, empty, overdue badge

### M1.5 — Chat Timeline (per entity)
- [ ] `M1.5.1` Create `timeline.schema.ts` — message source enum (types defined in deals.types.ts as TimelineMessage)
- [x] `M1.5.2` Build `<TimelinePanel>` — reusable component used in deal detail (CenterPanel)
- [x] `M1.5.3` Build `<TimelineMessage>` — avatar, sender name, timestamp, message body, source badge (in CenterPanel)
- [x] `M1.5.4` Build `<TimelineInput>` — textarea + send button, channel selector, file attach (in CenterPanel)
- [x] `M1.5.5` Integrate timeline into Deal detail pages (CenterPanel in [id]/page.tsx)
- [ ] `M1.5.6` Build `use-timeline.ts` — `useTimeline`, `useSendMessage` (state-based currently)
- [ ] `M1.5.7` Handle states: loading (message skeleton), empty ("No messages yet..." EmptyState)

### M1.6 — Core CRM Backend
- [x] `M1.6.1` Create PostgreSQL tables: `contacts`, `companies`, `deals`, `crm_tasks`, `deal_messages`, `deal_stage_history` + tenant indexes, soft deletes, updated_at triggers and RLS
- [x] `M1.6.2` Implement `GET/POST/PATCH/DELETE /contacts` with Zod, custom_fields JSONB merge/replace, soft delete, RLS + permission checks
- [x] `M1.6.3` Implement `GET/POST/PATCH/DELETE /companies` with RF requisites validation (INN/OGRN/BIK/R/S), soft delete, RLS + permission checks
- [x] `M1.6.4` Implement `GET/POST/PATCH /deals` + `PATCH /deals/:id/stage`, pipeline-safe Kanban projection and stage history, all RLS-scoped
- [x] `M1.6.5` Implement `GET/POST/PATCH/DELETE /tasks` with urgency/assignee filters, entity links, soft delete, RLS + permission checks
- [x] `M1.6.6` Implement deal timeline endpoints: `GET/POST /deals/:id/messages` with tenant scope
- [x] `M1.6.7` Add full-text search indexes on `contacts`, `companies`, `deals`
- [x] `M1.6.8` Create BullMQ queue: `notifications` for task assignment alerts — durable queue manager, tenant-scoped Telegram notification worker, fail-closed in production without Redis
- [ ] `M1.6.9` Write integration tests (Supertest) for all Core CRM endpoints

---

## Milestone 2 — Service Center Module

### M2.1 — Repair Tickets (Frontend)
- [x] `M2.1.1` Create `repair-ticket.schema.ts` (as `schemas/repair.schema.ts`)
- [x] `M2.1.2` Register module in `frontendModuleRegistry` (via `Guard` component with `requiredModule="service_center"`)
- [x] `M2.1.3` Create `app/(dashboard)/repairs/page.tsx` — dashboard with stats + table + Guard
- [x] `M2.1.4` Build `<RepairsTable>` — ticket #, date, customer, equipment (type/brand/model/S/N), defect, status, master, amount
- [x] `M2.1.5` Build `<TicketStatusBadge>` (status badges in RepairsTable — 7 statuses: intake/diagnostics/approval/in_progress/ready/issued/rejected)
- [x] `M2.1.6` Build `<RepairIntakeModal>` — customer autocomplete, equipment params, defect description, photos upload, cost estimate, master assign
- [~] `M2.1.7` Build `<EditTicketForm>` (partially via detail page WorkItemsTable + PartsTable)
- [x] `M2.1.8` Build `<TicketDetailPanel>` — stepper + 4 tabs (Details/Work&Parts/Diagnostics/Chat) + financial summary
- [ ] `M2.1.9` Build `<TicketTimeline>` — status change log, notes from technicians, customer messages
- [ ] `M2.1.10` Build `use-tickets.ts`
- [x] `M2.1.11` Wrap all service-center pages in `<Guard permission="service_center:read" module="service_center">`
- [ ] `M2.1.12` Build SMS/Email notification preview
- [ ] `M2.1.13` Build `<TicketQueue>` — kanban board view

### M2.2 — Service Center Backend
- [x] `M2.2.1` Create Postgres tables: `repair_orders`, `repair_works`, `repair_parts`, `repair_notes`, `repair_photos`, `device_models`, `repair_counters` with tenant IDs, indexes and RLS
- [x] `M2.2.2` Register `repairsRoutes` at `/api/v1/repairs`; require `service_center` installation + `service_center:read/write`
- [x] `M2.2.3` Implement tenant-scoped `GET/POST/PATCH /repairs`, atomic ЗН-YYYY-NNNN allocation, equipment intake/photos/package contents, six-step status transition and margin totals
- [x] `M2.2.4` Implement `POST /repairs/:id/notes` plus the status-change audit log
- [x] `M2.2.5` Implement `POST /repairs/:id/photos` with URL payloads; multipart binary upload remains pending
- [ ] `M2.2.6` Create BullMQ queue: `service_notifications` → triggers SMS/email on status change
- [ ] `M2.2.7` Integration tests for Service Center endpoints

---

## Milestone 3 — Finance Module

### M3.1 — Invoices & Payments (Frontend)
- [x] `M3.1.1` Create `invoice.schema.ts` + `payment.schema.ts`
- [x] `M3.1.2` Register module in `frontendModuleRegistry` (via `Guard` with `requiredModule="finance"`)
- [x] `M3.1.3` Create `app/(dashboard)/finance/page.tsx` — dashboard: balance cards + 3 tabs (Transactions/Invoices/P&L) + KPIs
- [x] `M3.1.4` Build `<InvoicesTable>` — invoice #, company, total, status, actions (integrated in finance page invoices tab)
- [x] `M3.1.5` Build `<InvoiceStatusBadge>` — draft / sent / paid / overdue / cancelled
- [x] `M3.1.6` Build `<InvoiceCreateModal>` — company selector (auto-fill contact), line items, VAT toggle, subtotal/total preview
- [x] `M3.1.7` Build `<LineItemRow>` (inline in InvoiceCreateModal)
- [ ] `M3.1.8` Build `<EditInvoiceForm>`
- [x] `M3.1.9` Build `<InvoiceViewModal>` — print preview, amount in words (Russian rubles), send-to-chat, VAT breakdown
- [x] `M3.1.10` Build `<PaymentsTable>` (integrated as TransferModal)
- [x] `M3.1.11` Build `<TransferModal>` — between-account transfer with balance display
- [x] `M3.1.12` Build `<ProfitLossView>` — income/expense structure by category with percentage bars + P&L summary
- [ ] `M3.1.13` Build `use-invoices.ts` + `use-payments.ts` (state-based currently)
- [x] `M3.1.14` Wrap all finance pages in `<Guard permission="finance:read" module="finance">`
- [ ] `M3.1.15` PDF invoice generation — server-side render + download endpoint

### M3.6 — Finance API (Backend)
- [x] `M3.6.1` Implement tenant-scoped cash accounts and transactional transfers
- [x] `M3.6.2` Implement income/expense transactions with category and CRM/repair links
- [x] `M3.6.3` Implement P&L aggregation by income/expense category and net profit
- [x] `M3.6.4` Implement invoice numbering, line items, VAT calculation and CRUD
- [x] `M3.6.5` Implement invoice creation from repair order and payment-to-cash-account flow
- [x] `M3.6.6` Protect Finance and Invoice routes with module and permission guards

### M3.2 — Finance Backend
- [x] `M3.2.1` Extend PostgreSQL finance schema: account balances, transaction links, invoice payment fields, invoice uniqueness and tenant RLS
- [x] `M3.2.2` Register `/api/v1/finance` and `/api/v1/invoices`, protected by `requireModule("finance")` and finance permissions
- [x] `M3.2.3` Implement tenant-scoped `GET/POST/PATCH /invoices`, СЧ-YYYY-NNNN generation, invoice line items and VAT totals
- [~] `M3.2.4` Implement `POST /invoices/:id/pay` to credit a selected cash account atomically; standalone payment history endpoint remains pending
- [ ] `M3.2.5` Implement `GET /invoices/:id/pdf` — generate PDF (pdfkit / puppeteer)
- [x] `M3.2.6` Implement `GET /finance/pnl` plus accounts, transfers and transaction register APIs
- [x] `M3.2.7` Create BullMQ queue: `invoice_reminders` — auto-email overdue invoices
- [ ] `M3.2.8` Integration tests for Finance endpoints

---

## Milestone 4 — AI Bots Module

### M4.1 — AI Bot Management (Frontend)
- [x] `M4.1.1` Create `ai-bot.schema.ts` + `ai-prompt.schema.ts`
- [x] `M4.1.2` Register module in `frontendModuleRegistry` (via `Guard` with `requiredModule="ai_bots"` + sidebar module gate)
- [x] `M4.1.3` Create `app/(dashboard)/modules/ai-bots/page.tsx` — bot grid: name, model, mode, status, token usage, last used + search/status filters
- [x] `M4.1.4` Build `<BotCard>` — accent avatar, name, model badge, active toggle switch, token bar, "Chat" / "Configure" actions
- [x] `M4.1.5` Build `<CreateBotForm>` — name, model catalog, mode, temperature slider, max tokens, context entities, accent (as `BotModal`)
- [x] `M4.1.6` Build `<EditBotForm>` (`BotModal` with `bot` prop — pre-fills from existing config)
- [x] `M4.1.7` Build `<PromptTemplateEditor>` — token counter vs model context window, variable palette, preview mode, unknown-variable warning
- [x] `M4.1.8` Build `<BotChat>` — chunked streaming display, typing indicator, human/bot/system bubbles with source badges, per-message tokens + latency
- [x] `M4.1.9` Build `<BotChatInput>` — auto-grow textarea, character + token count, Enter-to-send, stop generation button
- [x] `M4.1.10` Build `<BotUsageStats>` — KPI tiles, requests/tokens composed chart, latency area chart, recent `ai_logs` table
- [x] `M4.1.11` `use-ai-agents.ts` на TanStack Query вместо `use-bots.ts`: список и настройки агентов читаются из БД. Захардкоженные карточки («Помощник по продажам», «Статус ремонта») и файл `mock-ai-bots.ts` удалены — они были одинаковы у всех арендаторов и исчезали при перезагрузке. `use-bot-chat.ts` остался на имитации потока до `M4.2.4`, но экран прямо помечен демонстрационным
- [x] `M4.1.14` Пустое состояние списка агентов: «У вас пока нет AI-агентов» с кнопкой создания; панель поиска и фильтров скрывается, пока агентов нет
- [x] `M4.1.12` Wrap all AI Bots pages in `<Guard permission="ai_bots:read" module="ai_bots">` (list + detail, `ai_bots:configure` on Configure action)
- [x] `M4.1.13` Handle streaming errors: connection lost → error banner + "Regenerate" button (`/fail` prefix triggers the path)

### M4.2 — AI Bots Backend
- [x] `M4.2.1` Таблицы `ai_agents`, `ai_usage_log`, `ai_balance_topups` под RLS (миграция `0014`). Названы `ai_agents`/`ai_usage_log`, а не `ai_bots`/`ai_logs`: интерфейс называет их агентами, а журнал хранит не только вызовы, но и списанные суммы. `ai_prompt_templates` не создана — заготовки промптов остались статическим справочником (`lib/ai-bots/prompt-templates.ts`), редактирования шаблонов арендатором задача не требует
- [x] `M4.2.3` `GET/POST/PATCH/DELETE /api/v1/ai/agents` с RLS, агрегатами расхода через `LATERAL` (без N+1) и уникальностью имени без учёта регистра
- [x] `M4.2.11` Баланс ИИ в деньгах: `GET /api/v1/ai/balance`, `POST /balance/topup` (500/1000/5000 ₽), тарификация в `ai-pricing.ts`. Копейки целым числом — рубли с плавающей точкой давали бы расхождение остатка с суммой операций
- [x] `M4.2.12` Наценка платформы на токены (`tenants.ai_markup_percent`, по умолчанию 30 %) с управлением в `/admin/tenants`; хранится себестоимость и списанная сумма, чтобы маржа считалась по факту вызова, а не по текущей наценке
- [x] `M4.2.13` **Образ БД с pgvector 0.8.0** — `docker/postgres-pgvector.Dockerfile` собирает расширение из исходников на `postgres:16-alpine`. Готового alpine-образа не существует (pgvector публикует только Debian-теги: из 32 тегов ни одного с `alpine`), а переход на Debian сменил бы libc с musl на glibc, то есть библиотеку сортировки: 66 текстовых индексов существующего тома, включая UNIQUE по `lower(email)` и `slug`, разошлись бы с данными до полного `REINDEX DATABASE`. Сборка с `with_llvm=no`: образ PostgreSQL собран с `--with-llvm` под LLVM 21, пакета `llvm19` в Alpine 3.24 нет вовсе, а полный `llvm21` (≈1 ГБ) падает при распаковке; bitcode ускоряет интерпретацию выражений, а не обход HNSW-индекса. Проверено в контейнере: расширение, HNSW по `vector(1536)`, `<=>`, схема (38 таблиц) и миграция на существующей БД
- [x] `M4.2.14` **База знаний агентов (RAG)** — миграция `0015`: `knowledge_base_documents`, `knowledge_base_chunks` (`vector(1536)` + HNSW `vector_cosine_ops`), `ai_agent_channel_bindings`, все под RLS с `FORCE`. Отступления от задания: у таблицы привязок добавлен `tenant_id` (без него RLS-политика невыразима — оба внешних ключа ведут на таблицы под RLS), политики сверяются через `current_tenant_id()` вместо прямого каста `current_setting` (тот падал бы с `22P02` вне tenant-контекста), HNSW вместо IVFFlat (последний требует обучения на данных и на пустой таблице негоден)
- [x] `M4.2.15` **Чанкование и семантический поиск** — 1000–1500 символов с overlap 200, разрез по границе абзаца → предложения → пробела; поиск `<=>` с `LIMIT 4`. Порог отсечения 0.75 подобран по измерениям на реальном регламенте (по теме 0.35–0.65, не по теме 0.84–0.90): первоначальные 0.6 отсекали валидный вопрос. Без порога модель получала бы случайный текст как «найденное в документах»
- [x] `M4.2.16` **Эндпоинты базы знаний** — `GET/POST/DELETE /api/v1/ai/agents/:id/knowledge` (текстом или файлом txt/md/docx/pdf, предел 10 МБ) и `GET/PUT /api/v1/ai/agents/:id/channels`. Тип файла определяется по расширению, а не по MIME из запроса: браузеры присылают `application/octet-stream` для docx
- [x] `M4.2.17` **Вкладки «База знаний» и «Подключенные каналы»** на странице агента, а не в модальном окне настроек: и документ, и привязка требуют существующего `agentId`, поэтому в окне создания разделы показывали бы неработающие органы управления. Проверено в браузере
- [x] `M4.2.5` **Слой абстракции LLM** — `services/embeddings.service.ts` с интерфейсом `EmbeddingProvider`; вызовы идут через него, а не прямым `fetch` (`.cursorrules` §1). Реализован OpenAI-совместимый шлюз: один адрес и один ключ на все модели вместо ключа на провайдера, иначе каждая новая модель в каталоге означала бы правку окружения. `streamChat` пока нет — он нужен вместе с `M4.2.4`
- [x] `M4.2.10` **Тесты AI-модуля с фиктивным провайдером** — 34 теста: чанкование (12, без БД и сети), база знаний (22: размерность вектора, RLS всех трёх таблиц, каскады, ранжирование, права, гейт модуля). Провайдер подменён заглушкой: живой вызов означал бы зависимость от внешней сети и платный трафик в каждом прогоне
- [ ] `M4.2.2` Register module routes in backend `moduleRegistry`
- [ ] `M4.2.4` `POST /ai/agents/:id/chat` как SSE + `streamChat` в абстракции провайдера, затем перевод `use-bot-chat.ts` на `EventSource`
- [ ] `M4.2.6` Implement `GET /ai-bots/:id/logs` — usage history, token count, cost
- [ ] `M4.2.7` Inject context variables: `{{tenant}}`, `{{contact}}`, `{{deal}}` resolved at runtime from DB
- [ ] `M4.2.8` Log every LLM call to `ai_logs`: tenant_id, user_id, bot_id, model, tokens_in, tokens_out, latency_ms, cost
- [ ] `M4.2.9` Create BullMQ queue: `ai_bots` — async completion jobs for non-streaming tasks
- [x] `M4.2.18` **Дебаунс входящих сообщений** — `incoming-buffer.ts`, окно 15–20 с (случайное: фиксированная пауза читается как автоответчик), накопление по паре «аккаунт + chat_id», склейка через `\n`. Сверх задания добавлены жёсткий дедлайн 60 с от первого сообщения (иначе непрерывно печатающий клиент не получил бы ответа никогда) и предел буфера 30 сообщений / 8000 символов (иначе промпт растёт без границы, а платить за него нечем оправдать; отброшенное попадает в лог). Буфер в памяти процесса, не в Redis: живёт секунды и осмыслен только вместе с MTProto-соединением в том же процессе
- [x] `M4.2.19` **Мульти-сообщенная отправка и списание** — `agent-reply.ts` требует от модели строгий JSON `message1..3` (разбор свободного текста по пустым строкам ломался бы на любом списке), извлекает JSON из markdown-блока и из ответа с предисловием, читает строго эти ключи (`reasoning` не должен уйти клиенту) и молчит при непригодном ответе вместо отправки сырого текста. Пауза 2.5–4.5 с со статусом «печатает» перед каждым сообщением. Списание с `ai_balance_kopecks` в одной транзакции с записью в `ai_usage_log`: иначе возможны расход без объяснения или бесплатное пользование. Баланс проверяется до вызова (порог 100 коп), `GREATEST(...,0)` не даёт остатку стать отрицательным
- [x] `M4.2.8` **Журналирование вызовов LLM** — каждый вызов пишет `ai_usage_log` (tenant, agent, model, tokens_in/out, latency, себестоимость, списанная сумма, статус, причина отказа). `user_id` NULL: вызов инициирован клиентом из мессенджера, а не сотрудником. Расход пишется и при непригодном ответе (токены провайдер уже потратил), при отказе вызова — журнал без списания
- [ ] `M4.2.20` **Блокировка на одного слушателя** при масштабировании бэкенда: сейчас транспорт поднимается в каждом процессе, и при нескольких репликах клиент получил бы по ответу от каждой. Пока бэкенд запускается одним контейнером; понадобится advisory lock в PostgreSQL
- [ ] `M4.2.21` **Распознавание голосовых и изображений**: медиа без текстовой подписи сейчас игнорируется — ответ «не понял» на голосовое хуже молчания оператора

---

## Milestone 5 — SaaS Admin

### M5.1 — Admin Panel (Frontend)
- [x] `M5.1.1` Create `app/(admin)/tenants/page.tsx` — platform-level admin with tenant list + referral program
- [ ] `M5.1.2` Build `<TenantSettings>` — company name, logo, timezone, default language (смена `slug`/поддомена тоже сюда: сейчас он задаётся только при регистрации)
- [x] `M5.1.3` Build `<UserManagement>` — user list, invite user form, role assignment (owner info in TenantManageModal)
- [ ] `M5.1.4` Build `<RoleEditor>` — CRUD roles, assign permissions (checkboxes grouped by module)
- [x] `M5.1.5` Build `<ModuleMarketplace>` — module toggles in TenantManageModal
- [ ] `M5.1.6` Build `<PlanLimits>` — current plan display, usage meters (contacts, storage, AI tokens), upgrade CTA
- [ ] `M5.1.7` Build `<AuditLog>` — filtered table: timestamp, user, action, entity, IP address
- [ ] `M5.1.8` Build `<BillingOverview>` — current plan, next invoice date, payment method, invoice history
- [ ] `M5.1.9` Wrap all admin pages in `<Guard permission="tenant:admin">`
- [x] `M5.1.10` Create `app/superadmin/page.tsx` — платформенная панель владельца SaaS: список тенантов (план, статус, продление подписки, AI-баланс, suspend/enable), метрики платформы; защита `PlatformOwnerGuard` + `middleware.ts`

### M5.6 — SaaS Admin & Marketplace API (Backend)
- [x] `M5.6.1` Create marketplace catalog, installed-module toggles and tenant audit records
- [x] `M5.6.2` Implement `GET /api/v1/marketplace/modules` for the current tenant
- [x] `M5.6.3` Implement `POST /api/v1/marketplace/modules/:slug/toggle` with tenant admin guard
- [x] `M5.6.4` `GET/PATCH /api/v1/admin/tenants` for subscription, AI balance, status and plan — гейт `requirePlatformOwner` (`users.platform_role`), не тенантная роль owner; в выборке счётчики `users_count`/`modules_count`
- [x] `M5.6.5` Implement `GET /api/v1/admin/metrics` — счётчики сущностей по всем тенантам, размер/uptime/connections БД, заглушка очереди (до BullMQ); гейт `requirePlatformOwner`

### M5.2 — Admin Backend
- [ ] `M5.2.1` Implement `PATCH /tenant` — update tenant settings
- [x] `M5.2.2` User management (tenant admin only) — реализовано как `GET/POST/PATCH/DELETE /api/v1/tenant/team` + публичные эндпоинты приглашения, см. `M0.13`
- [ ] `M5.2.3` Implement `GET/POST/PATCH/DELETE /roles` — RBAC role management
- [ ] `M5.2.4` Implement `POST /modules/:slug/install` + `POST /modules/:slug/uninstall` — toggle modules
- [ ] `M5.2.5` Implement `GET /audit-logs` — query audit log table
- [ ] `M5.2.6` Implement `GET /billing/plan` + `POST /billing/checkout` — Stripe integration
- [ ] `M5.2.7` Create Postgres tables: `roles`, `user_roles`, `audit_logs`, `plans`, `subscriptions`
- [ ] `M5.2.8` Build audit logging middleware — log all CUD operations automatically
- [ ] `M5.2.9` Integration tests for admin endpoints
- [ ] `M5.2.10` Stripe webhook handler: `POST /billing/webhook` — sync subscription status

---

## Milestone 6 — Polish & Production Readiness

### M6.1 — Cross-Cutting Frontend
- [ ] `M6.1.1` Global error boundary wrapping all route groups
- [x] `M6.1.2` Global toast notification system (sonner / shadcn toast) — `<Toaster>` in root layout + wired to notifications
- [x] `M6.1.3` Keyboard shortcuts: `Cmd+K` global search (CommandMenu palette), `Cmd+N` quick create, `Esc` close modal
- [ ] `M6.1.4` Responsive audit: every page works at mobile (375px), tablet (768px), desktop (1280px+)
- [ ] `M6.1.5` Accessibility pass: focus rings, aria-labels, screen reader labels for all interactive elements
- [ ] `M6.1.6` `loading.tsx` skeletons for every page
- [ ] `M6.1.7` `error.tsx` error boundaries for every route group
- [ ] `M6.1.8` `not-found.tsx` custom 404 page
- [ ] `M6.1.9` Metadata / SEO: `generateMetadata()` for every page

**Cross-module polish (done):** `<CommandMenu>` (Cmd+K palette — navigation, quick actions, entity search), `<NotificationDropdown>` (bell with unread badge, mark-all-read, click-through navigation), deal detail card integration (related repair block + linked invoices with InvoiceViewModal preview, auto-open repair intake via `/repairs?create=1`).

### M6.2 — Cross-Cutting Backend
- [~] `M6.2.1` Rate limiting: per-IP and per-tenant thresholds — per-IP done (100/min in `app.ts`), per-tenant pending
- [ ] `M6.2.2` Request logging middleware (structured JSON logs)
- [~] `M6.2.3` Health check endpoint: `GET /health` — DB connectivity checked (200/503); Redis check pending until Redis is introduced
- [x] `M6.2.4` Graceful shutdown handling (SIGTERM/SIGINT → drain requests, close DB pool) — `server.ts`; BullMQ workers not yet applicable
- [x] `M6.2.5` CORS configuration for production domains — `corsOriginMatcher()` поддерживает шаблон `https://*.getvoxly.ru`, раскрывающийся ровно в одну метку, потому что поддомены арендаторов нельзя перечислить заранее. Проверено 15 кейсами: `demo/firma/app/apex` разрешены, `evil.com`, `getvoxly.ru.evil.com` и `a.b.getvoxly.ru` отклоняются
- [x] `M6.2.6` Environment validation on startup (Zod schema for env vars) — `config/env.ts` + `.env.example`, production-only secret hardening
- [x] `M6.2.7` **Инструмент миграций** — `node-pg-migrate` 9.x с таблицей истории `pgmigrations`. Существующие `0001`–`0009` остались на месте и помечены применёнными через `--fake`; прод забейзлайнен без повторного прогона. Прогон выполняет entrypoint контейнера **до** старта Node, отдельным подключением под роль-владельцем: приложение работает под `app_user`, у которого нет прав на DDL (`permission denied for schema public`), и выдача ему прав обесценила бы RLS. Скрипты: `migrate:up`, `migrate:down`, `migrate:create`, `migrate:status`, `migrate:baseline`, `migrate:dry`. Порядок работы — `docs/01_ARCHITECTURE/01_04_DATABASE_MIGRATIONS.md`
- [x] `M6.2.10` Устранены три дефекта чистой установки, вскрытые сверкой `schema.sql` с миграциями: отсутствие `users.platform_role` (ломало аутентификацию), `ON CONFLICT (tenant_id, phone)` в сиде после замены ограничения частичным индексом в `0008` (владелец не создавался), отсутствие `activated_at` в сиде (владелец не мог войти). До этого любая новая установка была нерабочей
- [ ] `M6.2.11` Секции откатa (`-- Down Migration`) для новых миграций: у `0001`–`0009` их нет, поэтому откат существующих возможен только восстановлением из дампа
- [x] `M6.2.8` Unify the error envelope and map `ZodError` to `400 VALIDATION_ERROR` with field-level `details` (`plugins/errorHandler.ts`)

### M6.3 — Testing
- [ ] `M6.3.1` Vitest unit tests: all Zod schemas, permission logic, format utilities
- [ ] `M6.3.2` Vitest unit tests: React components (render, interaction, conditional rendering via Guard)
- [~] `M6.3.3` Интеграционные тесты API с многоарендной фикстурой: Vitest 2.1.9, **77 тестов в 4 файлах** — `auth.test.ts` (38), `invite.test.ts` (16), `tenant-isolation.test.ts` (12), `auth-maintenance.test.ts` (11). Через `app.inject()`, а не Supertest: инъекция проходит полный конвейер Fastify, поэтому реальный сокет ничего не добавляет, а отсутствие порта снимает вопрос его занятости. Тестовая БД создаётся с нуля из `schema.sql` и подключается непривилегированной ролью `getvoxly_test_app_user` — под суперпользователем проверки RLS проходили бы независимо от того, работает ли изоляция (`rolbypassrls` обходит даже `FORCE`). Роль отдельная от рабочей `app_user`: `ALTER ROLE` действует на весь кластер, и общее имя означало бы смену пароля у роли рабочей базы. Первые же тесты нашли `M0.12.15`. Частично: покрыт auth-контур, приглашения, RLS и гейты; CRM/Ремонты/Финансы/AI ещё нет
- [ ] `M6.3.4` Playwright E2E: auth flow (login → verify → redirect), create contact → create deal → view timeline
- [ ] `M6.3.5` Playwright E2E: module install/uninstall flow, Guard visibility states
- [ ] `M6.3.6` Playwright E2E: full repair ticket flow
- [ ] `M6.3.7` Playwright E2E: invoice creation + payment recording
- [ ] `M6.3.8` Run all tests in CI pipeline (GitHub Actions)

### M6.4 — DevOps & Deployment
- [x] `M6.4.1` Dockerfile for frontend (Next.js standalone output) — `frontend/Dockerfile`, node:22-alpine two-stage, `NEXT_PUBLIC_API_URL` пробрасывается build-аргументом (иначе не попал бы в клиентский бандл), порт 3000, `HOSTNAME=0.0.0.0`
- [~] `M6.4.2` Dockerfile for backend (Fastify + BullMQ worker) — `backend/Dockerfile`, node:22-alpine two-stage, `npm ci --omit=dev` в рантайме, порт 4000; отдельного BullMQ-воркера нет, так как Redis/BullMQ в проекте ещё не введены
- [~] `M6.4.3` docker-compose.yml for local dev (PostgreSQL, Redis, app) — `/opt/getvoxly/docker-compose.yml` (production): `db` (postgres:16-alpine, volume `getvoxly_pg_data`, авто-накат `schema.sql` + `02-seed.sql` через `docker-entrypoint-initdb.d`), `backend`, `frontend`, healthcheck на каждом сервисе, внешняя сеть `automation_automation_net`; Redis отсутствует, отдельного dev-компоуза нет
- [ ] `M6.4.4` GitHub Actions CI: lint, typecheck, unit tests, integration tests on PR
- [-] `M6.4.5` Vercel deployment for frontend — не нужен: frontend развёрнут на собственном VPS в контейнере за Nginx Proxy Manager (`getvoxly.ru`, `app.getvoxly.ru`, SSL Let's Encrypt)
- [-] `M6.4.6` Railway / Fly.io deployment for backend + Redis — не нужен: backend развёрнут на VPS (`api.getvoxly.ru` → `backend:4000`); Redis появится вместе с BullMQ
- [x] `M6.4.7` Set up production PostgreSQL (Supabase / Neon) — self-hosted `postgres:16-alpine` в compose; 29 таблиц применены на живой БД, seed-владелец `+79150946944` (`owner` + `platform_owner`, 19 permissions) и 3 модуля установлены
- [ ] `M6.4.8` Configure monitoring: Sentry for errors, Axiom/betterstack for logs
- [ ] `M6.4.9` Set up UptimeRobot / Checkly for health check monitoring
- [ ] `M6.4.10` Security audit: dependency scan, env secrets check, SQL injection check

---

## Milestone 7 — Frontend ↔ Backend Wiring

> Раскрыто аудитом 2026-08-18: backend ядра CRM, Repairs, Finance, Marketplace и
> Admin реализован, но frontend не выполняет ни одного HTTP-запроса —
> `apiClient` не импортирован нигде, все 15 страниц работают на `mock-*.ts` и
> локальном состоянии React. Роадмап ранее не отслеживал этот разрыв.

### M7.1 — Транспорт и инфраструктура запросов
- [x] `M7.1.1` Установить `@tanstack/react-query` v5 и обернуть приложение в `QueryClientProvider` — v5.101.4, `lib/api/QueryProvider.tsx`, клиент создаётся в `useState` (не на уровне модуля, чтобы SSR не делил кэш между пользователями)
- [x] `M7.1.2` Задать базовый URL API в `apiClient` — `NEXT_PUBLIC_API_URL` с фолбэком `http://localhost:4000`
- [~] `M7.1.3` Установить shadcn/ui и базовые примитивы — каталог `components/ui/` по-прежнему пуст; `Skeleton` и `SkeletonTable` реализованы самостоятельно в `components/shared/Skeleton.tsx` с тем же API, `<FormMessage>` заменён инлайновой разметкой ошибок
- [x] `M7.1.4` Прокинуть `refresh_token` в `apiClient`: при `401` один `POST /auth/refresh` и повтор исходного запроса, при неудаче — очистка сессии и `/login` с сохранением цели; параллельные `401` разделяют один refresh
- [~] `M7.1.5` Перейти на единый транспорт токена — рассогласование устранено (`lib/auth/session.ts` пишет и `localStorage`, и cookie, которую читает middleware); httpOnly остаётся за M0.6.5

### M7.2 — Аутентификация на frontend
- [x] `M7.2.1` Подключить `PhoneOtpAuth` к `useAuth` и реальным `/auth/*` — хардкод `"123456"`, фиктивные задержки и редирект на `/contacts` удалены; ошибки backend показываются на полях
- [x] `M7.2.2` Починить `middleware.ts` — **исправлено дважды.** В спринте 12 переписан матчер, но это не дало эффекта: файл лежал в `frontend/middleware.ts`, а при каталоге `src/` Next.js требует `src/middleware.ts`, поэтому middleware вообще не компилировался (`middleware-manifest.json` был пуст) и защита маршрутов работала только на клиенте. После переноса в `src/` проверено `curl`: без cookie `307 → /login`, с cookie `200`, `/login` при активной сессии `307` в приложение
- [x] `M7.2.3` Убрать хардкод 19 permissions из `use-auth.tsx` — права приходят из ответа `/auth/*`, добавлены `usePermissions` / `useHasPermission` / `useIsModuleInstalled`. Копия в `lib/context/tenant.tsx` остаётся: её `useTenantContext` используют `Sidebar` и Header (см. M7.2.6)
- [x] `M7.2.4` Вызывать `logout()` из `Sidebar` и подключить `POST /auth/logout` — отзыв выполняется до навигации
- [x] `M7.2.5` Обработать ошибки OTP в UI — `429 OTP_ATTEMPTS_EXCEEDED`, истёкший и неверный код приходят с сервера и показываются на поле кода (закрывает M0.4.8)
- [x] `M7.2.6` Перевести `lib/context/tenant.tsx` на данные из `useAuth` и удалить второй мок-набор прав — мок-константы удалены, `TenantProvider`/`useTenantContext` упразднены, `Sidebar` и `Header` читают tenant/user из `useAuth()` с null-safe фоллбеками; `hasPermission`/`isModuleInstalled` оставлены как чистые утилиты
- [x] `M7.2.7` Заменить `window.confirm` на `<ConfirmDialog>` при удалении контакта — создан `components/shared/ConfirmDialog.tsx`, `window.confirm` в `contacts/page.tsx` заменён на управляемое состояние + `<ConfirmDialog variant="destructive">` (закрывает M0.2.6)

### M7.3 — Вертикальные срезы по доменам
- [x] `M7.3.1` Contacts: `use-contacts.ts` на `/api/v1/crm/contacts`, страница переведена с `MOCK_CONTACTS` на серверные поиск, фильтр и пагинацию; Skeleton/Empty/Error, slide-over `ContactCard`, `<Guard>` на чтение и запись (закрывает M1.1.9, M1.1.11, M1.1.8)
- [x] `M7.3.2` Companies: `use-companies.ts`, real list/stats/create/update API, server-side search/pagination, `CompanyModal` с реквизитами и `CompanyCard` slide-over (закрывает M1.2.8)
- [x] `M7.3.3` Deals: `use-deals.ts`, `GET /deals/pipelines` + `GET /deals/kanban`, optimistic `PATCH /deals/:id/stage`, real deal detail timeline GET/POST messages (создание сделки через old mock selector вынесено в следующий срез)
- [x] `M7.3.4` Tasks: `use-tasks.ts`, real list + server-side Today/Overdue/My filters, Table/Kanban, optimistic `PATCH /tasks/:id/status`, create for current authenticated user
- [~] `M7.3.5` Timeline: `useDealTimeline`/`useSendDealMessage` подключены к API; relation timeline for contacts/tasks and attachment upload remain pending
- [x] `M7.3.6` Repairs: `use-repairs.ts`, номера `ЗН-YYYY-NNNN` с сервера вместо клиентских `REP-NNNNN` (закрывает M2.1.10)
- [x] `M7.3.7` Finance: `use-invoices.ts`, real API, bring schemas in line with backend (`vat_rate` 0…100, `category_name`, `occurred_at`)
- [x] `M7.3.8` Marketplace и Admin: `GET/POST /api/v1/marketplace/modules`, `GET/PATCH /api/v1/admin/tenants`; заменить `TenantStatus.expired` на `past_due`

### M7.3.9 — Next CRM dependencies
- [x] `M7.3.9` `ensureTenantDefaults(tenantId)` в `backend/src/modules/tenant/tenant-defaults.ts`: идемпотентно создаёт дефолтную воронку "Основная" с 6 стадиями, кассовый счёт "Основная касса (Наличные)" и 8 статей доходов/расходов; вызывается в `GET /deals/pipelines` при пустом tenant и экспортируется через `POST /tenant/defaults`
- [x] `M7.3.10` `GET /api/v1/tenant/users` (`TenantService.listUsers`) + хук `useTenantUsers()` в `frontend/src/lib/api/use-tenant-users.ts` с `indexTenantUsers()`; уже используется в страницах Сделок и Задач для резолвинга ответственных

### M7.4 — Пробелы UI, выявленные аудитом
- [ ] `M7.4.1` Оплата счёта: UI для `POST /invoices/:id/pay` с выбором кассы — endpoint готов, интерфейса нет
- [ ] `M7.4.2` Ввод диагностики и гейт перехода `diagnostics → approval` (закрывает M2.1.9 частично)
- [ ] `M7.4.3` Переход наряда в `rejected` — статус есть в обоих enum, пути в UI нет
- [ ] `M7.4.4` Диалоги удаления в CRM (закрывает M1.1.8, M1.2.7)
- [ ] `M7.4.5` Добавить `<Guard>` на 5 страниц CRM и на `/marketplace` (`tenant:admin`), исправить `(admin)/tenants` на `requiredPermission="tenant:admin"` (закрывает M5.1.9)
- [ ] `M7.4.6` Починить битые ссылки: `/admin/tenants`, `/contacts`, `/modules/service-center/new`, `/modules/finance/new-invoice`
- [ ] `M7.4.7` Удалить мёртвый код: `CreateRepairModal.tsx`, `use-print-receipt.ts`, ветку `status === "received"`, неиспользуемые `detailTarget`/`handleEdit`
- [ ] `M7.4.8` Привести primary-кнопки к `amber-500` вместо `bg-sky-600` (4 места, `.cursorrules` §6)
- [ ] `M7.4.9` Сделки: real create modal с selectors из contacts/companies/pipeline stages; текущий `CreateDealModal` намеренно остаётся mock-only и не подключён
- [ ] `M7.4.10` Сделки: подключить real linked tasks/relations endpoints к detail right panel
- [x] `M7.4.11` Tasks: заменить current-user-only create на users catalog/assignee selector после M7.3.10 — сделано в `M7.6.20`

### M7.5 — Паритет карточек записей с Twenty CRM
Источник — исходники Twenty (`~/Desktop/twenty-src`), метаданные представлений `*RecordPageFields` и реализация record page.
- [x] `M7.5.1` Миграция `0019`: `linkedin_link` и `created_by` контактам, `annual_revenue` / `linkedin_link` / `address_*` / `created_by` компаниям (их `linkedinLink`, `annualRevenue`, `AddressMetadata`, `createdBy`)
- [x] `M7.5.2` Таблица `notes` с полиморфной связью через три nullable-FK и `CHECK` на ровно одну цель (их `Note` + `NoteTarget`), RLS `tenant_isolation` с `FORCE`
- [x] `M7.5.3` Модуль `/api/v1/crm/notes`: список по цели, создание с проверкой цели в тенанте, правка, soft-delete. Права наследуются от типа целевой записи — своего `notes:*` нет
- [x] `M7.5.4` Общий слой карточки: `RecordField` / `RecordFieldGroup` / `RecordRelationSection` / `RecordDetailShell` — лейбл 90px, панель 500px, вкладки 40px по их константам; свёрнутая группа «Ещё» для полей с `isVisible: false`
- [x] `M7.5.5` Карточка контакта: группы `Общее` / `Работа` / `Социальные сети` / `Система` по `personRecordPageFields`
- [x] `M7.5.6` Карточка компании: группы `Общее` / `Бизнес` / `Контакты` / `Система` по `companyRecordPageFields`
- [x] `M7.5.7` Карточка сделки: группы `Сделка` / `Связи` / `Система` по `opportunityRecordPageFields`, владелец отдельно от создателя
- [x] `M7.5.8` Вкладка «Заметки» на карточках контакта, компании и сделки
- [x] `M7.5.9` Исправлена потеря `job_title` и `domain_name` в формах правки — `PATCH` затирал их при каждом сохранении
- [x] `M7.5.10` `POST`/`PATCH` перечитывают запись: `RETURNING` не отдавал `createdByName` и агрегаты, автор показывался как «Система»
- [x] `M7.5.11` Задеплоено на прод 31.08.2026. Блокировка была не в отказе SSH как таком: канал до сервера теряет часть **новых** TCP-соединений (замер — 1 успех из 5 против 8 из 8 внутри установленного), а `rsync` и `docker-compose` открывают их пачками. Решение — `ControlMaster` в `~/.ssh/config`: одно соединение на весь деплой. Попутно `maxretry` fail2ban поднят с 4 до 10 — прежний порог банил рабочую машину за собственную выкладку, потому что отброшенные по `MaxStartups` соединения фильтр считает неудачными попытками. Регламент: `docs/05_OPERATIONS/05_02_DEPLOY.md`, скрипт `scripts/deploy.sh`
- [x] `M7.5.12` Ресайз колонок через CSS-переменные `--rt-col-<id>`: перетаскивание пишет ширину прямо в DOM (`style.setProperty`), в состояние она попадает один раз на отпускании. Проверено в браузере: во время движения inline-стиль `220px`, после отпускания `240px` в localStorage
- [x] `M7.5.14` Клавиатура: три уровня как у Twenty — фокус строки → фокус ячейки → редактор. Стрелки вверх/вниз по строкам без входа, `Enter` входит в строку и затем открывает редактор, стрелки влево/вправо переносят фокус через границу строки, `Escape` поднимается ячейка → строка → ничего. Проверено в браузере пошагово
- [x] `M7.5.15` Перетаскивание заголовков для смены порядка на нативном HTML5 DnD (новая зависимость не нужна). Первая колонка закреплена — `draggable="false"`, как их `isLabelIdentifier`
- [x] `M7.5.16` Меню «Колонки»: скрытие/показ, `defaultHidden`, сброс раскладки. Ширины, порядок и видимость хранятся в localStorage по ключу `tableId`
- [x] `M7.5.17` Клик по первой колонке открывает запись; редактор открывается только когда значение пустое — иначе свежесозданную строку нельзя было бы назвать
- [ ] `M7.5.13` Три общих портала (hover / focus / edit) вместо обвязки в каждой ячейке — их решение для таблиц на 100+ строк. Пока не нужно: у нас страница по 25 записей, выигрыш неощутим
- [x] `M7.5.18` **Закрыто** в `M7.12.19–20`: раскладка живёт в `record_table_layouts` (персонально на `(tenant_id, user_id, table_id)`), localStorage остался кэшем на первый рендер. У Twenty это `ViewField`, общий для рабочего пространства; у нас персонально — таблицы описаны кодом, и общая раскладка означала бы, что один менеджер меняет колонки всем

### M7.6 — Контакт, компания, сделки и задачи: паритет модели с Twenty
Источник — `~/Desktop/twenty-src`: `person.workspace-entity.ts`, composite-тип
`phones.composite-type.ts`, `MultiItemFieldInput` / `PhonesFieldInput`,
relation-виджеты record page.
- [x] `M7.6.1` Миграция `0020`: `middle_name`; снят `NOT NULL` с `last_name`, `phone`, `company_name`. Обязательно только имя — у Twenty на Person nullable всё остальное
- [x] `M7.6.2` Телефоны по их модели PHONES: основной номер в колонках `phone` / `phone_country_code` / `phone_calling_code`, остальные в `additional_phones JSONB`. Раздельно, потому что по основному ищет транспорт каналов — по индексируемой колонке, а не по JSONB
- [x] `M7.6.3` Соцсети списком `socials JSONB` (`{kind, value}`) вместо двух колонок. Колонки `telegram_username` / `whatsapp` сохранены и синхронизируются сервисом: по ним ищет `crm-pipeline` и интеграции каналов
- [x] `M7.6.4` `CHECK` на структуру обоих JSONB через `jsonb_path_exists`. Подзапрос в `CHECK` PostgreSQL не принимает («cannot use subquery in check constraint») — проверено на postgres:16, первый вариант миграции не создавался
- [x] `M7.6.5` Компании из названий у контактов: миграция создаёт запись в `companies` для каждого непустого `company_name` без связи и проставляет `company_id`. Это причина пустого `/crm/companies` при заполненных компаниях в контактах — название лежало строкой и записи не создавало
- [x] `M7.6.6` Дедупликация при backfill по `lower(btrim(name))` через `DISTINCT ON`: «ООО ТехКорп» и «ооо техкорп» — одна организация. Первый вариант с `DISTINCT` по паре создавал две компании, воспроизведено на postgres:16
- [x] `M7.6.7` `company_id` получил настоящий `FOREIGN KEY ... ON DELETE SET NULL`; висячие ссылки на удалённые компании обнулены. До этого колонка была UUID без `REFERENCES`
- [x] `M7.6.8` Заглушки `«Не указана»` из автосоздания контактов каналом очищены, и `crm-pipeline` больше их не пишет: это отсутствие данных, а не название
- [x] `M7.6.9` `ContactsService.resolveCompany`: и `company_id`, и введённое название приводят к одной записи в `companies`, создавая её при необходимости. Название у контакта всегда равно названию связанной компании — источник правды один
- [x] `M7.6.10` Поиск контакта по любому номеру, а не только по основному: `phone = $2 OR additional_phones @> ...` с GIN-индексом. Клиент звонит со второго номера так же часто, как с первого
- [x] `M7.6.11` `libphonenumber-js` на фронте (та же библиотека, что у Twenty): селектор кода страны из данных библиотеки, форматирование по ходу ввода, хранение в E.164, проверка номера для своей страны
- [x] `M7.6.12` `PhonesInput` и `SocialsInput` по образцу их `MultiItemFieldInput`: добавление, удаление, «сделать основным» = перестановка в начало (у них primary — позиция 0)
- [x] `M7.6.13` Форма контакта: `Фамилия` / `Имя *` / `Отчество`, телефоны и соцсети списками, компания выбором из существующих или вводом названия. Кнопка отправки блокируется только на время запроса — `isValid` при необязательных полях гасил её до первого касания формы
- [x] `M7.6.14` Карточка контакта: ФИО правится по частям (группа «ФИО»), Telegram и WhatsApp перенесены в «Социальные сети» списком, клик по компании открывает карточку компании
- [x] `M7.6.15` Секция «Сделки» с созданием прямо из карточки контакта и компании — их `RecordDetailRelationSectionDropdownToMany` с `onCreate`. Воронка и стадия берутся первые у тенанта, связь подставляется из контекста
- [x] `M7.6.16` Фильтры `contact_id` / `company_id` в `GET /crm/deals` — без них секция сделок на карточке не могла показать связанные записи
- [x] `M7.6.17` Вкладка «Задачи» на карточках контакта и компании: создание с привязкой к текущей записи, чекбокс завершения, удаление
- [x] `M7.6.18` Секция «Контакты» на карточке компании показывает сами записи с переходом в контакт, а не только счётчик
- [x] `M7.6.19` Правка заметок по месту (`Pencil` → textarea → `Ctrl+Enter`). `useUpdateNote` существовал, но UI его не вызывал
- [x] `M7.6.20` Задачи: правка и удаление на странице задач, выбор исполнителя из пользователей тенанта и выбор связанной записи вместе с типом. Закрывает `M7.4.11`; прежняя форма ставила исполнителем только текущего пользователя, а тип связи без записи отклонялся схемой бэкенда
- [x] `M7.6.21` Интеграционные тесты модели контакта (`src/tests/contacts-model.test.ts`, 15 проверок): обязательность только имени, раскладка телефонов на основной и дополнительные, согласованность колонок соцсетей со списком, создание и переиспользование компании по названию, поиск по дополнительному номеру и соцсети
- [x] `M7.6.22` Тест нашёл незакрытый путь того же дефекта: при недействительном или чужом `company_id` связь снималась, а название оставалось у контакта строкой без записи в `companies`. Теперь такой запрос идёт по обычному разбору названия — у своего арендатора создаётся своя компания

### M7.7 — Исправления по локальному ревью M7.6
- [x] `M7.7.1` Тест-раннер фронтенда (Vitest + jsdom + Testing Library) и 13 тестов на `PhonesInput` / `SocialsInput`. Причина появления конкретная: четыре дефекта ниже прошли `tsc`, `next lint` и `next build`, потому что поведение компонентов никто не выполнял
- [x] `M7.7.2` `PhonesInput` и `SocialsInput` переведены на собственное состояние строк. Рендер из пропа `value` с фильтрацией пустых значений ломал главный сценарий: кнопки «Добавить номер» и «Добавить сеть» не добавляли строку вовсе, а выбор сети до ввода значения откатывался на Telegram
- [x] `M7.7.3` Снятие префикса страны переведено на `libphonenumber-js` (`nationalPart`). Регулярка `/^\+\d+/` жадная и не ограничена длиной кода: на `+79161234567` она снимала весь номер. Следствия — сохранённые номера показывались пустыми полями, а смена страны обнуляла номер
- [x] `M7.7.4` Черновики ввода ключуются стабильным id строки, а не индексом: `commit` меняет и длину списка, и порядок, поэтому после удаления номера поле показывало значение другой строки
- [x] `M7.7.5` Миграция `0020`: сверка арендатора в обнулении висячих ссылок и в синхронизации названия. Без неё ссылка на компанию другого арендатора проходила проверку, принималась новым FK и копировала чужое название в `contacts.company_name` и его поисковый индекс
- [x] `M7.7.6` Миграция `0020`: снимок исходных значений в `contacts_company_backfill_0020` перед разрушающими шагами, отметка `was_cross_tenant` для разбора инцидентов изоляции. Секции Down у SQL-миграций нет, а `migrate:up` вызывается из entrypoint при каждом старте контейнера
- [x] `M7.7.7` Миграция `0020`: триггер `trg_contacts_updated_at` выключается на время backfill — иначе семь массовых `UPDATE` переписали бы дату изменения всем контактам, и «недавно изменённые» показали бы всю таблицу
- [x] `M7.7.8` `CHECK` и `FOREIGN KEY` в `0020` добавляются как `NOT VALID`; индексы и `VALIDATE CONSTRAINT` вынесены в `0021`. Причина — раннер держит `ACCESS EXCLUSIVE` от первого `ALTER TABLE` до `COMMIT`, и валидация с двумя GIN-индексами внутри этого окна закрывала бы `contacts` на чтение
- [x] `M7.7.9` `0021` написана на JS с `pgm.noTransaction()`: `CREATE INDEX CONCURRENTLY` не работает ни в SQL-миграции, ни с `--no-single-transaction` — проверено на postgres:16, оба варианта падают с `25001`. Загрузчик раннера выбирает обработчик по расширению файла, поэтому `.js` рядом с `.sql` работает без правки конфига
- [x] `M7.7.10` Односимвольные прочерки (`-`, `—`) чистятся только у контактов без связи с компанией: у связанного контакта это не заглушка, а расхождение, которое перезапишется названием самой компании
- [x] `M7.7.11` Перенос мессенджеров в `socials` добирает расхождение колонок и массива, а не только полностью пустое состояние — иначе догоняющий прогон не исправил бы записи, созданные старой версией приложения после первого применения
- [x] `M7.7.12` Задачи: `linked_entity_type` и `linked_entity_id` добавлены в `UpdateTaskPayload` и передаются в `PATCH`. Форма позволяла менять связь, но полей в запросе не было — выбор молча терялся при показанном тосте «Задача обновлена»
- [x] `M7.7.13` Подписи связей ограничены арендатором во всех четырёх местах (`deals`, `contacts`, `companies`, `notes`): JOIN шёл только по id. Реальная утечка была через `users` — эта таблица не входит в список под RLS, поэтому чужой `owner_id`/`created_by` подставлял в ответ имя пользователя другого арендатора. Закрыть `users` политикой нельзя: вход ищет пользователя по e-mail до того, как арендатор известен, и под RLS такой запрос вернул бы ноль строк. Счётчики связей (`LATERAL`) тоже получили сверку арендатора
- [x] `M7.7.14` `PATCH /deals/:id` проверяет принадлежность `stage_id`, `contact_id`, `company_id` и `owner_id`. `createInTx` и `moveStage` это делали, `update` — нет: он писал ссылки прямо из тела запроса, а FK здесь не страховка (у `deals.contact_id` и `company_id` его нет вовсе). Стадия сверяется по воронке самой сделки, как в `moveStage`
- [x] `M7.7.15` Тесты изоляции сделок (`src/tests/deals-isolation.test.ts`, 10 проверок): подписи чужих компании, контакта и ответственного не попадают в ответ; `PATCH` отклоняет каждую из четырёх чужих ссылок; свои ссылки принимаются, пустая строка снимает связь. Проверено, что тесты падают на прежнем коде — 5 из 10
- [x] `M7.7.16` Заголовок заметки в UI: поле при создании, правка вместе с текстом, показ в списке. Колонка `notes.title` и её валидация существовали с `M7.5.2` (у Twenty `Note.title` тоже nullable), но интерфейс заголовок не отправлял и не читал — задать его было нельзя

### M7.8 — Чат и автосоздание из канала: работоспособность переписки
Найдено при сверке кода перед работой над мобильной вёрсткой. Порядок обратный
обычному: сначала работоспособность, потом оформление — оформлять чат, пока
переписка односторонняя, нечего.
- [x] `M7.8.1` `contact_id` при автосоздании сделки в `processIncoming`. `findActiveDeal` ищет открытую сделку **по `contact_id`**, а сделка создавалась без него: условие не выполнялось, и канал создавал новую сделку на каждое сообщение того же клиента. Одна строка, но база наполнялась дублями на работающем проде. Побочно: секция «Сделки» на карточке контакта (`M7.6.15`) была пуста на всех автосозданных сделках, `contactName` в таблице сделок — пустым
- [x] `M7.8.2` Интеграционные тесты автосоздания (`src/tests/crm-pipeline.test.ts`, 4 проверки): два сообщения одного клиента дают одну сделку; сделка связана с контактом; оба сообщения в таймлайне одной сделки; разные клиенты получают разные сделки. Проверено, что тесты падают на прежнем коде — 3 из 4
- [x] `M7.8.3` **Ответ менеджера уходит клиенту.** `POST /crm/deals/:id/messages` только писал строку в `deal_messages`: в `deals.service.ts` не было ни одного обращения к транспорту, а `TelegramTransportService.sendReply` был приватным и вызывался только из ветки AI-ответа. Менеджер печатал в карточке, сообщение появлялось в таймлайне, клиент в Telegram не получал ничего
- [x] `M7.8.4` Реестр исходящих (`modules/channels/outbound-registry.ts`): транспорт регистрирует себя при старте, маршрут спрашивает отправителя по каналу. Прямой импорт был невозможен — транспорт живёт в `server.ts`, а не в `buildApp`, потому что держит постоянные MTProto-сокеты, и в тестах это означало бы сетевые соединения на каждый прогон
- [x] `M7.8.5` Миграция `0022`: `deal_messages.delivery_status` (`neutral|pending|sent|failed`) и `delivery_error`. Статус на строке сообщения, а не тостом: тост исчезает, а неотправленное сообщение осталось бы висеть в таймлайне как отправленное, и менеджер ждал бы ответа на то, что до клиента не дошло
- [x] `M7.8.6` `DealMessagingService`: запись со `pending` → отправка → обновление статуса. Обратный порядок терял бы текст ответа при отказе сети. Отказ доставки не превращается в 5xx — ответ `201` с `failed` и причиной, потому что сообщение сохранено, а 5xx оставил бы фронт в неизвестности. Получатель — `telegram_chat_id` контакта (числовой id, не username: username мог измениться), аккаунт-отправитель — тот, на который клиент писал последним в этом канале
- [x] `M7.8.7` Ошибка доставки видна у самой строки в таймлайне (рамка `rose-500/30`, «Не доставлено», текст причины) в обеих реализациях чата — `ChatTab` в дровере и `CenterPanel` на странице сделки. Текст ошибки Telegram передаётся как есть: `USER_IS_BLOCKED` и `FLOOD_WAIT` требуют разных действий оператора
- [x] `M7.8.8` Интеграционные тесты отправки (`src/tests/deal-messaging.test.ts`, 8 проверок): вызов транспорта с получателем и аккаунтом переписки; `sent` при успехе; `failed` с сохранением строки при отказе; отсутствие 5xx при исключении транспорта; `failed` при незарегистрированном канале и при контакте без адреса; внутренняя заметка не отправляется и остаётся `neutral`; статус виден при повторном чтении таймлайна
- [x] `M7.8.9` **Входящие появляются без перезагрузки.** `useDealTimeline` был обычным `useQuery` без `refetchInterval`, без SSE и без вебсокета, а инвалидация стояла только после своей отправки — ответ клиента менеджер видел, лишь нажав F5. Добавлен опрос раз в 5 с, включаемый флагом `live` только у открытой вкладки чата: постоянный опрос по всем сделкам — лишняя нагрузка. `refetchIntervalInBackground` не включён, поэтому в неактивной вкладке браузера опрос останавливается сам
- [x] `M7.8.10` Тесты хука (`src/lib/api/use-deal-timeline.test.tsx`, 3 проверки): опрос в режиме `live`, отсутствие опроса без него, отсутствие запросов без id сделки. Проверено, что первый падает без `refetchInterval`. Тест `live` идёт на настоящих таймерах: с подменёнными React Query обновляет кеш, но рассылку подписчикам делает своим планировщиком, и проверялись бы внутренности библиотеки, а не то, что видит менеджер
- [x] `M7.8.11` **Профиль Telegram в контакт.** Транспорт передавал `senderName: batch.peerId` — числовой id, — и `processIncoming` разбирал его как ФИО: в карточку попадало имя вида `123456789`, в заголовок сделки «Заявка от 123456789 (Telegram)». Профиль не запрашивался вовсе (поиск по `getEntity|firstName|username|phone` по транспорту давал ноль совпадений). Добавлен `getEntity(peerId)` → `firstName`, `lastName`, `username`, `phone`. `getEntity`, а не `GetFullUser`: полный профиль не нужен, а этот метод использует внутренний кэш GramJS и часто обходится без сетевого вызова
- [x] `M7.8.12` Fallback без профиля — `«Клиент»`, а не идентификатор: он остаётся в `telegram_chat_id`, где ему и место. `senderName` разбирается как ФИО только если не похож на идентификатор (`/^@?\d+$/`) — тогда это осмысленное имя из другого канала
- [x] `M7.8.13` `socials` получают рабочий `@username` вместо `@{chatId}`: прежняя ссылка `t.me/123456789` не открывается. Без username не записывается ничего — пустая секция честнее нерабочей ссылки
- [x] `M7.8.14` `chatId` больше не подставляется в `phone`. Числовой id Telegram попадал в колонку, по которой ищет `findContactByPhone`, то есть в поиске по номеру появлялись записи с идентификатором вместо номера. Для WhatsApp `chatId` — настоящий номер, и оттуда он берётся
- [x] `M7.8.15` **Соцсети для MAX, WhatsApp и Instagram.** Условие жёстко проверяло `channel === "telegram"`, поэтому у клиента из MAX мессенджер в карточке не появлялся, хотя канал разрешён в `channel_accounts`. Перевод — таблицей `SOCIAL_KIND_BY_SLUG`
- [x] `M7.8.16` **Найдено при этом же разборе:** слаги каналов расходятся — в `channel_accounts` мессенджер называется `max`, а `contacts.channel` знает только `rumax`. Приведение типа (`input.channel as ...`) скрывало это от компилятора, а `CHECK` на колонке нет, поэтому в БД попадало значение, которого нет в перечислении фронта, и цвет метки канала не находился. Перевод — таблицей `CONTACT_CHANNEL_BY_SLUG`; каналы без своего значения (`avito`, `instagram`) остаются `phone`
- [x] `M7.8.17` Кэш профилей (`modules/channels/profile-cache.ts`): TTL сутки для найденного профиля и 10 минут для отсутствующего. Без кэша каждое сообщение постоянного клиента означало бы запрос к Telegram, хотя имя не меняется месяцами — лишний вызов на путь ответа и повод упереться во `FLOOD_WAIT`. Отрицательный результат кэшируется тоже: закрытый настройками приватности профиль не откроется в следующую минуту. Предел 5000 записей — кэш живёт всё время работы процесса, и без него растёт по записи на каждого написавшего клиента
- [x] `M7.8.18` Заголовок новой сделки известного клиента берёт ФИО из его карточки, а не из профиля: профиль мог стать недоступным, и у постоянного клиента появлялась бы «Заявка от Клиент» при заполненном ФИО. Профиль при этом не переписывает существующий контакт — менеджер мог поправить имя руками
- [x] `M7.8.19` Раскладка профиля вынесена в `modules/crm/channel-identity.ts`: после добавления профиля `crm-pipeline.service.ts` перевалил за 500 строк — границу канона `caveman-save`. Разделение по ответственности, а не по объёму: в пайплайне остались поиск контакта, сделка и запись сообщения (транзакции и БД), в новом модуле — чистые преобразования «что пришло из канала» → «что записать в карточку»
- [x] `M7.8.20` Тесты профиля и каналов (`src/tests/crm-pipeline-profile.test.ts`, 13 проверок; `src/tests/profile-cache.test.ts`, 7 проверок на TTL и вытеснение с поддельным временем). Все 11 первых падали на прежнем коде. Проверка `M7.8.18` сначала была неверной — `toContain` по списку заголовков находил заголовок первой сделки и проходила бы и без правки; исправлена на проверку заголовка конкретной новой сделки по её id

### M7.9 — Один экран деталей сделки вместо двух
Закрывает пункты 19–21 плана мобильной вёрстки. Сделано до адаптации, а не после:
иначе мобильный режим пришлось бы делать в двух местах.
- [x] `M7.9.1` **Вкладки сделки вынесены в `components/crm/deals/deal-tabs.tsx`** — один источник содержимого для панели и для страницы. `dealTabs(deal, context)` отдаёт список `{ id, label, content }`; порядок Главная 10 → Чат 15 → Задачи 30 → Заметки 40 → Файлы 50 совпадает с позициями будущих строк `page_layout_tabs`, поэтому этап 6 их не пересчитывает
- [x] `M7.9.2` `DealDrawer` стал обёрткой: 445 строк → 86. Осталась только оболочка (панель 480px справа) — именно она и отличает открытие из списка от перехода по ссылке. Тип `DrawerStageInfo` сохранён как псевдоним `DealStageInfo`: его импортируют страница сделок и тулбар
- [x] `M7.9.3` **`/crm/deals/[id]` рендерит то же содержимое.** Прежняя версия была слабее дровера: три жёсткие колонки (`w-[32%]` / `flex-1` / `w-[22%]`), из которых две заполнены заглушками про «отдельные вертикальные срезы», без задач, заметок и правки, а в «Деталях» — сырые `stageId` и `pipelineId`. Адрес и гейт `deals:read` сохранены: на страницу ведут уведомления (`NotificationDropdown`) и запасная ветка `DealCard` без `onOpen`, ссылки стали бы битыми
- [x] `M7.9.4` Названия этапов на странице: читается канбан по воронке самой сделки, из него берутся имя и цвет. Показывать UUID вместо «Новый лид» было главной претензией к прежней версии. Содержимое ограничено `max-w-3xl`: оно рассчитано на панель 500px и на широком мониторе растянулось бы во всю ширину
- [x] `M7.9.5` **Второй реализации чата больше нет.** `CenterPanel.tsx` удалён вместе с `LeftPanel.tsx`, `RightPanel.tsx`, `DealRelationsPanel.tsx` — три последние не импортировались нигде (остатки раннего среза). Каталог `components/crm/deals/detail/` удалён целиком. `lib/crm/deals.types.ts` осиротел ровно наполовину: его держит `lib/crm/mock-deals.ts`, который снимается вместе с переводом палитры поиска на реальные данные (пункт 18 плана)
- [x] `M7.9.6` Тесты состава (`deal-tabs.test.tsx`, 5 проверок): панель и страница получают одинаковый состав и порядок; состав совпадает с `DEAL_TAB_IDS`; у каждой вкладки есть содержимое; состав не зависит от загруженности справочника этапов — иначе полоса вкладок дёргалась бы после второго запроса
- [x] `M7.9.7` Тесты страницы (`deal-detail-page.test.tsx`, 6 проверок): все пять вкладок на месте, название этапа вместо идентификатора, отсутствие заглушек про срезы, переключение на чат, сумма и контактное лицо, ссылка назад к воронке. Проверено на прежней реализации страницы — падают 5 из 6 (шестая, ссылка «Назад к воронке», была и там)

### M7.10 — Фундамент мобильного режима
Этап 1 плана мобильной вёрстки. Раскладку страниц пока не меняет: это основа, на
которой строятся остальные этапы.
- [x] `M7.10.1` **`viewport` в `app/layout.tsx`** — `{ width: "device-width", initialScale: 1 }`. Без него мобильный браузер отдаёт вымышленную ширину 980px и масштабирует готовую страницу: ни один медиазапрос и ни один `md:`-класс не срабатывают как задумано, адаптация не работает вовсе. Первым пунктом именно поэтому — иначе остальное проверялось бы в неверном масштабе. `maximumScale` и `userScalable` не задаются: запрет зума ломает доступность и ничего не даёт
- [x] `M7.10.2` `lib/utils/use-is-mobile.ts`: `MOBILE_VIEWPORT = 768` константой (CSS-переменные не работают внутри медиазапросов — ограничение CSS, не сборки) и хук `useIsMobile` на `useSyncExternalStore` из React 19. Без `react-responsive`, на котором эти хуки у Twenty: зависимости в проекте нет, а у `useSyncExternalStore` есть отдельный серверный снимок, поэтому значение при SSR задаётся явно, а не выводится из отсутствия `window`
- [x] `M7.10.3` **Запрос `max-width: 767px`, а не `768px`.** Проверено, что брейкпоинты дефолтные: `globals.css` содержит только `@import "tailwindcss"` без блока `@theme`, а `tailwind.config.ts` в Tailwind 4 без директивы `@config` вообще не загружается — файл в проекте есть, но не действует. Значит `md:` = `min-width: 768px`, и при запросе `max-width: 768px` на ровно 768px истинны оба условия: `md:`-классы применяются, и хук говорит «мобильный». 767px делает хук точным дополнением к `md:`. Отклонение от Twenty (там `768px`) осознанное: у них раскладка на styled-components со своими медиазапросами, а не на утилитах Tailwind
- [x] `M7.10.4` `useIsTouchDevice` на `(hover: none) and (pointer: coarse)` — отдельно от ширины. Узкое окно на десктопе всё ещё поддерживает hover, планшет в ландшафте — нет; ветвить взаимодействие по ширине — дефект, про который прямо написано в комментарии `useIsTouchDevice.ts` у Twenty
- [x] `M7.10.5` **`useOverlay` вместо 18 независимых блокировок прокрутки.** Пересчитано точно: 18 компонентов, 33 обращения к `document.body.style.overflow`. Каждый снимал блокировку безусловно, поэтому тот, кто закрывается первым, возвращал прокрутку фону у всех, кто ещё открыт — воспроизводится и без мобильного: карточка контакта → «Удалить» → `ConfirmDialog` поверх, закрытие подтверждения возвращает прокрутку при открытой карточке
- [x] `M7.10.6` **Найдено тестом на предыдущий пункт, вне плана: Escape закрывал все оверлеи разом.** Те же 18 компонентов вешали каждый свой слушатель `keydown` на `document`, поэтому нажатие над диалогом подтверждения убирало и диалог, и карточку под ним — человек терял контекст, хотя отменил только удаление. Дефект той же природы, что и прокрутка (несколько независимых претендентов на одно глобальное состояние), поэтому решается тем же стеком: Escape достаётся только верхнему оверлею
- [x] `M7.10.7` Стек живёт в модуле, а не в React-контексте: провайдер пришлось бы поставить в корневой layout и протащить во все 18 компонентов, часть которых лежит в разных ветках дерева (`ui/sheet` внутри карточки, `ConfirmDialog` поверх неё). Состояние описывает единственный `document.body` и единственную клавиатуру — глобально по природе, ровно как сам DOM. `openOverlayCount()` даёт признак «открыт хотя бы один оверлей» для мобильного бара
- [x] `M7.10.8` Опция `disabled` для оверлеев с отправкой (`isPending`): Escape посреди запроса терял бы введённые данные при уже начатом сохранении. Событие при отказе не проваливается ниже — иначе Escape закрыл бы карточку под диалогом, который сам закрываться отказался
- [x] `M7.10.9` Тесты (`use-is-mobile.test.tsx` 8, `use-scroll-lock.test.tsx` 7, `nested-overlays.test.tsx` 5): запрос `max-width: 767px` именно этой ширины, реакция на поворот экрана, снятие подписки, отсутствие падения без `matchMedia` (серверный рендер), несвязанность двух хуков; счётчик оверлеев, восстановление прежнего `overflow` вместо затирания пустой строкой, закрытие в произвольном порядке; вложенные оверлеи на настоящих компонентах. Проверено на прежнем поведении: подмена границы на 768px роняет 4 из 8, безусловное снятие блокировки — 5 из 7, рассылка Escape всем — 1 из 5. Первая версия теста на хук сама была неверной: проверяла запрос по карте заранее засеянных результатов, где он истинен всегда
- [x] `M7.10.11` **Разделы вне CRM, поехавшие от включения `viewport`.** До `M7.10.1` мобильный браузер отдавал вымышленные 980px и масштабировал страницу, поэтому безусловный `grid-cols-3` там не был виден; теперь виден по-настоящему. Исправлены `finance/page.tsx:161`, `repairs/page.tsx:168`, `settings/referral/page.tsx:26` — три KPI-карточки с суммами в рублях делили 360px по ~110px. Стало `grid-cols-1 sm:grid-cols-3`: граница `sm:` (640px), а не `md:`, потому что три карточки помещаются уже на 640px — проверено, суммы не обрезаются
- [x] `M7.10.12` `repairs/[id]/page.tsx`: колонка `w-[320px] min-w-[320px]` не давала себя сжать — на 360px занимала весь экран, а контент рядом получал отрицательное место и уезжал за край. Стала `w-full` с `md:w-[320px]`. Жёсткая высота `h-[calc(100vh-4rem)]` ушла под `md:`: на телефоне две области с собственной прокруткой поделили бы экран пополам, оставив по паре строк в каждой. Верхняя панель получила `flex-wrap` (три кнопки с подписями плюс номер и статус в 360px не влезают), полоса вкладок — `overflow-x-auto`
- [x] `M7.10.13` `RepairStatusStepper`: шесть шагов с подписями `whitespace-nowrap` требуют около 400px, `flex-1` сжимал только соединители. Добавлена горизонтальная прокрутка с `min-w-max`; соединители получили явную ширину `w-8`, иначе при `min-w-max` они сжимались до нуля и шаги слипались. С `md:` возвращается прежнее поведение на `flex-1`
- [x] `M7.10.14` Проверено браузером на 360 / 639 / 640 / 768px: на 360px одна колонка и отсутствие горизонтального переполнения, на 639px одна, на 640px три, на 768px десктопная раскладка целиком (ряд, колонка 320px, степпер без прокрутки). Прежняя проверка была невозможна — до `viewport` браузер масштабировал страницу, и замеры не отражали реальность
- [x] `M7.10.15` Тест `src/app/responsive-layout.test.ts` (3 проверки) по исходникам, а не рендером: дефект чисто статический (префикс в классе либо есть, либо нет), а рендер каждой страницы потребовал бы моков всех её запросов. Браузерная проверка однократна и не переживает правку файла, а этот тест переживает. Третья проверка — проверка самой проверки: без неё тест мог бы проходить из-за неверной регулярки и молча ничего не проверять
- [x] `M7.10.16` **Тест нашёл два места, которых план не называл:** `(admin)/tenants/page.tsx:106` с тем же `grid-cols-3` (исправлено) и `superadmin/page.tsx:172` с `min-w-[900px]` — там нарушения нет, таблица уже лежит в `overflow-x-auto`, и фиксированная ширина задаёт ширину прокручиваемого содержимого. Правило теста уточнено: широкая колонка внутри прокручиваемого контейнера допустима
- [x] `M7.10.17` **Навигационные списки вынесены в `lib/navigation/nav-items.ts`** — предварительное условие мобильного меню, сделано до создания `/menu`. `Sidebar.tsx` сократился с 556 до 429 строк. Дублировать списки в меню означало бы, что скрытый в сайдбаре раздел останется видимым в меню, и пользователь получит «нет доступа» по ссылке из меню — расхождение вопрос времени, а не вероятности. Вместе со списками переехало правило `isNavItemVisible` («модуль установлен И есть право», `tenant:admin` как надмножество, `null` во время восстановления сессии): оно уже однажды чинилось, менеджер видел «Финансы» и получал заглушку по ссылке
- [x] `M7.10.18` Сайдбар скрыт классом `hidden md:flex`, а не веткой по `useIsMobile`: `matchMedia` недоступен при SSR, и структурная зависимость от хука дала бы вспышку сайдбара на телефоне при каждой загрузке. Отступ контента ушёл под `md:pl-60` / `md:pl-16` — **без этого на телефоне оставалась пустая полоса 240px, а страница уезжала за край ровно на ширину панели**
- [x] `M7.10.19` `MobileNavigationBar`: три кнопки — Панель, Поиск, Меню. Полный список не поместился бы, разделов больше десятка вместе с модулями и каналами, а в ряд на 360px влезает три-четыре области нажатия по 44px. Поиск в центре не по симметрии: центр бара — самая доступная точка для большого пальца, и это единственный путь к палитре (поля с ⌘K на телефоне нет). Бар прячется под открытым оверлеем через `useHasOpenOverlay()` — иначе кнопки висят поверх формы, перекрывая последнее поле и кнопку отправки
- [x] `M7.10.20` `useHasOpenOverlay()` добавлен в `use-scroll-lock.ts` как подписка на `useSyncExternalStore`. Первая версия бара опрашивала `openOverlayCount()` в `requestAnimationFrame` — это перерисовка 60 раз в секунду впустую; заменено на уведомление подписчиков из `acquire`/`release`
- [x] `M7.10.21` Маршрут `/menu` вместо выдвижной панели: системная кнопка «назад» обязана закрывать меню, а не уводить со страницы, и маршрут даёт это бесплатно — панель потребовала бы перехвата истории вручную. Так же у Twenty. Разделы берутся из общего модуля; блок пользователя, разделы компании с описаниями, платформенные разделы по `platform_role` и выход — всё, что на десктопе живёт в нижней части сайдбара
- [x] `M7.10.22` `pb-20` у `<main>` на мобильном: бар `fixed`, то есть выпадает из потока, и без отступа последняя строка списка оказывалась под кнопками и не долистывалась. Проверено — кнопка «Выйти» в меню долистывается полностью. `px-4` вместо `px-6`: на 360px каждый лишний пиксель отступа сужает и без того тесную колонку
- [x] `M7.10.23` **Шапка: поле поиска не сжималось и выдавливало кнопки за край.** Найдено проверкой в браузере: переполнение осталось после скрытия сайдбара — 534px против 360. Причина — `flex-1 max-w-md` без `min-w-0`: flex-элемент не сжимается ниже размера содержимого («Поиск сделок, контактов, наряд-заказов…» плюс `⌘K` — около 374px), а `max-w-*` ограничивает сверху, а не снизу. Поле скрыто на мобильном (`hidden md:block`), его роль играет кнопка в баре; слева вместо него логотип с названием арендатора
- [x] `M7.10.24` **`CommandMenu` был 19-м оверлеем вне общего стека.** Найдено проверкой в браузере: палитра открывалась, а прокрутка фона оставалась и бар не прятался. Escape у неё тоже обрабатывался отдельно, то есть закрыл бы заодно карточку под палитрой. Переведена на `useOverlay`; открытие по ⌘K и ⌘N осталось своим обработчиком — они работают, когда палитра закрыта, то есть вне стека
- [x] `M7.10.25` Проверено браузером на 360 / 767 / 768px: на 360px сайдбар `display: none`, бар `flex`, отступ слева 0, отступ снизу 80px, **горизонтального переполнения нет** (было 774px до правок); на 767px то же; на 768px десктоп возвращается целиком — сайдбар 240px, бар скрыт, отступ 240px, поиск в шапке. Открытие палитры: бар скрывается, `body.overflow` становится `hidden`
- [x] `M7.10.26` Тесты (`nav-items.test.ts` 13, `mobile-navigation-bar.test.tsx` 8): состав и порядок разделов, все ветки правила видимости; бар — состав кнопок, `md:hidden` вместо ветки на хуке, подсветка активного раздела, скрытие под оверлеем через настоящий `ConfirmDialog` (а не мок счётчика — иначе тест проверял бы сам себя), сохранение в дереве, скрытие под палитрой. Проверено, что снятие связи с оверлеями роняет тест. Первая версия проверки скрытия сравнивала классы подстрокой и была ложно-зелёной: `md:hidden` содержит `hidden`
- [x] `M7.10.27` **Палитра поиска (⌘K) переведена на реальные данные.** `searchEntities` фильтровала три массива вымышленных записей из `lib/crm/mock-deals.ts` и `lib/repairs/mock-repairs.ts`. Стало срочным после `M7.10.19`: поиск — одна из трёх кнопок мобильного бара, то есть на телефоне главный путь навигации, и заглушка там означала, что основной способ найти запись показывает несуществующие данные. Новый хук `lib/api/use-global-search.ts` — четыре параллельных запроса (сделки, контакты, компании, ремонты), потому что сводного эндпоинта на бэкенде нет, а каждый список уже умеет `?search=`
- [x] `M7.10.28` **Найденная запись открывает саму запись, а не список раздела.** `ENTITY_HREF` содержал `/crm/deals`, `/crm/contacts`, `/repairs` — без идентификатора, то есть найденная сделка открывала воронку целиком и пользователь искал её глазами заново. Адрес теперь приходит в самом результате
- [x] `M7.10.29` **Пункт 17 плана как условие работоспособности поиска:** у карточек контакта и компании своего маршрута нет, они панель поверх списка, поэтому ссылка выражается параметром `?record=<id>`. Новый хук `lib/utils/use-record-param.ts` синхронизирует состояние с адресом; `push` при открытии и `replace` при закрытии — одинаковый метод копил бы историю, и «назад» снова открывало бы только что закрытую карточку. Побочно: на телефоне системная кнопка «назад» закрывает карточку, карточку можно отправить ссылкой, обновление страницы возвращает её же. Подключено к контактам и компаниям
- [x] `M7.10.30` Задержка ввода 300 мс, как на списках контактов и компаний: без неё «иванов» дал бы 6 × 4 = 24 запроса к API. Ремонты запрашиваются только при установленном модуле — иначе эндпоинт отвечает 403 `MODULE_NOT_INSTALLED`, и запрос гарантированно неудачен
- [x] `M7.10.31` Три состояния вместо одного: «идёт поиск», «не удалось выполнить поиск», «ничего не найдено». Прежде поиск шёл по массивам в памяти и был мгновенным, поэтому существовало только последнее — с запросом к API при медленной сети палитра утверждала бы, что записи нет, пока ответ в пути
- [x] `M7.10.32` **Найдено при написании теста: первый вариант `fetchSource` глотал любую ошибку**, поэтому состояние отказа в палитре было недостижимым мёртвым кодом, а недоступный бэкенд выглядел как «ничего не найдено» — пользователь решил бы, что записи нет, и завёл её второй раз. Теперь 403 и 404 проглатываются (нет права или модуля — «здесь искать нечего»), остальное пробрасывается
- [x] `M7.10.33` Результаты сгруппированы по видам: до четырёх источников по пять записей — двадцать строк, в которых сделка и ремонт неразличимы без заголовка. Порядок Сделки → Контакты → Компании → Ремонты: первая строка под курсором должна быть той, которую нажмут по Enter не глядя
- [x] `M7.10.34` **Мёртвый код из `M7.9.5` снят.** Удалены `lib/crm/mock-deals.ts` и осиротевший `lib/crm/deals.types.ts` (каталог `lib/crm/` целиком), из `lib/repairs/mock-repairs.ts` убран `MOCK_REPAIR_TICKETS` — палитра была его единственным потребителем; файл 375 → 62 строки. Остальные наборы там держат формы приёмки ремонтов и уйдут вместе со своими эндпоинтами
- [x] `M7.10.35` Тесты (`command-menu.test.tsx` 12, `use-record-param.test.tsx` 9, `contacts/record-param.test.tsx` 3): запросы уходят на реальные эндпоинты с `?search=`, задержка ввода даёт четыре запроса, а не по одному на символ, переход ведёт на запись, группировка по видам, гейт модуля, три состояния, отличие 403 от сетевого отказа; `push`/`replace`, сохранение чужих параметров адреса, следование за внешним изменением; открытие карточки по `?record=` на самой странице. Проверено, что подмена адреса на список и возврат к локальному состоянию роняют соответствующие тесты
- [x] `M7.10.36` Проверено браузером на 360px: палитра открывается кнопкой бара, при вводе уходят три запроса на `/api/v1/crm/{deals,contacts,companies}?search=` с параметром, ремонты не запрашиваются без модуля. Открытие карточки по `?record=` браузером проверить не удалось — страница закрыта гейтом `contacts:read`, а фиктивная cookie прав не даёт; закрыто рендер-тестом с подменёнными правами
- [x] `M7.10.37` Устранена нестабильность в `use-deal-timeline.test.tsx`: один прогон из десяти падал на проверке автообновления. Это единственный тест на настоящих таймерах, файлы идут параллельно, и на загруженной машине применение результата не укладывалось в окно 10 с. Запас увеличен до 20 с (втрое больше интервала опроса). Точную причину воспроизвести не удалось за девять прогонов — зафиксировано в комментарии, чтобы следующий, кто увидит падение, не начинал с нуля
- [x] `M7.10.38` **Раскладка колонок вынесена в `use-record-table-layout.ts`** — условие мобильного режима таблицы: ветки для узкого экрана нужны и раскладке, и разметке, а в одном файле их пришлось бы переносить дважды. `RecordTable.tsx` 817 → 681 строка, хук 302. Граница по ответственности, а не по объёму: в хуке состояние и вычисления, не зависящие от разметки; фокус ячеек, выделение строк и сортировка остались в компоненте, потому что живут вместе с обработчиками клавиатуры и DOM
- [x] `M7.10.39` **Найден дефект при вынесении: битая запись раскладки затирала `defaultHidden`.** Поля разбирались по отдельности с подстановкой значений по умолчанию, и структура вида `{widths: "нет", order: 42}` давала `hidden: []` — пустой список делал видимой колонку, скрытую по умолчанию. Теперь запись годна только целиком: внутри одной версии формата (`v1.` в ключе) все три поля пишет наш же код, поэтому неверный тип означает негодную запись, а не «поле по умолчанию»
- [x] `M7.10.40` **Найден дефект в меню колонок: первую колонку можно было скрыть.** Условие `column.hideable !== false` истинно для `undefined`, а флаг `hideable` не выставлен ни на одной странице — то есть пользователь мог убрать «ФИО» из таблицы контактов и получить строки, в которых запись не опознать. Комментарий к типу при этом обещал обратное («первая колонка не скрывается»). Запрет теперь по идентификатору первой колонки из описания, а не по позиции в текущем порядке: перестановка колонок идентификатор не меняет
- [x] `M7.10.41` Тесты (`use-record-table-layout.test.ts` 19, `record-table.test.tsx` 14): чтение и запись раскладки, новая колонка кода не теряется у пользователя со старой раскладкой, исчезнувшая не «висит» в порядке, битый JSON и негодная структура, минимум ширины, шаблон грида на CSS-переменных; в компоненте — состав колонок, меню видимости, запрет скрытия первой, сброс, сохранение между визитами, выделение, сортировка. Проверено, что возврат прежнего разбора роняет тест
- [x] `M7.10.42` Проверено в браузере на изолированной странице (страницы CRM закрыты гейтами прав): ресайз 260 → 350px во время перетаскивания без участия React, запись в хранилище на отпускании, восстановление после перезагрузки; перестановка колонок drag-and-drop с сохранением порядка; «ФИО» заблокирована в меню с подписью «всегда» и не перетаскивается (`draggable="false"`)
- [x] `M7.10.43` **`localStorage` отсутствовал в тестовом окружении** — jsdom 26 его не поднимает, Node предупреждает про `--localstorage-file`. Добавлена реализация в памяти в `src/tests/setup.ts`: файл пришлось бы чистить между тестами и он переживал бы прогон, а состояние в памяти умирает вместе с процессом. Там же очистка между тестами: таблица начала хранить раскладку, и тест страницы контактов упал в общем прогоне, проходя в одиночку — сохранённая чужая раскладка скрывала колонку, которую он искал
- [x] `M7.10.44` Две свои ошибки в тестах по ходу: помощник `openColumnsMenu` не рендерил таблицу (пять тестов искали кнопку в пустом документе), а `tableId = TABLE_ID` в параметре по умолчанию подставлялось и на явный `undefined` — тест «без tableId» работал с ключом и проверял не то, что заявлял. Плюс три неверных предположения о коде: подпись кнопки сброса, направление первой сортировки (убывание, `sortAsc` стартует с `false`), способ проверки `disabled` (свойство, а не атрибут)
### M7.12 — Вёрстка страниц на мобильном
Этап 4 плана, пункты 12–15. Только классы и раскладка: ничего не меняет данные и не
трогает бэкенд, поэтому выкладывается и откатывается одним деплоем. Пункт 16 закрыт
раньше (`M7.10.11`–`M7.10.14`), пункт 11 вынесен отдельно — это переработка страницы
задач на 250 строк, а не правка классов.
- [x] `M7.12.1` **Палитра поиска во весь экран на мобильном.** `pt-[15vh]` вместе с `max-h-[50vh]` у списка оставляли результаты под экранной клавиатурой: она занимает около 40% высоты, отступ ещё 15%, и на список приходилась узкая полоса. Замерено после правки: список занимает 89% высоты против прежних ~35%. Скругления и рамка ушли под `md:` — на телефоне палитра отдельный экран, а не окно; поле ввода остаётся сверху, иначе клавиатура закрывает то, что печатает пользователь
- [x] `M7.12.2` Подсказки физической клавиатуры в палитре (`ESC`, `↑ ↓`, `↵`) скрыты на мобильном: они относятся к тому, чего на телефоне нет, и занимали место в тесной строке поиска и подвале
- [x] `M7.12.3` **`RecordDetailShell` во всю ширину на мобильном:** `max-w-[500px]` и рамка слева ушли под `md:` — на 360px ограничение ничего не даёт, а рамка выглядит как обрезанное окно. Кнопка закрытия 44×44px: это единственный способ закрыть карточку на телефоне, потому что фона за ней не видно и клик по фону недоступен
- [x] `M7.12.4` **Тулбар сделок: в ряду остаются поиск и переключатель вида.** В ряду восемь контролов (план называл шесть, не считая «НАСТРОИТЬ» и «НОВАЯ СДЕЛКА») — на 360px они переносятся в четыре строки и вытесняют доску за пределы экрана. Замерено: 2 строки против 3 на десктопе, в правой группе 2 видимых контрола против 4. Поиск получил `order-first` и полную ширину: это главный контрол страницы, он должен быть первым, а не после переключателя вида
- [x] `M7.12.5` **Скрытое из тулбара осталось доступным:** воронка и сводка «N сделок: сумма» переехали в меню «⋯». Скрыть, не перенеся, значило бы отнять возможность сменить воронку и узнать, сколько денег в ней лежит. Блок помечен `md:hidden` — на десктопе они есть в ряду, и дублировать их значило бы предлагать два пути к одному. Режим «НАСТРОИТЬ» не переносится: он строится на перетаскивании и inline-правке названий в узких колонках, то есть пальцем не работает в принципе
- [x] `M7.12.6` **Канбан: перетаскивание карточек отключено на мобильном** — жест удержания начинается так же, как горизонтальный скролл доски, и работает либо одно, либо другое
- [x] `M7.12.7` **Найдено при чтении кода: стрелки переноса между этапами были под `opacity-0 group-hover`.** Отключение drag без правки стрелок оставило бы канбан вообще без способа сменить этап сделки — hover на телефоне не существует. На мобильном стрелки видны всегда, область нажатия 36px (не 44px: две кнопки по 44px вытеснили бы название этапа между ними)
- [x] `M7.12.8` Тесты (`command-menu-mobile.test.tsx` 7, `deal-card-mobile.test.tsx` 9, `deals-toolbar-mobile.test.tsx` 11): полноэкранность палитры и высота списка, скрытие подсказок клавиатуры, порядок поля и списка; отключение drag карточки и постоянная видимость стрелок, ширина оболочки и размер кнопки закрытия, полоса вкладок при двух и более вкладках; состав ряда тулбара, скрытие воронки, сводки и «НАСТРОИТЬ», доступность воронки и сводки в меню, сохранность прежних пунктов. Пять тестов палитры падали до реализации
- [x] `M7.12.9` Проверено браузером на 360 / 767 / 768px: палитра 780px из 780 с полем сверху и списком 89% высоты; карточка записи во всю ширину с кнопкой 44×44px; тулбар 2 строки; карточка сделки `draggable="false"` со стрелками `opacity: 1`. На 768px всё возвращается: карточка 500px, кнопка 32×32, тулбар 3 строки, `draggable="true"`, стрелки `opacity: 0`
- [x] `M7.12.11` **Страница задач переведена на `RecordTable`** (пункт 11 этапа 4, вынесен отдельно от правок классов). Задачи были единственной страницей CRM со своей `<table>` и шестью жёсткими `<th>`, из-за чего её обходил **весь** мобильный режим `M7.11`: схлопывание первой колонки, отключение ресайза и перетаскивания, адаптивное меню колонок. Не работали и десктопные возможности — выбор видимых колонок, порядок и ширины между визитами. Ручная разметка строк (`renderTask` в табличной ветке) удалена, `tableId="tasks"`
- [x] `M7.12.12` Отметка выполнения ушла внутрь первой колонки, а не осталась отдельной ячейкой слева: у `RecordTable` служебная колонка одна (чекбоксы выделения), а идентификатором записи считается первая колонка описания. Статус и название теперь в одной колонке — так строка остаётся опознаваемой, и при схлопывании до 38px виден хотя бы значок выполнения
- [x] `M7.12.13` Сортировка приоритета по весу (`high: 3, medium: 2, low: 1`), а не по алфавиту: «Высокий» шёл бы перед «Низким», а «Средний» между ними — то есть случайно верно для двух значений из трёх. Пустой срок сортируется в конец (`9999-12-31`): задача без даты не «самая срочная»
- [x] `M7.12.14` Кнопки правки и удаления видны на мобильном без наведения — и в таблице, и в карточках канбана. `opacity-0 group-hover` рассчитан на курсор: тот же класс дефектов, что у стрелок переноса в канбане сделок (`M7.12.7`)
- [x] `M7.12.15` Тесты (`tasks-table.test.tsx`, 15 проверок): состав колонок, наличие меню колонок, сохранение раскладки под ключом `tasks`, сортировка; мобильный режим — отсутствие хватов и перетаскивания, схлопывание первой колонки при прокрутке, сохранность скролла и залипания; что не потерялось — отметка выполнения с проверкой тела запроса, зачёркивание выполненной, кнопки правки и удаления, фильтры, канбан-режим и распределение карточек по статусам, счётчик открытых. Три теста падали до перевода
- [x] `M7.12.16` **Общий предел времени тестов поднят до 20 с** (`vitest.config.ts`). Прежние 5 с по умолчанию давали ложные падения на тестах страниц: они рендерят страницу целиком и при параллельном прогоне файлов не укладывались в окно. Это случалось уже трижды (`M7.10.37`, `M7.12`, здесь), каждый раз лечилось точечным `timeout` в отдельном тесте — теперь предел общий, и точечные значения сняты как избыточные. Проверено тремя прогонами подряд: 192 теста зелёные
- [x] `M7.12.17` Своя ошибка в тестовых данных: пользователь описан полем `name` вместо `fullName`, из-за чего `UserAvatar` падал на `undefined.trim()` и **вся страница отрисовывалась пустой** — восемь тестов падали на «элемент не найден», а настоящая причина была видна только в stderr. Плюс два неверных селектора: пункт меню колонок и заголовок сортируемой колонки называются одинаково, различать их пришлось по индикатору «▼», а не по порядку в дереве
- [x] `M7.12.18` **Браузерная проверка этого шага не выполнена: инструменты Playwright стали недоступны посреди работы.** Мобильный режим закрыт рендер-тестами с подменой `matchMedia` — они проверяют схлопывание колонки, отсутствие хватов и перетаскивания. Чего они не покрывают: фактическую геометрию на 360px и переполнение страницы. Стоит проверить при первой возможности
- [x] `M7.12.19` **Раскладка колонок синхронизируется с сервером.** Backend: миграция `0023_record_table_layouts`, таблица `record_table_layouts` (tenant + user + table_id, JSONB layout, FORCE RLS), GET/PUT `/api/v1/crm/table-layouts/:tableId`, Zod валидация tableId (`contacts|companies|deals|tasks`) и полной раскладки. Каждая DB-операция фильтрует `tenant_id`, `user_id`, `table_id`; тесты доказывают изоляцию между пользователями одного tenant и между tenant
- [x] `M7.12.20` Frontend: `SyncedRecordTable` только на четырёх CRM-страницах. Сам `RecordTable` и `useRecordTableLayout` остаются Query-free: unit-тесты и локальные таблицы с произвольными id не требуют QueryProvider. Серверная раскладка всегда побеждает localStorage: устаревший кэш устройства не затирает настройку с другого браузера. Legacy localStorage мигрирует только после успешного GET с `data: null`; отказ GET — offline, а не подтверждение пустого сервера, поэтому миграция не идёт. Последний завершившийся PUT выигрывает — приемлемо для персональной настройки, ETag потребовал бы отдельного контракта
- [x] `M7.12.21` **Поиск теперь включает задачи.** Backend `GET /crm/tasks` получил параметр `search` по title/description; палитра делает пятый запрос и группирует результаты под «Задачи». Переход — `/crm/tasks?record=<id>`; страница задач отдельно читает DTO и открывает существующую форму правки. Таким образом ссылка из палитры открывает саму задачу, а не список. Это закрывает пункт 4, который был блокирован отсутствием адреса карточки задачи
- [x] `M7.12.22` **Браузерная проверка выполнена** (`playwright-core` вне проекта плюс Chromium из кэша; встроенный инструмент был недоступен). Вход формой невозможен — требуется OTP из Telegram, поэтому сессия ставится токенами `POST /auth/login` в localStorage и cookie, как это делает `session.ts`. Задачи на 360px: первая колонка схлопывается 300 → 38px, подпись заголовка уходит, ресайз-хватов 0, перетаскиваний 0, горизонтальный скролл есть, меню колонок 326px помещается без обрезки. Все четыре страницы CRM: данные видны, `documentOverflow: false`, сайдбар `none`, бар 64px, `pb-80px`, последняя строка не под баром; на 1280px сайдбар `flex`, бар `none`. Ошибок страницы нет
- [x] `M7.12.23` **Найден настоящий дефект, которого рендер-тесты не видели:** на 360px страницы задач и контактов переполнялись по-настоящему (`document.scrollWidth > innerWidth`), потому что ряд фильтров не переносился и не прокручивался — четыре кнопки с иконками требуют около 370px. Элементы за краем лежали **вне** прокручиваемой области таблицы, то есть это была поехавшая вёрстка, а не ожидаемый скролл. Исправлено `overflow-x-auto` до `md:` с переносом от `md:`, кнопкам добавлены `shrink-0` и `whitespace-nowrap`. Закреплено тестом `src/app/crm-filter-rows.test.ts`; проверено, что возврат прежнего класса роняет тест
- [x] `M7.12.24` Своя ошибка в проверке: после правки ряд фильтров тоже стал `overflow-x-auto` и оказался первым в DOM, поэтому `.first()` крутил его вместо таблицы — схлопывание показывало «300px после скролла». Проверка исправлена на поиск контейнера, содержащего `--rt-col-title`. Тот же дефект нашёлся в `tasks-table.test.tsx`: он тоже брал первый прокручиваемый контейнер и упал на полном прогоне — исправлен так же
- [x] `M7.12.25` **Повторный деплой 2026-09-03 после правки фильтров:** `sh scripts/deploy.sh all` — 206 фронт-тестов, 214 серверных, обе типизации, сборка и линт чистые. Все три контейнера healthy, 23 миграции, изнутри `front:200 api:200`, снаружи трижды `portal:200`, API health `{status:"ok",database:"up"}`

### Сессия 2026-09-03: пункты 17, 22, 23 плана

- [x] `M7.12.26` **Пункт 22:** вид (канбан/список) сохраняется в серверном представлении (`record_table_layouts.layout.viewMode`) — раньше `useState("kanban")` сбрасывал выбор при каждом заходе. Расширена схема Zod с `viewMode?: "kanban" | "table"`, поле необязательное — раскладки, сохранённые до появления поля, остаются годными. Хук `useDealsViewMode` дублирует логику раскладки: сервер важнее localStorage, но до ответа показывается кэш. Сохранение PUT всей раскладки разом, иначе ширины колонок стирались бы сменой вида. 8 тестов (рендер компонента, не `renderHook` из-за устаревших замыканий), backend tsc чистый
- [x] `M7.12.27` **Пункт 23 подтверждён и исправлен:** поиск **не** фильтровал канбан — `filteredDeals` шли в список, канбан получал `kanban.data` напрямую. Пользователь вводил запрос и не видел реакции; на телефоне это заметнее, потому что канбан режим по умолчанию. Добавлена `filteredColumns` с тем же поиском, счётчики и суммы колонок пересчитываются по отфильтрованному составу. 6 тестов страницы целиком (рендер, клик, ввод запроса)
- [x] `M7.12.28` **Пункт 17 подтверждён:** вложенный стек карточек уже работал — `?record=` для контакта, `?company=` для вложенной; каждая карточка делает `push` при открытии, `replace` при закрытии, поэтому аппаратная кнопка «назад» на телефоне закрывает верхнюю карточку, а не уводит со страницы. Дефект был в покрытии, а не в реализации. Написано 4 теста: запись в историю при открытии, рендер обеих по двум параметрам, возврат к контакту при закрытии компании, сохранение фильтра списка. Моки контакта и компании сверены с DTO — `requisites` и `address` вложены, а не плоские, иначе карточка падала на `company.requisites.inn`
- [x] `M7.12.29` **Браузерная проверка подтвердила пункт 22** прямо: свежий профиль браузера открыл таблицу (`hasColumnsMenu: true`), хотя localStorage был пуст — вид пришёл с сервера. Первый контекст переключил на список и дождался PUT `/table-layouts/deals` со статусом 200, тело запроса содержит `viewMode: "table"`. После перезагрузки того же профиля вернулся список, не канбан. Полная проверка пункта 23 сорвалась на импорте `playwright-core` (Node 26 + старая версия библиотеки), но фильтрация канбана закреплена 3 тестами страницы
- [x] `M7.12.23` **Деплой завершён 2026-09-03:** `sh scripts/deploy.sh all` повторно прогнал backend typecheck + 214 тестов, frontend typecheck, синхронизировал оба дерева, собрал образы и пересоздал контейнеры. `0023_record_table_layouts` применена автоматически — на проде 23 миграции. Все три контейнера healthy; проверка изнутри `front:200 api:200`, снаружи трижды `portal:200`, API health — `{status:"ok",database:"up"}`. Git-репозитория в рабочем каталоге нет, поэтому создать commit технически невозможно; факт выкладки зафиксирован здесь и в CHANGELOG
- [x] `M7.12.10` Свои ошибки в тестах по ходу: JSX-комментарий поставлен перед `return` (невалидная позиция, сломал сборку); `getByText("Навигация")` брал заголовок секции вместо подсказки клавиш; `closest("div")` от текста поднимался на уровень выше нужного в двух местах; роль пунктов меню — `menuitem`, а не `button`. Плюс замер в браузере искал «1 500 000» обычным пробелом, а `Intl.NumberFormat` даёт неразрывный — сводка в меню была на месте, а замер показывал обратное

### M7.13 — Вкладки карточек как данные (этап 6)

Закрывает пункты 27–30 плана. Layout sync API (этап 5) уже в `M7.12.19–20`.

- [x] `M7.13.1` **Миграция `0024_page_layout_tabs`** — таблица с PK `(tenant_id, object_type, tab_key)`, `position double precision`, `module_slug`, `required_permission`, FORCE RLS. Таблица добавлена в `schema.sql` (списки триггеров и RLS): чистая установка без прогона миграций создаёт её же
- [x] `M7.13.2` **Сид `0025_seed_page_layout_tabs`** — контакт/компания `home/tasks/notes`; сделка +`chat@15` (`deals:write`) и `files@50` с `is_active=false`. Тот же состав в `ensureTenantDefaults` — новый арендатор после регистрации не остаётся без вкладок
- [x] `M7.13.3` Backend API: GET/PATCH `/api/v1/crm/page-layouts/:objectType/tabs`, Zod в хендлере (как table-layouts). Первый GET сидит дефолты. Найден и исправлен баг нумерации `$N` в UPDATE (`$3` конфликтовал с `tab_key`)
- [x] `M7.13.4` Тесты `page-layout-tabs.test.ts` (7): auth, сид и порядок, chat permission + inactive files, PATCH, 404, неизвестный objectType, изоляция между tenant
- [x] `M7.13.5` Frontend: `use-page-layout-tabs.ts`, `resolve-page-layout-tabs.ts` (фильтр is_active → module → permission, неизвестный key пропускается), `useTabsRenderer` с запасным сидом до ответа GET
- [x] `M7.13.6` Карточки на данных: `ContactCard`, `CompanyCard`, `DealDrawer`, `/crm/deals/[id]`. `dealTabs` стал `dealTabContents` (реестр компонентов). Тесты resolve (6) + deal-tabs (4)
- [x] `M7.13.7` Документация: `01_02_DATABASE_SCHEMA.md`, `03_02_CRM_API.md` §8, CHANGELOG
- [x] `M7.13.8` **Деплой 2026-09-03:** `sh scripts/deploy.sh all` — backend 221 тест, обе типизации, сборка backend+frontend, контейнеры healthy. Миграции **25** (`0024`+`0025` применены). Таблица `page_layout_tabs` на проде: 3 tenant × (contact 3 + company 3 + deal 5) = 33 строки. Изнутри `front:200 api:200`, снаружи трижды `portal:200`, API health ok. Файлы `TabsRenderer.tsx` / `use-page-layout-tabs.ts` / миграции на `/opt/getvoxly`
- [x] `M7.13.9` **Пункт 29a:** на полной странице сделки с `md:` «Главная» закреплена слева (`PinnedPageTabs`), в ряду вкладок её триггер `md:hidden`. На телефоне и в дровере — одна полоса, как у Twenty (`pinnedLeftTab` только вне панели). Содержимое «Главной» монтируется один раз — две копии ломали бы хуки. Тесты: `splitPinnedTabs` (2), `pinned-page-tabs` (3), страница сделки обновлена (6)
- [x] `M7.13.10` **Модуль = вставка вкладок.** Реестр `MODULE_PAGE_LAYOUT_TABS`: `service_center` → контакт `repairs@20`. Toggle install/uninstall вызывает `applyModuleInstall` / `applyModuleUninstall` (is_active, без DELETE — повторная установка не плодит дубли и не затирает title/position). Фронт: `RecordRepairsTab` в реестре `ContactCard`. Инвалидация `pageLayoutTabKeys` после toggle. Миграция `0026` сидит вкладку уже установленным арендаторам. Попутно: `module_data_purges` добавлена в `schema.sql` — без неё POST toggle на чистой БД падал `42P01`. Тесты: 2 новых (install + uninstall/reinstall без дубля, 9/9)
- [x] `M7.13.11` **Finance → вкладка «Счета» на компании.** Реестр: `invoices@20`, `finance:read`. `GET /invoices?company_id=` — без фильтра вкладка показала бы все счета арендатора. `RecordInvoicesTab` в `CompanyCard`. Миграция `0027` для уже установленных. Тест install finance 10/10
- [x] `M7.13.12` **Последний след пункта 17: дровер сделок переведён на `?record=`.** Контакты и компании жили в адресе с `M7.10.29`, а сделки остались на `useState` — на телефоне системная кнопка «назад» уводила со страницы сделок вместо закрытия карточки, и ссылку на сделку из таблицы нельзя было отправить. Теперь `useRecordParam` как у остальных: `push` при открытии, `replace` при закрытии, чужие параметры адреса сохраняются. Попутно кнопке закрытия `SheetHeader` добавлен `aria-label="Закрыть"` — её нельзя было найти ни скринридером, ни тестом. Тесты `deal-record-param.test.tsx` (3): запись в историю, открытие по прямой ссылке, снятие параметра с сохранением фильтра. Все три падали до правки
- [x] `M7.13.13` **Канбан: этапы в одном горизонтальном ряду.** `grid auto-fit + 1fr` растягивал колонки и переносил лишние на второй ряд — шесть этапов «ломались» на две линии. Как RecordBoard у Twenty: `flex` + `overflow-x-auto` + фиксированные `w-[280px] shrink-0`. Тесты `deal-kanban-layout.test.tsx` (3) падали до правки
- [x] `M7.13.14` **Ресайз колонок канбана.** Хват на правой границе колонки, ширина 200–480px хранится в `kanbanColumnWidth` внутри раскладки сделок (`record_table_layouts`), то есть переезжает между браузерами вместе с колонками списка. Общий хук `useHorizontalResize`: во время движения пишем в DOM/локальное состояние, на сервер — один PUT на отпускании (как ресайз колонок таблицы). На мобильном хвата нет: полоса 6px пальцем не берётся и перехватывает начало горизонтального скролла доски. Тест схемы на бэкенде (границы диапазона) + `use-horizontal-resize.test.ts`
- [x] `M7.13.15` **Ресайз боковой панели.** Панель карточки контакта/компании (`RecordDetailShell`) и дровер сделки (`Sheet resizable`) тянутся за левый край, 360–800px, значение в `localStorage` (`getvoxly.sidePanel.width.v1`). Ширина — CSS-переменная `--side-panel-width` и класс `md:w-[var(--side-panel-width)]`: на телефоне остаётся `w-full`, иначе панель на 360px оказалась бы шире экрана
- [x] `M7.13.18` **Состав карточки канбана — все поля сделки.** Настройка «Внешний вид карточки» предлагала два поля из четырнадцати («Бюджет», «Описание») плюс «Компактно», которое меняло отступы, а не состав. Реестр `DEAL_CARD_FIELDS`: компания, контакт, бюджет, описание, ответственный, дата закрытия, этап, валюта, создана, обновлена, закрыта — каждое отдельным флажком, как выбор колонок в списке. «Компактно» убрано. `normalizeDealCardFields` дополняет сохранённую запись новыми полями кода: без этого поле, добавленное позже, осталось бы скрытым навсегда (`undefined` читался бы как «выключено»). Пустые значения не рендерятся — строка «Описание:» без текста занимала бы место молча. Тесты `deal-card-fields.test.ts` (6)
- [x] `M7.13.19` **Системные этапы воронки.** «Новый лид», «Успешно реализовано» и «Закрыто и не реализовано» защищены: нельзя переименовать, перекрасить, переместить и удалить. Раньше вход в воронку ничем не отличался от пользовательского этапа (удалялся и переименовывался, хотя на нём стоит попадание новой сделки), а у закрывающих защита была только на удаление — перестановка в середину доски разрешалась. Миграция `0028` добавляет `stages.is_system` и приводит существующие воронки к канону: цвета (вход `amber`, успех `emerald`, провал `rose`) и порядок (успех предпоследний, провал последний). Флаг, а не вычисление по `sort_order`: номер меняется перестановками, и «первый» разошёлся бы с входом после первого обмена. Новый этап вставляется **перед** закрывающими со сдвигом их `sort_order` — прежде он попадал после «Закрыто и не реализовано». Запреты на сервере (`updateStage`, `deleteStage`), в UI системный этап показан с замком и подписью «системный», стрелки соседей упираются в системные границы. Тесты `deal-kanban-system-stages.test.tsx` (5)
- [x] `M7.13.20` **Выравнивание шапок колонок канбана.** Высота шапки зависела от длины названия, а иконка `GripVertical` сжималась — колонки стояли на разной высоте, заголовки и счётчики «скакали». Фиксированная высота `h-[68px]` в обоих режимах (обычном и настройки), `shrink-0` у иконок и счётчика, `truncate` + `min-w-0` у названия, `tabular-nums` у числа сделок
- [x] `M7.13.17` **Корень «крупных шрифтов» на четырёх страницах CRM.** Первый проход (`M7.13.16`) убрал произвольные размеры, но разнобой остался: `body` не задавал размер вовсе, поэтому весь неразмеченный текст наследовал браузерные **16px**, тогда как заголовки колонок набраны `text-xs` (12px), а оболочка — `text-sm` (14px). Строки `RecordTable` (данные, «нет данных», итоговая) размер тоже не задавали — ячейки контактов, компаний, сделок и задач рендерились 16px рядом с 12px заголовком, что и читалось как «шрифт в карточках крупный, вёрстка косая». Фикс: базовый `text-sm` на `body` (у Twenty база тоже 13–14px, не 16px) плюс явный `text-sm` на трёх контейнерах строк. Тесты `record-table-typography.test.tsx` (3) падали до правки
- [x] `M7.13.16` **Единая шкала шрифтов.** **182** произвольных размера (`text-[9px]` ×6, `text-[10px]` ×71, `text-[11px]` ×104, `text-[13px]` ×1) сведены к шкале Tailwind, которой набран сайдбар: тело — `text-sm`, подписи и мета — `text-xs`. Причина «скачущих» шрифтов была именно в произвольных значениях: четыре разных размера мелкого текста на соседних элементах читались как разнобой. Первый проход пропустил `text-[9px]` (аватары, стрелки сортировки, бейдж чата бота) — поймано проверкой факта, а не памятью; итоговая проверка `grep "text-\[[0-9]*px\]"` даёт пусто. Своих семейств шрифтов в проекте нет — везде системный стек Tailwind, поэтому разнобой был только в размерах

### M7.11 — Таблица записей на мобильном
Этап 3 плана. Единственное место, где `useIsMobile` меняет поведение, а не классы, и
это оправдано: меняется состав обработчиков, а не геометрия, поэтому вспышка при
гидратации не видна.
- [x] `M7.11.1` **Чекбоксы выделения не рендерятся на мобильном.** Колонка занимает 28px из 360px, а массовые операции пальцем всё равно неудобны. Флаг `selectionEnabled` передаётся и в `useRecordTableLayout`, иначе слева осталась бы пустая полоса 28px в шаблоне грида — хуже, чем сами чекбоксы. Пробел на строке тоже перестаёт выделять: клавиатуры на телефоне для этого нет
- [x] `M7.11.2` Хваты ресайза не рендерятся: полоса 4px пальцем не берётся, зато перехватывает начало горизонтального скролла таблицы
- [x] `M7.11.3` Перетаскивание колонок отключено: удержание начинается тем же жестом, что и скролл доски — таблица либо не скроллится, либо не переставляет колонки
- [x] `M7.11.4` **Первая колонка схлопывается до 38px при `scrollLeft > 0`.** Она залипающая, и её 260px на 360px экране не оставляли места остальным. Замерено в браузере: полезная площадь под остальные колонки растёт с 66px (обрезок «Телефона») до 288px («Email» целиком плюс часть «Компании»). Переопределяется значение CSS-переменной ширины, а не шаблон грида — тем же путём, что и ресайз, поэтому браузер пересчитывает раскладку сам. Подпись заголовка убирается: в 38px не читается, а обрезанный текст выглядит как ошибка вёрстки; индикатор сортировки остаётся. Порог 0, а не запас: колонка возвращается ровно в начале прокрутки, промежуточное состояние выглядело бы подрагиванием
- [x] `M7.11.5` Меню колонок на мобильном разворачивается на всю ширину: `w-56` с `absolute right-2` на 360px прижимал его к краю. Проверено — меню 326px помещается целиком, ни одна подпись не обрезана
- [x] `M7.11.6` **Скелетон таблицы приведён к форме страницы** (`AGENTS.md` этого требует): `SkeletonTable rows={5} columns={6}` рисовал шесть полос по 50px там, где в таблицу влезает две. Колонки после второй скрыты классом `hidden md:block` — классами, а не хуком: при SSR хук дал бы вспышку шести колонок, то есть ровно то, от чего избавляемся
- [x] `M7.11.7` Тесты (`record-table-mobile.test.tsx` 17, `skeleton-table.test.tsx` 5): отсутствие чекбоксов, хватов и перетаскивания на мобильном и их наличие на десктопе, отсутствие пустой колонки в сетке, ширина меню, схлопывание и возврат первой колонки, скрытие подписи, сохранность скролла, залипания, сортировки и значений строк; в скелетоне — число полос, скрытие лишних, узкая первая колонка, роль для скринридера. Пять тестов падали до реализации
- [x] `M7.11.8` Проверено браузером на 360 / 767 / 768px: на 767px мобильный режим целиком, на 768px возвращаются чекбоксы (7), хваты (5), перетаскивание (4), скелетон 6 колонок и схлопывание не срабатывает. Горизонтального переполнения страницы нет ни на одной ширине
- [x] `M7.11.9` Своя ошибка в тесте по ходу: прокрутка задавалась через `dispatchEvent(new Event("scroll"))`, а React такое событие не подхватывает — обработчик не вызывался вовсе, и тест падал на верной реализации. Заменено на `fireEvent.scroll`. Проверено отдельным опытом: значение состояния после `dispatchEvent` остаётся нулевым
- [x] `M7.10.10` **Новый документ `docs/01_ARCHITECTURE/01_05_UI_CONVENTIONS.md`.** Правил вёрстки в `docs/` не было вовсе — единственные упоминания брейкпоинтов лежали в `CHANGELOG.md`, то есть в журнале. Зафиксированы: брейкпоинт 768px и запрос `max-width: 767px`, граница «структура на CSS — поведение на хуке» с объяснением про SSR, разделение `useIsMobile` / `useIsTouchDevice`, `useOverlay` как единственный способ блокировать прокрутку и обрабатывать Escape. Раздел Layout Rules в `AGENTS.md` и `.cursorrules` дополнен мобильным поведением сайдбара: он прямо противоречил плану, требуя `w-60` без оговорки про мобильный, где сайдбара нет вовсе
---

## Beyond — Bonus Features Implemented
- [x] `BONUS-1` Build analytics dashboard `/analytics` with Recharts (P&L chart, sales funnel, top-5 repairs, master workload)
- [x] `BONUS-2` Build finance invoices section `/finance` with balance cards and transaction management
- [x] `BONUS-3` Build invoice generator with repair/deal integration, VAT toggle, PDF print preview, send-to-chat
- [x] `BONUS-4` Build onboarding wizard (4-step) with business domain auto-configuration

---

## Summary — Task Count

> Пересчитано скриптом 2026-08-24 (после блока базы знаний) по фактическим
> отметкам в этом файле.
>
> Счёт ведётся **по идентификатору задачи** (`M7.5.16` → M7), а не по
> заголовку раздела: блок `M7.5` физически расположен внутри «Milestone 0», и
> подсчёт по заголовкам относил его к M0. Прежняя таблица была датирована
> 2026-08-20 и разошлась с файлом на 76 задач — она считала 325 при 401
> фактических.
>
> `[x]` в milestone-ах M1–M4 означает «UI-компонент реализован», а не
> «работает end-to-end»: подключение frontend к готовому API идёт в M7.
> Контакты, Компании, Kanban Сделок, таймлайн Сделок и Задачи используют
> real API; pipeline seed, users catalog и мок-контекст закрыты; остаток M7 —
> создание Сделок, relation panels, Repairs/Finance/Marketplace/Admin.

| Milestone | Phase | Total | Done | Partial | Remaining | Cancelled |
|---|---|---|---|---|---|---|
| M0 | Project Scaffold | 155 | 116 | 7 | 32 | 0 |
| M1 | Core CRM | 56 | 43 | 1 | 12 | 0 |
| M2 | Service Center | 20 | 13 | 1 | 6 | 0 |
| M3 | Finance | 29 | 22 | 1 | 6 | 0 |
| M4 | AI Bots | 36 | 28 | 0 | 8 | 0 |
| M5 | SaaS Admin | 25 | 10 | 0 | 15 | 0 |
| M6 | Polish & Production | 37 | 10 | 5 | 20 | 2 |
| M7 | Frontend ↔ Backend Wiring | 51 | 32 | 3 | 16 | 0 |
| Bonus | Extra features | 4 | 4 | 0 | 0 | 0 |
| **Total** | | **413** | **278** | **18** | **115** | **2** |

---

## Ближайшее — карточки и таблицы записей (2026-08-25)

`M7.5.1`–`M7.5.10` проверены на проде (миграция `0019` применена, заметки
проходят полный цикл). `M7.5.12`, `M7.5.14`–`M7.5.17` проверены локально в
браузере на реальных страницах CRM с локальным бэкендом и БД.

Осталось:

1. `M7.5.11` — задеплоить накопленное. **Заблокировано:** VPS не принимает SSH
   (`kex_exchange_identification: Connection closed`), сайт при этом отвечает
   `200`. Снятие бана — через VNC-консоль провайдера
   (`fail2ban-client set sshd unbanip <IP>`), см. `05_01_SERVER_ACCESS.md` §6.
2. `M7.5.13` и `M7.5.18` — общие порталы ячеек и серверное хранение раскладки.
   Оба отложены осознанно: первое не даёт выигрыша на странице из 25 записей,
   второе требует серверной сущности представления.

Для локальной проверки есть `backend/scripts/seed-local.mjs`: создаёт арендатора,
пользователя `local@test.dev` / `LocalDev12345`, компании, контакты, воронку со
стадиями и сделки.

---

## Next to Execute — по состоянию на 2026-08-24

> Блок сверен с кодовой базой, а не с памятью: каждый пункт ниже проверен
> наличием файла или строки в коде.
>
> Приоритеты 1 и 2 прежней версии закрыты в этой итерации: появились
> интеграционные тесты (`M6.3.3`, 72 теста), очистка просроченных строк
> (`M0.8.12`) и исправлены четыре дефекта авторизации (`M0.12.6`–`M0.12.8`,
> `M0.12.11`) плюс `M0.13.15`. Тесты попутно вскрыли `M0.12.15` — счётчик попыток
> кода не работал вовсе, потому что «штрафные» записи откатывались вместе с
> исключением из тела транзакции.

**Что развёрнуто и работает на проде** (`getvoxly.ru`, `app.getvoxly.ru`,
`api.getvoxly.ru`, три контейнера `healthy`):

- Вход по паролю + код второго фактора через **Telegram и MAX**, привязка бота
  по deep-link, восстановление пароля по ссылке из письма.
- Личный профиль: данные, аватар, смена пароля, привязка и отвязка каналов.
- Сотрудники: приглашения, роли, мягкое удаление, лимит мест 10 + 200 ₽.
- Тариф и детализация счёта; маркетплейс модулей с per-seat и per-unit тарифами.
- CRM (контакты, компании, сделки, задачи), Ремонты, Финансы — на реальном API.
- RLS через `FORCE` + непривилегированную роль `app_user`.

> Изменения этой итерации на прод **не выкладывались**: проверка выполнена
> локально (72 теста на БД с RLS под `app_user`, плюс браузерная проверка потока
> входа на Next dev + Fastify + PostgreSQL). Деплой — отдельным шагом.

### Приоритет 1 — инженерная гигиена
> `M6.2.7` (инструмент миграций) закрыт 2026-08-23. `M6.3.3` и `M0.8.12` закрыты
> 2026-08-24.
1. `M6.3.3` **Расширить тесты на остальные домены.** Закрыт auth-контур,
   приглашения, RLS и гейты модулей; CRM, Ремонты, Финансы, AI и профиль пока без
   тестов. Инфраструктура готова (`src/tests/helpers/`), добавление файла стоит
   недорого.
2. `M6.3.8` **Прогон тестов в CI.** Сейчас `npm test` запускается вручную;
   без CI ценность тестов держится на дисциплине.
3. `M6.2.11` **Секции откатa** для новых миграций: `migrate:down` у `0001`–`0009`
   отвечает `User has disabled down migration on file`, то есть откат
   существующих возможен только из дампа.

### Приоритет 2 — остаток дефектов авторизации (findings code review)
4. `M0.12.9` Ошибки `403 TENANT_INACTIVE` и `409 CODE_NOT_DELIVERED` показываются
   на поле кода — пользователь переввводит код при проблеме, которую код не
   решает.
5. `M0.12.10` `awaiting_bot` может стать тупиком: таймаут опроса (5 мин) не
   превышает TTL кода, а сброса состояния в ветке таймаута нет; смена канала в
   процессе не сбрасывает поток.
6. `M0.8.13` Сделать второй фактор обязательным: `POST /auth/login` без кода
   остаётся открытым для обратной совместимости.

### Приоритет 3 — оплата подписки (M5.2)
7. `M5.2.7` Таблицы `plans` / `subscriptions` / `payments` — сейчас цены планов
   живут в коде (`PLAN_PRICES` в `admin-platform.routes.ts`).
8. `M5.2.6` Подключить платёжного провайдера. Проверено: ни одного упоминания
   ЮKassa/Тинькофф/Stripe в `backend/`. `/settings/billing` показывает честное
   «оплата не подключена», но списаний нет.
9. `M0.11.9` Ограничение доступа по окончании пробного периода — следствие
   пункта 8.

### Приоритет 4 — AI Bots backend (M4.2)
> Сделаны: хранение агентов, баланс и наценка (`0014`); база знаний на pgvector
> (`0015`); абстракции провайдеров эмбеддингов и чата; **транспорт Telegram с
> дебаунсом, мульти-отправкой и списанием** (`M7.5.16`, `M4.2.18`, `M4.2.19`,
> `M4.2.8`).
>
> Блокирует проверку на живом диалоге: ключ шлюза упёрся в лимит OpenRouter — все
> 13 моделей эмбеддингов отдают `403`, chat работает только через `auto/*`. Код
> изменений для этого не требует.
10. `M4.2.4` `POST /ai/agents/:id/chat` как SSE + `streamChat` в существующей
    абстракции провайдера, затем перевод `use-bot-chat.ts` на `EventSource`.
    Пробный чат в интерфейсе всё ещё работает на локальной имитации потока.
11. `M4.2.7` Подстановка контекстных переменных (`{{contact}}`, `{{deal}}`) из БД
    в момент вызова: сейчас в промпт идут только фрагменты базы знаний.
12. `M4.2.20` Блокировка на одного слушателя при масштабировании бэкенда — сейчас
    транспорт поднимается в каждом процессе.
13. `M4.2.21` Распознавание голосовых и изображений: медиа без подписи
    игнорируется.

### Приоритет 5 — каналы связи и омниканальность (M7.5)
> Telegram работает полностью: авторизация аккаунта через MTProto (`M7.5.3`,
> `M7.5.4`), приём входящих и отправка от имени аккаунта (`M7.5.16`).
14. `M7.5.2` Омниканальный Inbox `/inbox`: единая лента сообщений из всех
    подключённых каналов со связью с контактом и сделкой. Сейчас входящие
    обрабатываются агентом, но **нигде не сохраняются** — оператор не видит
    переписку в CRM.
15. `M7.5.17` Транспорт остальных четырёх каналов — там подключение всё ещё
    создаёт запись без реального соединения.

### Приоритет 6 — прочее
17. `M0.6.5` `@fastify/cookie` и httpOnly-cookie для токенов. Проверено: пакета в
    зависимостях нет, токен лежит в localStorage и в JS-читаемой cookie — это
    задокументированный компромисс, а не недосмотр (см. `session.ts`).
18. `M0.14.5` Воркер окончательной очистки данных отключённых модулей после
    `purge_after`. Расписание для этого теперь есть
    (`services/auth-maintenance.service.ts`), но сама выгрузка помеченных строк не
    написана.
19. `M0.13.13` Вывод ссылки приглашения в интерфейсе, когда SMTP не настроен.
20. `M0.13.18` Смена собственного e-mail с подтверждением нового адреса.
21. `M0.13.19` Перенос аватаров в объектное хранилище: Base64 в TEXT работает, но
    возвращается в каждом ответе профиля и не кэшируется браузером отдельно.
