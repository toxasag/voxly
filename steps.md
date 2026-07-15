# Voxly — Журнал прогресса

> **Этот файл — единый источник правды о состоянии проекта.**
> В каждом новом чате читай его первым, чтобы не пересканировать кодовую базу и не тратить токены.
> После значимых изменений обновляй раздел «Текущее состояние» и чек-лист фаз.

---

## 0. О проекте

**Voxly** — SaaS CRM-платформа на базе Twenty CRM (self-hosted, multi-workspace) с Telegram-ботами, AI-агентами, реферальной программой и сквозной аналитикой.

- **Домен:** `getvoxly.ru`
- **Репозиторий:** `/Users/antonsagajdak/Desktop/CRM-PLUS`
- **Лицензия:** UNLICENSED (proprietary)
- **Менеджер пакетов:** pnpm 9.12.0 + Turborepo (monorepo)
- **Node:** >=20

### Архитектура маршрутизации

```
getvoxly.ru              → Лендинг + супер-админка
{slug}.getvoxly.ru       → Клиентский портал (биллинг, боты, рефералы)
{slug}-crm.getvoxly.ru   → Twenty CRM workspace клиента
api.getvoxly.ru          → Control plane API (Fastify)
```

### Структура монорепо

```
apps/
  saas-api/              Control plane (Fastify + Prisma + Robokassa)
  saas-portal/           Лендинг + порталы + супер-админ (Next.js, multi-host)
  manager-bot-service/   Telegram Managed Bots provisioning
  gift-bot-worker/       Воронки, проверка подписки, рассылки (Phase 2)
  ai-telegram-worker/    AI-агент Telegram (Phase 3)
  ai-whatsapp-worker/    AI-агент WhatsApp (Phase 4)
packages/
  shared/                Константы, типы, pricing
  db/                    Prisma schema + client (control plane DB)
  billing/               Robokassa client + расчёт цен
  twenty-client/         GraphQL-клиент Twenty CRM
  ai-core/               AI wallet, markup, usage logging
  analytics-dispatchers/ Метрика/GA4/FB CAPI/VK Pixel S2S
  crypto/                AES-256-GCM шифрование секретов
twenty-app/voxly-platform/  Twenty App (BotSubscriber, Conversation, ChatMessage, GiftCampaign, Broadcast)
docker/                  docker-compose.yml + Traefik config
graphify-out/            Knowledge graph (не коммитить)
docs/ARCHITECTURE.md     Полная архитектурная документация
```

---

## 1. Стек технологий

| Слой | Технология |
|---|---|
| CRM | Twenty CRM (self-hosted, multi-workspace) |
| Control Plane | Node.js + Fastify + Prisma + PostgreSQL |
| Portal | Next.js (app router, multi-host middleware) |
| Очереди | BullMQ + Redis |
| Платежи | Robokassa (54-ФЗ фискализация) |
| Telegram | Managed Bots API (Bot API 9.6+) |
| AI | OpenAI + per-tenant wallet + 50% markup |
| Аналитика | Yandex Metrika / GA4 / Facebook CAPI / VK Pixel (S2S) |
| Reverse proxy | Traefik v3 (wildcard SSL) |
| БД | 2× PostgreSQL (control + twenty) |
| Шифрование | AES-256-GCM (@voxly/crypto, ключ ENCRYPTION_KEY) |
| Тесты | vitest |
| Knowledge graph | Graphify (AST-based, обновляется инкрементально) |
| Доки библиотек | Context7 MCP (актуальные API-сигнатуры) |

---

## 2. Тарификация

| Продукт | Цена |
|---|---|
| CRM (подписка) | 500 ₽/мес, скидки за 3/6/12/24 мес |
| Доп. пользователь | 300 ₽/мес (в базе 10 юзеров) |
| Gift-бот | 500 ₽/мес за канал |
| AI-агент Telegram | 1000 ₽/мес до 10 аккаунтов + AI-usage с markup |
| AI-агент WhatsApp | 1000 ₽/мес за номер + AI-usage с markup |
| Сквозная аналитика | 500 ₽/мес за платформу (Метрика/GA4/FB/VK) |
| AI markup | по умолчанию 50%, настраивается супер-админом + per-tenant |

---

## 3. История разработки (timeline)

### День 1 (14 июл 2026) — каркас и инфраструктура
- Скоординирована архитектура SaaS поверх Twenty CRM.
- Согласовано название **Voxly**, домен **getvoxly.ru**.
- Создан monorepo (pnpm + Turborepo): root package.json, turbo.json, tsconfig.base.json, pnpm-workspace.yaml, .env.example, .gitignore.
- Docker Compose: Traefik (wildcard SSL), 2× PostgreSQL, Redis, Twenty CRM (multi-workspace), все worker-сервисы.
- Shared-пакеты: `shared`, `db` (Prisma schema со всеми моделями), `billing` (Robokassa), `twenty-client` (GraphQL), `ai-core`, `analytics-dispatchers`.
- `saas-api` (Fastify): routes (auth, billing, tenant, admin, referral, bots, analytics), BullMQ provisioning, scheduler.
- `saas-portal` (Next.js): multi-tenant middleware, лендинг, register/login, client dashboard, супер-админка.
- `manager-bot-service`: Managed Bots provisioning (`getManagedBotToken`, `ManagedBotUpdated`).
- Twenty App `voxly-platform`: объекты BotSubscriber, Conversation, ChatMessage, GiftCampaign, Broadcast + webhooks.
- `gift-bot-worker`: воронка, проверка подписки, сбор телефона, выдача подарка, CRM-sync, fireGoal.
- AI-воркеры: `ai-telegram-worker` (Business API, OpenAI, handoff), `ai-whatsapp-worker` (Cloud API, переиспользует ai-core).
- Документация: `docs/ARCHITECTURE.md`.

### День 1 (позже) — финальная полировка и сборка
- `pnpm install && typecheck && build && test` доведены до зелёного.
- Typecheck 18/18 → 20/20, build 12/12 → 13/13, test 20/20.
- Все 6 Dockerfile'ов переписаны под pnpm-монорепо (build context = корень, multi-stage slim runtime, корректные build-контексты в docker-compose).
- Prisma-схема валидирована (`prisma generate`); исправлены `aiUsageLog` back-relation и compound unique key.
- Добавлены тесты на vitest: billing (Robokassa signatures + расчёт цен), ai-core (markup), shared (экспорты).
- Graphify knowledge graph построен и подключён через `.cursor/rules/graphify.mdc`.

### День 1 (ещё позже) — шифрование
- Создан shared-пакет `@voxly/crypto` (AES-256-GCM, `node:crypto`).
- Заменены 5 плейсхолдеров (base64/JSON-заглушки) на настоящее шифрование:
  - `manager-bot-service` → `encrypt()` для токенов Managed Bots
  - `gift-bot-worker` → `decrypt()` для токенов ботов
  - `ai-telegram-worker` → `decrypt()`
  - `ai-whatsapp-worker` → `decrypt()`
  - `analytics-dispatchers` → `encryptJSON()`/`decryptJSON()` для credentials
- 8 тестов crypto (round-trip, tampering detection, wrong key, config errors).
- 6 Dockerfile'ов обновлены (`COPY packages/crypto/package.json`).

### День 2 (15 июл 2026) — инструменты разработки
- Установлен Context7 MCP (`.cursor/mcp.json`) — актуальные доки библиотек.
- Создан этот файл `steps.md` + Cursor-правило для авто-загрузки состояния.

---

## 4. Текущее состояние

### Пайплайн (всё зелёное)
- `pnpm install` ✓
- `pnpm typecheck` — 20/20 ✓
- `pnpm build` — 13/13 ✓
- `pnpm test` — 28/28 ✓ (billing 11, ai-core 5, shared 4, crypto 8)
- `pnpm --filter @voxly/db prisma:generate` ✓

### Чек-лист фаз

| ID | Фаза | Статус |
|---|---|---|
| phase1-infra | Docker Compose + Traefik + PostgreSQL + Redis | ✅ DONE |
| phase1-control | Control plane: Prisma, auth, Robokassa, provisioning | ✅ DONE |
| phase1-portal | Клиентский портал + супер-админка | ✅ DONE |
| phase1-referral | Реферальная программа (коды, атрибуция, вознаграждения) | ✅ DONE |
| phase1-manager-bot | Telegram Manager Bot (Managed Bots) | ✅ DONE |
| phase1-twenty-app | Twenty App voxly-platform (объекты) | ✅ DONE |
| phase2-gift-bot | gift-bot-worker (воронка, подписка, рассылки) | ✅ DONE |
| phase2-analytics | Сквозная аналитика (Метрика/GA4/FB/VK) | ✅ DONE |
| phase2-gramjs | GramJS bridge (личный аккаунт, опционально) | ⬜ PENDING |
| phase3-ai-telegram | ai-telegram-worker (Business API, OpenAI, wallet) | ✅ DONE |
| phase4-ai-whatsapp | ai-whatsapp-worker (Cloud API, ai-core) | ✅ DONE |
| final-polish | Dockerfiles, тесты, сборка | ✅ DONE |
| encryption | AES-256-GCM для секретов | ✅ DONE |

**Закрыто: 11/12 фаз.** Осталась 1 опциональная (GramJS bridge).

---

## 5. Что осталось сделать

### Опциональное
- **Phase 2b: GramJS bridge** — переписка с личного Telegram-аккаунта пользователя (не через Bot API). Опциональная фича.

### Известные TODO-заглушки (не блокируют сборку, нужны перед продом)
- `emailWorker` в `saas-api` — сейчас logging-stub, нужна реальная SMTP-отправка (nodemailer, настройки в .env.example).
- `notifyHumanOperator` в AI-воркерах — не реализован (уведомление оператору при handoff).
- `generateSecret` в `manager-bot-service` — использует `Math.random`, можно заменить на `@voxly/crypto` `generateSecret()`.
- **Prisma migrations** — `prisma generate` работает, но миграции не созданы (нужны перед первым деплоем: `pnpm db:migrate`).
- **Docker runtime-верификация** — Dockerfile'ы корректны по паттерну, но не собирались/не запускались (нет Docker-демона в среде разработки).

### Перед продакшеном
- Заполнить `.env` реальными кредами (Robokassa, Telegram Manager Bot, OpenAI, SMTP, ENCRYPTION_KEY через `openssl rand -hex 32`).
- Купить домен `getvoxly.ru`, настроить wildcard DNS → сервер.
- Получить `TELEGRAM_MANAGER_BOT_TOKEN` через @BotFather, включить Bot Management Mode.
- Настроить Twenty CRM (`twentycrm/twenty` образ, `IS_MULTIWORKSPACE_ENABLED=true`).
- Запустить `docker compose up -d` из `docker/`.

---

## 6. Команды разработки

```bash
# Установка
pnpm install

# Разработка
pnpm dev                              # все сервисы через turbo
pnpm --filter @voxly/saas-api dev     # отдельный сервис

# Сборка и проверки
pnpm typecheck                        # 20/20
pnpm build                            # 13/13
pnpm test                             # 28/28

# БД
pnpm db:generate                      # prisma generate
pnpm db:migrate                       # prisma migrate (создать миграции)
pnpm db:push                          # prisma db push
pnpm db:studio                        # prisma studio

# Инфраструктура
cd docker && docker compose up -d     # поднять всё

# Knowledge graph (Graphify)
source $HOME/.local/bin/env && graphify . --code-only --update   # перестроить граф
source $HOME/.local/bin/env && graphify query "<вопрос>"         # запрос к графу
```

---

## 7. Ключевые архитектурные решения

1. **Разделение control plane и CRM** — `saas-api` (биллинг, auth, provisioning) отдельно от Twenty CRM; общаются через GraphQL (`@voxly/twenty-client`).
2. **Две PostgreSQL** — изоляция control-данных от данных Twenty CRM.
3. **Traefik wildcard** — `{slug}-crm.getvoxly.ru` → Twenty workspace, `{slug}.getvoxly.ru` → клиентский портал.
4. **Managed Bots** — клиенты не трогают API-токены; `manager-bot-service` получает токены через Telegram Bot API 9.6+.
5. **AI wallet + markup** — per-tenant баланс AI-токенов, 50% markup по умолчанию, per-tenant override в супер-админке.
6. **Сквозная аналитика как add-on** — 500 ₽/мес за платформу, server-side offline conversions (как tgtrack.ru).
7. **AES-256-GCM** — единый `ENCRYPTION_KEY` для всех секретов at rest (токены ботов, credentials аналитики), auth-tag защищает от подделки.
8. **Webhook idempotency** — критично для Robokassa (повторные webhook'и не должны активировать подписку дважды).

---

## 8. Инструменты памяти (как я помню контекст между чатами)

Чтобы не тратить токены на пересканирование кодовой базы, используется каскад:

1. **`steps.md` (этот файл)** — состояние проекта, история, чек-лист фаз. Читается первым в каждом новом чате (правило `.cursor/rules/project-state.mdc`).
2. **Graphify knowledge graph** (`graphify-out/`) — AST-граф кодовой базы. Перед исследованием кода: `graphify query/path/explain` вместо чтения сырых файлов (~71× меньше токенов на запрос). Правило `.cursor/rules/graphify.mdc` обязывает использовать граф первым.
3. **Cursor Rules** (`.cursor/rules/*.mdc`) — постоянные инструкции, грузятся в каждый чат автоматически (graphify, project-state).
4. **Context7 MCP** — актуальные доки библиотек по запросу, чтобы не опираться на устаревшие тренировочные данные.
5. **`docs/ARCHITECTURE.md`** — полная архитектурная документация для глубокого погружения.
6. **Agent transcripts** — прошлые чаты в JSONL (для цитирования, не для линейного чтения).

> **Правило обновления:** после значимых изменений (новая фаза, фикс, смена архитектуры) обновляй раздел 4 «Текущее состояние» и чек-лист фаз, затем запускай `graphify . --code-only --update` для синхронизации графа.
