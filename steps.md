# Voxly — Журнал прогресса

> **Этот файл — журнал прогресса и снимок сессии (§4).**
> Перед ним агенты читают `docs/agent/README.md` → `CAPABILITIES.md` (что уже есть), затем §4 здесь.
> После значимых изменений: WORKLOG + при необходимости CAPABILITIES/INCIDENTS; обновляй §3–§5.

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
docs/agent/              Lean-память агентов (capabilities, worklog, incidents)
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

- **2026-07-31** — **Prod:** INC-079 fix — scheduler crash protection (`safeJob` wrapper for all timer jobs) + `prisma migrate deploy` автоматически в `prod-deploy.sh` до пересоздания контейнеров; backup `20260731-154611`; prisma «No pending migrations to apply»; container restarts=0; smoke portal/API/partners/ai **200**.
- **2026-07-31** — **Prod:** супер-админ `/admin/partners` (партнёры, индивидуальные правила вознаграждения, ручные выплаты `ReferralTransaction`, блокировка) + `/api/admin/referrals`; уникальность реферальных кодов (409 + `code-available`); миграция `20260731140000_referral_admin` (аддитивная: `ReferralRule.tenantId`, `ReferralTransaction`, enum `ReferralTxKind`) применена через `prisma migrate deploy` в `docker-saas-api-1`; backup `20260731-131927`; smoke портал/API/`/admin/partners` **200**, `GET /api/admin/referrals` без токена **401**.
- **2026-07-30** — CRM portal defaults for all tenants: `/dashboard/crm`, invite+credentials, hard lock ADR-023, shell-ux «CRM · slug»+«Вы:», chat operator names, crm-chat **0.1.23**; provision installs latest chat + skip install-apps (owner+invite).
- **2026-07-30** — INC-072: sidebar «john» = workspace (shell-ux «CRM · john» + «Вы: …»); Chat author from Twenty member (not «Менеджер»); crm-chat **0.1.23** on prod.
- **2026-07-29** — Лендинг getvoxly.ru пересобран по AIDA: official mascot Voxly, industrial-tech art direction, Unbounded+Manrope, story-first вместо comparison-table-first, mobile sticky CTA; portal build green.
- **2026-07-27** — ServiceApp UI Design System: созданы `serviceapp_design_system.json` и `serviceapp_design_system.md` (в корень и в `design-system/voxly/`), обновлен `MASTER.md`.
- **2026-07-27** — Local: mailing UX **0.1.21** composer+preview+history+delete; accounts CRM/gift/read filters; stage multi-channel; BroadcastRecipient migrate pending deploy.
- **2026-07-27** — Prod: «Рассылка» FOLDER live — migrate `MailingStageRule`; refresh john/lexx/antontest/antontest3; john nav = FOLDER + 4 PAGE_LAYOUT; tarball **0.1.20**.
- **2026-07-27** — INC-070: CRM side-panel «Чат» tab missing — voxly-crm-chat uninstalled after ENOSPC/partial refresh; refresh-crm-chat all tenants + Redis flatLayout flush; metadata confirms Chat @15.
- **2026-07-27** — INC-069: CRM Chat empty — missing `deliveryStatus` migration on prod (mailing receipts); applied; WA/TG refusal retry + near-dupe skip; deploy workers; backups `20260726-220746` + `20260726-221209`.
- **2026-07-27** — INC-068: WA/TG sync CRM before ASR (personal voice after wipe); deploy `ai-whatsapp-worker,ai-telegram-worker`; **rotate root SSH password**.
- **2026-07-27** — INC-067: WA video ASR used by LLM; PDF/DOCX CRM signed URL (0.1.20); typing clear; personal WA stale link cleared; deploy `saas-api,ai-tg/wa`; backup `20260726-210924`; **rotate root SSH password**.
- **2026-07-26** — Media parity E2E: Business = GramJS = WA = Gift CRM enrich (ADR-021); gift `video_note` + OpenRouter/ffmpeg; docs + deploy workers/`gift-bot-worker`/`saas-api`/compose; **rotate root SSH password**.
- **2026-07-26** — Local: crm-chat **0.1.18** FOLDER «Рассылка» → Бот / Аккаунты / Сторис / По этапу сделки; stage rules API; no prod deploy.
- **2026-07-26** — Prod ship: crm-chat **0.1.17** in-CRM «Рассылка» (`saas-api`); backup `20260726-202005`; refresh john/lexx/antontest/antontest3; john nav = PAGE_LAYOUT.
- **2026-07-26** — ADR-018 amend: «Рассылка» = in-CRM STANDALONE_PAGE + front-component (crm-chat 0.1.17); portal LINKs removed. No prod deploy.
- **2026-07-26** — Prod: «Рассылка» (`saas-api,saas-portal,gift-bot-worker,gramjs-bridge,ai-tg/wa,compose`); CRM LINKs absolute → `getvoxly.ru/dashboard/mailing/*`; refresh-crm-chat; backup `20260726-192410`; hub+4 routes **200**.
- **2026-07-26** — Prod deploy `saas-portal` (legal `/terms|/privacy|/consent|/refund` + реквизиты); backup `20260726-190018`; smoke 200. Conflict recreate saas-api fixed; AI workers restarted.
- **2026-07-26** — Portal **indigo shadcn** theme + dashboard big-bang (branch `ui/indigo-shadcn-dashboard`; ADR-020; **prod** backup `20260726-200859`; PR link pending `gh auth`).
- **2026-07-26** — Portal shadcn expand: landing Table/Accordion; AppShell Sheet; register Checkbox; typecheck+build OK (deploy portal pending).
- **2026-07-26** — Robokassa legal surface: `/terms|/privacy|/consent|/refund` + реквизиты ИП на лендинге + checkbox на `/register` (local; deploy portal pending).
- **2026-07-26** — INC-063: regular video ASR (TG/GramJS/WA) — tags `[видео]:`; caps 8MB/90s; deploy workers+gramjs-bridge.
- **2026-07-26** — INC-063 reopen: Fastify media token `maxParamLength` 404 + video_note AI tagging/fallback — CRM Chat **0.1.15**; deploy `saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`; backup `20260726-192410`; refresh-crm-chat; media 206 video/mp4 verified.
- **2026-07-26** — Prod: INC-063 media playback MIME sniff/Range + video_note ASR — CRM Chat **0.1.13** (`saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`); backup `20260726-185249`; refresh-crm-chat; smoke 200.
- **2026-07-26** — Prod: media signed-url CRM chat **0.1.11** + unread badges (`saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`); migrate `lastOperatorReadAt`; backup `20260726-182032`; smoke 200.
- **2026-07-26** — INC-065 unread badges UX + media 0.1.13 workers shipped prod (`saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`); backup `20260726-190111`.
- **2026-07-26** — Prod: INC-063 media + INC-064 prompt filter → `saas-api` (crm-chat 0.1.9), `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge`; backup `20260726-022902`; smoke 200.

### 2026-07-26 — INC-059 WA LID→PN (Evolution v2.3.7-lid shipped)
- WA UI can show phone without address book; avatar invent OFF. Prod Evolution upgraded to **v2.3.7-lid** (backup `20260726-002454`); session restored without QR; webhook + `PRESENCE_UPDATE` re-applied. Next: confirm LID inbound fills Person via `remoteJidAlt`/`senderPn`.

### 2026-07-24 — INC-050 CRM chat links + gift 1.2/1.3
- Chat: clickable http(s) in «Чат»; no `nbsp;` garbage (app **0.1.3** on john).
- Gift setup: **1.2** Telegram description / **1.3** /start funnel (code; gift deploy still pending).

### 2026-07-24 — INC-042 WA CRM sync after wipe
- Stale Conversation twenty ids after deleting all People/Opps → sync skipped; toast without valid Chat.
- Fix: personExists/opportunityExists → clear+recreate; sync every inbound; toast no-nav without ids.

### 2026-07-24 — INC-044 TG↔WA Person merge by phone
- `findPersonByPhone` in twenty-client; GramJS passes `User.phone`; TG/WA sync merge before create; ambiguous → needsReview. Deploy `ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`.

### 2026-07-24 — INC-043 WA phones empty on LID-only webhook
- Evolution Contact book resolve (profilePic / unique pushName) → Person phones + whatsapp; backfill john → `+79150946944`; composer placeholder channel-aware (crm-chat 0.1.2). Deploy `ai-whatsapp-worker,saas-api`; backup `20260724-121355`.

### 2026-07-24 — INC-041 inbound toasts silent (sed guard)
- Dockerfile sed made shell-ux toast poll always return; fix apiUrlReady + `/s/crm-chat/inbound-toasts` via Twenty session (no portal hop). Deploy twenty + saas-api; re-ensure john chat app.

### 2026-07-24 — CRM toast / social / cabinet / kanban notes
- Left inbound toast (shell-ux poll); Person social fields + WA→whatsapp; cabinet dedupe; note body on kanban via title sync.
- Deploy: `saas-api,ai-whatsapp-worker,twenty` + SQL backfill john.

### 2026-07-24 — INC-039 WA media + LID name/phone + typing
- CRM media reply for WA via Evolution `sendMedia`; presence/read on open/reply; Person phone from `remoteJidAlt`/`senderPn`; no LID in Twenty name (INC-039). Deploy `saas-api,ai-whatsapp-worker`.

### 2026-07-24 — INC-038 WA CRM reply 400 (@lid)
- Evolution + worker: LID peers send as `digits@lid`; Evolution image patched (all tsup chunks).
- Verify: reply for opportunity `1a0beec2-…` → **200**.

### 2026-07-23 — INC-037 WA inbound → CRM Chat
- Webhook/ChatMessage OK; `createPerson(phone=WA lid)` crashed worker → no Person link.
- Fix createPerson phone fallback + WA sync try/catch; CRM `threads[]` switcher; deploy saas-api+WA worker; backup `20260723-163144`; backfill john WA Persons.

### 2026-07-23 — INC-032 CRM Chat GramJS reply
- Root cause: saas-api looked only at GiftSubscriber; GramJS CRM ids on Conversation → `/reply` 404. Host `/s/crm-chat` was correct.
- Fix + prod deploy `saas-api,gramjs-bridge` (backup `20260723-132306`).

### 2026-07-25 — Billing close + admin health
- Business: capacity + unlink + `ai_tg_extra_conn` 200₽/slot; GramJS/WA hard pay + QR 402; `ai_topup`; usage-by-agent; referral 20% excl. top-up; `GET /api/admin/health`.
- Portal wired; shared tests green. Prod migrate+deploy pending.

### 2026-07-23 — WhatsApp QR INC-035 (prod)
- Evolution `CONFIG_SESSION_PHONE_VERSION` bump → QR base64 returns; Cyrillic name → ascii hash slug.
- Deploy worker/portal/compose; recreate evolution-api (no volume wipe). Backup `20260723-160032`.

### 2026-07-23 — GramJS bridge up on prod
- `prod-deploy.sh gramjs-bridge`; backup `20260723-130943`.
- Fixed prod `GRAMJS_BRIDGE_URL` `:3010` → `:3008`; recreated saas-api; bridge `/health` ok.

### 2026-07-23 — Business AI prod deploy
- SSH unblocked via session `SSHPASS` (no laptop SSH key).
- `prod-deploy.sh` shipped saas-api/portal/ai-telegram/gift/manager + compose; backup `20260723-122938`.
- Prod `.env` append: `TELEGRAM_API_ID/HASH`, `GRAMJS_BRIDGE_URL` (no `--profile gramjs`).
- Control DB Conversation AI/CRM columns applied; smoke portal+API **200**.

### 2026-07-23 — Portal GramJS QR + soft gaps
- Portal `/dashboard/ai/gramjs`: QR start/poll/png/2FA; accounts list; soft trial.
- saas-api proxy `/api/bots/gramjs/*` (JWT → bridge Bearer); human outbound 1h pause in bridge.
- Local `.env` secrets wired (gitignored); later prod ship succeeded (see above).
- `prod-deploy.sh` gained `ai-telegram-worker` / `gramjs-bridge`.

### 2026-07-23 — AI Agents media + gramjs-bridge
- `ai-telegram-worker`: Whisper ASR (OpenRouter STT) + vision (multimodal chat); placeholders on failure; `/internal/inbound` for GramJS.
- NEW `apps/gramjs-bridge`: QR login, encrypted session on `BotInstance` (`ai_gramjs`), text → AI worker → MTProto send.
- Shared: `PRODUCT_CODES.AI_GRAMJS` / 500₽; compose profile `gramjs` :3008.

### 2026-07-23 — AI Agents portal + CRM leads + SKU
- Portal `/dashboard/ai` (+ `[botId]`): provision `ai_tg`, dialogs, handoff вкл/выкл/пауза.
- API: `ai/start-trial`, conversations list/messages, addon gate on provision, `needsReview` PATCH.
- Worker: Twenty Person+Opportunity on inbound; ambiguous dedupe → `needsReview`; ≤10 Business connections.
- Schema: Conversation CRM ids + `needsReview` migration.

### 2026-07-23 — AI Agents Phase 1 foundation
- Schema Conversation handoff/Business fields + migration; OpenRouter seed defaults.
- Adapted `ai-telegram-worker` (`ai_tg`, Business updates, multi-bubble, pause/disable).
- gift-bot forwards `ai_tg` webhooks; manager registers Business `allowed_updates`.
- PATCH conversation controls; CRM/portal reply auto-pause 1h.

### 2026-07-23 — AI-агент ТЗ v0.2
- `docs/specs/AI-AGENTS-TZ.md`: Telegram Business + GramJS + WA (Evolution); reuse-first (адапт существующих AI workers); имитация человека из n8n; managed bot; медиа в MVP.

### 2026-07-23 — AI Agents TZ v0.3
- `docs/specs/AI-AGENTS-TZ.md` готов к старту Фазы 1 (reuse `ai-telegram-worker` + новый gramjs-bridge). Код не начат — ждём «гоу».

### 2026-07-22 — Safe prod deploy path
- `scripts/prod-deploy.sh` / `prod-diff.sh` + `docs/agent/DEPLOY.md` + `ENVIRONMENTS.md` (ADR-013): whitelist rsync, DB backup, no `-v`, smoke. Live diff: portal OK; api/chat-panel/twenty-client still drift until intentional `saas-api` deploy.

### 2026-07-22 — Landing CTA text white on black (prod)
- `globals.css`: `a { color: inherit }` → `@layer base` so solid buttons keep white label.
- Redeployed `saas-portal` on VPS (no volume wipe). Live on `https://getvoxly.ru/`.

### 2026-07-22 — Wildcard tenant HTTPS (`*.getvoxly.ru`)
- LE DNS-01 via reg.ru API + certbot on VPS; NPM host **6** + cert **npm-9**; deploy hook for renew.
- Public **200**: `demo` / `demo-crm` / `test2` + apex/api/app.

### 2026-07-22 — NPM HTTPS edge live (getvoxly.ru)
- NPM proxy host **5** → `docker-traefik-1:80` (automation net); LE cert **8** for getvoxly.ru / www / api / app; Force SSL + websockets.
- Public curl **200** on apex/www/api/app. Wildcard later same day (см. выше).
- **Осталось:** DNS-01 wildcard для tenant subdomains; rotate root SSH; сменить `SUPERADMIN_PASSWORD`; commit/push overlay.

### 2026-07-22 — Prod deploy VPS + NPM edge
- Voxly на `150.241.98.135` в `/opt/voxly` рядом с n8n/Baserow/NocoDB/NPM (volumes не трогали).
- Overlay `docker/docker-compose.prod-npm.yml`: Traefik **v3.6.6** → host **8880**, dashboard `127.0.0.1:8088`, entrypoint `web`, portal LB **3000**, DB/Redis localhost-only, сеть `automation_automation_net`.
- Control DB: `prisma db push` + seed (`admin@getvoxly.ru`). Health via Host→:8880 all **200**.
- NPM Proxy Hosts: см. запись выше (2026-07-22 — NPM HTTPS edge live).

### 2026-07-18 — ui-ux-pro-max skill
- Установлен Cursor skill: `uipro init --ai cursor` → `.cursor/skills/ui-ux-pro-max/` (+ design-system persist `design-system/voxly/`).
- Portal polish: ProjectPicker / AppShell / Switch / bot settings — Twenty light сохранён.

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

### День 2 (позже) — локальный запуск + фикс регистрации
- Подняты Colima + Docker: postgres-control, redis, saas-api (:3002), saas-portal (:3001).
- Исправлен прокси портала: rewrite `/api/*` → `saas-api:3002/api/*` (раньше бил в `localhost` и без префикса `/api`).
- Форма регистрации шлёт `companySlug` (не `workspaceName`); проверка пароля ≥8.
- Регистрация через UI/прокси проверена: HTTP 201.
- Фикс дашборда: `/api/auth/me` отдаёт flat `user.tenant` (subscription/addons/aiWallet/referralCode); убран невалидный HTML `pattern` в register.
- Регистрация создаёт реальную подписку `crm_base` на 7 дней (`periodMonths=0`); существующие trial-tenant'ы локально backfill'нуты.
- Дашборд показывает пробный период и дату окончания; trial завершается ровно через 7 дней без paid grace.
- Локально подняты Twenty server + worker + PostgreSQL; CRM доступна на `http://localhost:3007`.
- Исправлен Twenty 2.21 provisioning: `signUp` → workspace-agnostic token → `signUpInNewWorkspace`; повторный запуск возобновляется через `signIn`.
- CRM-пароль генерируется отдельно, хранится AES-256-GCM; `/api/tenant/crm-login` выдаёт короткоживущую SSO-ссылку в конкретный workspace.
- Workspace `test1` создан и SSO-кнопка проверена в браузере: переход на `test1.localhost:3007`.
- Для новых Twenty workspace автоматически задаются `ru-RU`, 24-часовой формат и названия `Сделка`/`Сделки`; настройки применены к `test1` и `test2`.
- Добавлен white-label образ Twenty с title `Voxly` и `lang="ru"`.
- Исправлена SaaS superadmin-страница `/admin`: статистика и список tenant теперь соответствуют фактическому API.
- Seed создаёт superadmin `admin@getvoxly.ru` с bcrypt-хешем (пароль из `SUPERADMIN_PASSWORD`, по умолчанию `changeme`).
- Gift-бот Phase 2 (клиентский онбординг): trial 7 дней, Managed Bots provision, мастер `/dashboard/bots` (канал, линейная воронка, рассылки), `GiftSubscriber`, delayed jobs в gift-bot-worker, CRM Person+Сделка на `/start`, long-poll локально (`GIFT_BOT_USE_POLLING`).
- Webhook Managed Bot выровнен на `/tg/{tenantId}/{botId}`; локально polling вместо public HTTPS.
- Manager Bot локально: реальный токен в `.env`, username **`@VoxlyGiftbot`**, Bot Management Mode ON; `manager-bot-service` в long-poll (`MANAGER_USE_POLLING` / `GIFT_BOT_USE_POLLING`); `getMe` проверен.
- **Чекпоинт перед E2E gift-бота (2026-07-15):** пользователь продолжает с test2 → `/dashboard/bots`. См. §4 «Снимок сессии».

### День 2 (16 июл 2026) — gift Phase 2 доводка
- Воронка: imageUrl + текст кнопки подписки; канал verify уже был.
- Чат оператора в портале + `GET .../messages` + reply → Telegram + Conversation.mode=human; заметки на Person в Twenty (custom ChatMessage App не ставится).
- Рассылки: отдельная страница `/dashboard/bots/broadcasts` (сегмент, медиа, schedule, история); worker шлёт mediaUrl.
- test2: `@voxlycmrm0vuatmbot` + кампания готовы; ждём Start для Person/Сделка.
- **UI:** Tailwind v4 + shadcn **indigo** (ADR-020); `/dashboard` — 4 блока; боты = список → `/dashboard/bots/[botId]`; skills: refero / 21st-shadcn / karpathy.
- **Пост акции в канале:** `GiftCampaignConfig.promoPost` (JSON); API `PUT/POST /api/bots/:id/promo[/publish]`; кнопка `Текст · N` + deep-link `?start=g_{campaignId}`; worker считает клики и обновляет markup; портал — редактор + Telegram-превью + публикация.
- **Фикс:** polling страницы бота не затирает несохранённые правки воронки/поста (обновляет подписчиков и счётчик кликов).
- **Дефолтная воронка:** тексты/тайминги из настроенной кампании test2 (`DEFAULT_GIFT_FUNNEL` в shared).
- **Фикс «Я подписался»:** тип медиа по `file_id` (`AgAC`→photo, `BQAC`→document, …); BullMQ jobId без `:`; выдача до пометки gifted; fallback без MarkdownV2; логика напоминаний not_gifted / not_subscribed (см. сводку §3).
- **Username gift-бота:** `voxly_{slug клиента}_{01}_bot` (вместо cuid/nanoid).
- **Telegram Markdown (client):** `**жирный**`, `__курсив__`, `~~зачёркнутый~~`, `||спойлер||`, `` `код` ``, ```блоки```. Shared: `parseTelegramClientMd` + `clientMdToMarkdownV2`; превью в портале; publish/funnel send → `MarkdownV2`.

### День 2 (16 июл 2026) — админ: результативность воронок
- `ConversionEvent` дополнен `campaignId` + `botInstanceId`; `fireGoal` их сохраняет; gift-bot-worker передаёт на всех целях воронки.
- `GET /api/admin/funnels` — агрегаты по всем tenant/кампаниям: клики поста, старты, проверки подписки, подписки, подарки + конверсии.
- `/admin` — блок «Воронки gift-ботов» (итоги + таблица клиент → бот/канал → метрики).
- Источники: `GiftSubscriber` (старты/подписки/подарки, backfill ок), `promoPost.clickCount` + `ConversionEvent` (клики/проверки; события без campaignId до деплоя не попадут в счётчик «Проверки»).
- Tenant-facing funnel stats на `/dashboard/bots` — не делались (фокус на супер-админе).

### День 2 (16 июл 2026) — медиа file_id + layout воронки
- **Медиа без URL:** `POST /api/bots/:botId/media` (multipart) → upload в Telegram (DM владельца или канал + deleteMessage) → `{ fileId, mediaType }`. Promo/funnel хранят `telegramFileId` (+ legacy `mediaUrl`/`imageUrl`). UI: «Выбрать файл», ObjectURL-превью, без поля HTTPS.
- Publish promo / funnel send / gift deliver — `sendPhoto`/`sendVideo`/`sendDocument` с `file_id`.
- **Воронка layout:** снова `lg:grid-cols-2` как у поста акции — слева редакторы, справа один sticky `TelegramPreview` активного шага (чипы + focus/click). Убраны превью под каждым сообщением.

### День 2–3 (16–17 июл 2026) — сводка доработок сессии (gift UX + CRM UX + Twenty)

> Единая точка входа для следующего чата: всё ниже уже в незакоммиченном коде (см. git status). Не дублировать работу.

**Пост акции (promo)**
- `GiftCampaignConfig.promoPost` (JSON): текст, кнопка, клики, `telegramFileId`/`mediaType` (+ legacy URL).
- API: `PUT/POST /api/bots/:id/promo[/publish]`; deep-link `?start=g_{campaignId}`; кнопка в канале `Текст · N`.
- Портал: редактор + `TelegramPreview` + публикация; медиа через file picker → Telegram `file_id`.

**Воронка UI + Markdown**
- Layout: редакторы слева / один sticky `TelegramPreview` справа (`apps/saas-portal/.../bots/[botId]/page.tsx`).
- Client Markdown: `**жирный**`, `__курсив__`, `~~зачёркнутый~~`, `||спойлер||`, код — `packages/shared/src/telegram-md.ts` → `MarkdownV2` при send/publish.
- Понятные блоки «как бабушке»: заголовки + `hint` у шагов (`1. После Start`, `2. Нажал кнопку, но не в канале`, `После выдачи`, `Если подарок не забрали` и т.п.).

**Админ: результативность воронок**
- `GET /api/admin/funnels` + секция на `/admin` (клики/старты/проверки/подписки/подарки + %).

**Багфиксы worker (`apps/gift-bot-worker`)**
- Polling UI не затирает черновик воронки/поста (обновляет только подписчиков + clickCount).
- Выдача подарка: `detectStoredMediaKind` по префиксу `file_id` — `AgAC`→`sendPhoto`, `BQAC`/`BQAD`/`CQAC`→`sendDocument`, `BAAC`→video (раньше photo/document путались → молчалие/ошибка).
- BullMQ: custom `jobId` без `:`; sanitize через `safeId(...)`.
- Напоминания: после `/start` → цепочка `not_gifted` (молчит, кнопку не жал); любое «Я подписался» → cancel `not_gifted`; если не в канале → `not_subscribed`; после выдачи → `after_gift`.

**Дефолты и имена**
- `DEFAULT_GIFT_FUNNEL` / `DEFAULT_GIFT_PROMO` в `packages/shared` (тексты из настроенной кампании test2).
- Username child-бота: `voxly_{slug}_{01}_bot` (`buildVoxlyBotUsername`).

**CRM из кабинета**
- «Открыть CRM»: `window.open('about:blank')` → SSO URL в новой вкладке; вкладка кабинета **не** уходит.
- Подсказка на `/dashboard` + ошибка, если браузер блокирует popup.

**Twenty CRM 2.21 → 2.22.0**
- Образ `voxly-twenty:2.22.0` (`docker/twenty.Dockerfile` + compose); миграции 4 workspace ok; `:3007` healthy; branding `Voxly` / `lang=ru`.
- Apps path для чата в карточке Сделки: GraphQL `syncApplication` / `installApplication` (не мёртвый `installApp`). Stub `twenty-app/voxly-platform` ещё не SDK.
- **Next:** `npx create-twenty-app` → `yarn twenty remote:add --url http://localhost:3007` → tab на opportunity → `yarn twenty apply`. Scaffold отложен: Yarn 4 + CLI auth + replace stub vs new package.

### День 3 (17 июл 2026) — Twenty CRM → v2.22.0
- Образ: `twentycrm/twenty:v2.22.0` → `voxly-twenty:2.22.0` (`docker/twenty.Dockerfile` + compose).
- Upgrade: 4 workspace(s) succeeded, 0 failed; server `Nest application successfully started`; HTTP `200` на `:3007`.
- White-label сохранён: `<title>Voxly</title>`, `lang="ru"`, og/twitter `Voxly`.
- Worker на том же образе, cron-очередь жива.

### День 3 (17 июл 2026) — Apps path for deal-card chat
- Re-verified healthy (no rebuild): server+worker Up, `/healthz` ok, image `voxly-twenty:2.22.0`.
- Legacy `installApp` **still missing** on metadata GraphQL. New APIs present: `syncApplication(manifest: JSON!)` → `WorkspaceMigration`, `installApplication(universalIdentifier)`, `uninstallApplication`.
- Repo: only stub `twenty-app/voxly-platform` (old `manifest.json` + `objects.ts`, not `twenty-sdk`/`defineApplication`). No front-components/page-layouts. Provisioning still calls dead `installApp` (warn+skip). Chat = portal + Person notes.
- **Viable path:** `npx create-twenty-app` → `yarn twenty remote:add --url http://localhost:3007` (not scaffolder `:2020`) → front component + `definePageLayoutTab` on opportunity/Сделка → `yarn twenty dev|plan|apply`. Multi-tenant later via `installApplication` / API key sync.
- **Scaffold deferred** pending: Yarn 4 (`corepack enable`; monorepo is pnpm), CLI auth (OAuth or API key), replace-vs-new-package for stub. Host Node `v26.4.0` already ≥24.5.

### День 3 (17 июл 2026) — ADR: чат в карточке CRM (Twenty 2.22)

**Решение (принято):** чат оператора в CRM = Twenty Apps SDK tab на **Opportunity / Сделка**, не custom ChatMessage-объекты и не прямой fetch из front в saas-api.

| Вопрос | Выбор |
|---|---|
| Host UI | **Opportunity** (`STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage`) через `definePageLayoutTab` + `defineFrontComponent`. Person — опционально тем же компонентом позже. |
| Source of truth сообщений | **Control-plane Prisma** (`Conversation` / `ChatMessage` / `GiftSubscriber`) — уже работает для портала. |
| Связка record→чат | `GiftSubscriber.twentyOpportunityId` (= `useSelectedRecordIds()`), fallback `twentyPersonId`. |
| Транспорт из UI | Front (sandbox) → **logic function** (`RestApiClient` + `TWENTY_APP_ACCESS_TOKEN`) → `saas-api` с secret app var (`VOXLY_SERVICE_TOKEN`). Secrets в front не попадают. |
| Notes на Person | Оставить как audit/mirror; не UI чата. |
| Stub `twenty-app/voxly-platform` | **Заменить** пакетом `create-twenty-app` (twenty-sdk), не патчить старый manifest. |
| Multi-tenant | После локального PoC: `syncApplication`/`installApplication` в provisioning вместо мёртвого `installApp`. |

**Почему это стабильный путь в 2.22:** официальный Apps surface (`defineFrontComponent` + `definePageLayoutTab` на standard opportunity layout); live metadata API = `syncApplication`/`installApplication`; портальный chat API уже есть; sandbox docs явно требуют logic function для секретов.

**Отклонено:** iframe/extension; только notes; marketplace `installApp`; forked Twenty UI; Twenty custom ChatMessage как SoT; прямой browser→saas-api из front.

**Блокеры scaffold (на момент ADR):** Colima/Docker Twenty down (`:3007` недоступен); `yarn` не в PATH (нужен `corepack enable` → Yarn 4); CLI remote нужен API key workspace или OAuth. Scaffold **не** стартовал.

**Next (ordered):** (1) поднять Twenty; (2) Yarn 4; (3) `npx create-twenty-app@latest voxly-platform` заменить stub; (4) `yarn twenty remote:add --url http://localhost:3007 --api-key …`; (5) front+tab+logicFunction proxy; (6) `GET/POST /api/crm/chat/*` в saas-api по opportunityId; (7) `yarn twenty apply`; (8) provisioning → sync/install.

### День 3 (17 июл 2026, вечер) — Portal UI → Twenty light + motion/UX
- Единый продукт-стиль Twenty: серый canvas, белые карточки, ink CTA, без indigo/dark inline.
- Переписаны лендинг, login, register, admin на shadcn + токены `globals.css`.
- Shared: `AppShell` (sticky nav), `Alert`, `PageHeader`, `CopyButton`, `LoadingState`.
- Motion: `--duration-fast/default/slow`, `animate-in` / `stagger` / `animate-error`, `prefers-reduced-motion`, press `active:scale` на кнопках, hover на inputs.
- Dashboard / bots / broadcasts / bot settings обёрнуты в shell; рефералка — копирование кода/ссылки; алерты вместо сырого текста ошибок.


### День 4 (18 июл 2026) — design reference: Open WebUI
- Для вдохновения по оформлению портала/сайта склонирован **shallow** clone Open WebUI (не зависимость монорепо, не в `apps/`/`packages/`).
- Путь: `/Users/antonsagajdak/Desktop/open-webui` (sibling к `CRM-PLUS`).
- Только reference: не подключать в pnpm/turbo/docker; не копировать UI wholesale в `saas-portal`.
- Куда смотреть для стилей:
  - `src/tailwind.css` — `@theme` токены gray (oklch), base fonts/borders
  - `src/app.css` — шрифты, scale, утилиты типографики
  - `tailwind.config.js` — darkMode class, plugins
  - `src/lib/components/common/` — Modal, Drawer, Sidebar, Dropdown, Switch, Tooltip, Badge…
  - `src/lib/components/layout/Sidebar/` + `Navbar/` — shell/nav паттерны
  - `src/routes/auth/` — экраны логина/регистрации
  - `src/routes/(app)/` — app shell layout

### День 4 (18 июл 2026, ночь) — hotfix: landing/login/register contrast
- **Проблема:** Docker `saas-portal` на `:3001` отдавал старый dark/purple inline UI (indigo gradient, white-on-white «Войти», ghost-поля на светлом фоне).
- **Фикс:** лендинг/login/register на Twenty light (ink CTA, outline secondary, читаемые Input/Label); усилен контраст токенов (`muted-foreground` 38%, border 86%); убран `next/font/google` (ETIMEDOUT в Docker-сборке → system stack).
- Образ пересобран: `docker compose --env-file ../.env up -d --build saas-portal`.

### День 4 (18 июл 2026, ночь) — docs/agent: память агентов + worklog
- Создан пакет `docs/agent/`: STACK, DATA, SERVICES, FLOWS, CAPABILITIES (anti-reimplementation), DECISIONS, OBS; журналы WORKLOG + INCIDENTS.
- Cursor rule `project-state.mdc`: каскад начинается с `docs/agent/README` → CAPABILITIES → steps §4 → graphify; после работы — append WORKLOG, обновлять CAPABILITIES/INCIDENTS при необходимости.
- Seed: инциденты Redis AOF, Telegram unreachable, stale portal image; worklog Twenty 2.22 / deal-chat ADR / portal UI / Colima.

### День 5 (20 июл 2026) — Deal-card Telegram chat (interim)
- API: `GET/POST /api/crm/chat/:opportunityId` (+ reply) по `GiftSubscriber.twentyOpportunityId`.
- Auth: `crm-login` отдаёт `chatToken` → портал кладёт в hash → inject хранит в `localStorage`.
- UI: `docker/twenty-deal-chat.js` — кнопка «Чат» на странице Opportunity; ответ → Telegram + Prisma.
- Worker: reuse Person/Opportunity; лог `/start` + outbound bot → `ChatMessage`; phone из contact.
- ADR-001: interim inject; SDK tab остаётся backlog.

### День 5 (20 июл 2026, вечер) — Apps SDK tab «Чат»
- App `twenty-app/voxly-crm-chat`: `definePageLayoutTab` Person + Opportunity; front ChatPanel; logic `get/reply-crm-chat` → saas-api.
- Auth: `VOXLY_SERVICE_TOKEN` + `X-Twenty-Workspace-Id` (workspace из JWT app token).
- Applied on test2 (`yarn twenty apply`); inject `DISABLE_FLOATING_CHAT=true` (hot-patch в контейнере).
- Incident: Twenty DB без `applicationRegistration.logoFileId` до manual ALTER.

### День 5 (20 июл 2026, вечер) — «Кабинет Voxly» в рабочей области
- Sidebar LINK via SDK (`cabinet-voxly.ts`) → `http://localhost:3001/dashboard`.
- Floating inject отключён (`DISABLE_FLOATING_CABINET=true` + hot-patch `/voxly-cabinet.js`).
- Applied on test2; ADR-009 обновлён.

### День 5 (20 июл 2026, вечер) — Chat tab workspace host (INC-011)
- Bare `localhost:3007/s/crm-chat` → `WORKSPACE_NOT_FOUND`; initial fix tried absolute `WORKSPACE_ORIGIN` baseUrl.

### День 5 (20 июл 2026, вечер) — Chat Failed to fetch (INC-012 → INC-013)
- Absolute `WORKSPACE_ORIGIN` → sandbox `Failed to fetch`; production `LOGIC_FUNCTION_TYPE` was DISABLED.
- Relative `/s/...` → Worker `Failed to parse URL`; bare localhost `/s` → WORKSPACE_NOT_FOUND; floating Кабинет returned after restart.
- Fix: `LOGIC_FUNCTION_TYPE=LOCAL`; patch functionsBaseUrl → `{sub}.localhost/s`; absolute fetch + WORKSPACE_ORIGIN; cabinet DISABLE hot-patch; apply test2.

### День 6 (21 июл 2026) — Chat photo preview in SDK tab
- Bug: attachments showed as plain text (`[фото]`, filename) — panel only printed `fileName||type`.
- Fix: logic `get-crm-chat-file` → saas-api `/file/:fileId` as `{ dataBase64, contentType }`; `chat-panel` `<img>` + download links; hide media placeholders when attachments exist.
- Applied on test2 (`yarn twenty apply --force`).

### День 6 (21 июл 2026) — Chat UX: format menu + multi-attach
- ПКМ: `preventDefault` + dismiss (outside / Escape / blur / scroll / format / selection clear) — no hanging custom menu.
- Layout: right column Прикрепить above Отправить; `input multiple` + remove chips; sequential `/reply` (API 1 file).
- Applied test2 (`yarn twenty apply --remote test2 --force`).

### День 6 (21 июл 2026) — Chat critical: toolbar + photo size cliff (INC-014)
- ПКМ abandoned (Remote DOM): always-visible format toolbar; `_italic_` display.
- Photos: Twenty `/s` empty-200 on large base64 → JPEG compress in `voxly-proxy` (`jpeg-js`); apply test2 front `e950923b…`.

### День 6 (21 июл 2026) — Twenty shell UX: hide create-workspace + Сделки kanban
- Inject `docker/twenty-shell-ux.js` (baked in Dockerfile + hot-patch) hides «Создать рабочее пространство».
- SQL `docker/set-opportunity-kanban-default.sql`: Opportunity **By Stage** → `key=INDEX` (test1/test2); GraphQL cannot set `key`.
- Provisioning: `ensureOpportunityKanbanDefault` in `applyWorkspaceDefaults` converts TABLE INDEX → KANBAN if needed.

### День 6 (21 июл 2026) — Chat attach encode + Send unstick (INC-015)
- Remote DOM File proxies: no `arrayBuffer()` → toast `t.arrayBuffer is not a function`; send mid-fail could leave composer stuck.
- Fix: `FileReader.readAsDataURL` for `fileBase64`; `sending` cleared in `finally` before `load()`; draft cleared only after success.
- Applied test2 front checksum `e7daa9b3…`.

### День 6 (21 июл 2026) — Chat composer remount clear (INC-016)
- After INC-015: text send OK but textarea still showed draft; Send gray (`!canSend` with empty React draft, not hung `sending`).
- Root cause: Remote DOM ignores controlled `value=""` — need remount.
- Fix: `composerKey` remount after success; `void load()` outside finally.
- Applied test2 front checksum `6617426e…`.

### День 6 (21 июл 2026) — Chat attach host base64 + sticky composer (INC-017)
- FileReader/arrayBuffer fail: Remote DOM files are metadata stubs only (not Blobs).
- Fix: `patch-twenty-file-base64.cjs` encodes on host → `dataBase64`; panel stores `PendingAttachment`; grid layout pins composer (messages scroll only).
- Applied test2 (checksum in WORKLOG / apply output).

### День 6 (21 июл 2026) — Composer pin + broken FrontComponent patch (INC-018/019)
- «Неверная конфигурация»: missing `)` in file-base64 patch broke `FrontComponentRenderer` parse.
- Composer still scrolled: outer `.page-layout-scroll-wrapper` grew with messages.
- Fix: patch `}))).then`; shell-ux locks wrapper; panel absolute/flex; front `fa82b539…`.

### День 6 (21 июл 2026) — Kanban/card/Chat defaults for all portals
- Column width 320 + card field set + note label=bodyV2; Chat tab position 15 after Home.
- Provisioning: `twenty-client.applyWorkspaceDefaults`; SQL scripts for existing workspaces.

### День 6 (21 июл 2026) — Kanban note chip `[object Object]` (INC-021)
- Root cause: Note `labelIdentifier=bodyV2` (RICH_TEXT) stringifies to `[object Object]` on relation chips.
- Fix: label=`title` + sync title←body markdown (SQL trigger/backfill) + latest note via noteTarget.position; twenty-client `ensureNoteTitleAsLabel`.

### День 7 (22 июл 2026) — Bot funnel photos in CRM chat (INC-024)
- Root cause: `logBotOutbound` stored text only → CRM «Чат» no `<img>` for `/start` photo.
- Fix: persist `attachments` from sendPhoto/Video/Document; backfill test2 start rows; phone→Person sync finished.
- P1 (seats / chat-install / defaults) still ADR-011 TODO.

### День 6 (21 июл 2026) — Multi-file reply 500 (INC-020)
- Nest JSON body limit 10MB → 500 `"request entity too large"` on large `fileBase64` (common with 2 photos).
- Fix: host JPEG shrink in `patch-twenty-file-base64.cjs`; chat-panel top-level `event.files` + size preflight; front `c93f55cd…` on test2.

### 2026-07-30 — CRM портал (prod)
- `/dashboard/crm`: Trial, «осталось мест», amber UI, invite→Twenty + modal пароль, member sidebar только CRM.
- API: `GET /tenant/crm`, invite Twenty sync, crm-login per-member password; Robokassa → `?paid=`.
- Deployed `saas-api` + migrate `twentyPasswordEncrypted` + `saas-portal`. SMTP deferred.



**2026-07-31 (вечер) — Полный деплой: партнёрский баланс, каналы AI, фиксы биллинга**
- 6 коммитов: схема+миграции, shared constants, billing+referral logic, AI atomic charge+channels, portal UX, incidents doc.
- Deploy: saas-api, saas-portal, ai-telegram-worker, ai-whatsapp-worker, gift-bot-worker. Backup 20260731-151337.
- 4 миграции: uncollectedRub+unique paymentId, productScope normalise, AiUsageLog.channel, ReferralWithdrawal+balanceAppliedRub.
- Smoke: все страницы 200. Логи чисты после restart.

---

## 4. Текущее состояние

### Снимок сессии (читать перед продолжением)

**Память агентов:** `docs/agent/README.md` — порядок чтения; `CAPABILITIES.md` — что уже есть; **`CHAT.md`** — golden path CRM/AI chat (WA эталон); `WORKLOG.md` / `INCIDENTS.md` — что делали и что ломалось. Не сканировать репо «с нуля» без проверки этих файлов.

**Design reference (вне монорепо):** Open WebUI → `/Users/antonsagajdak/Desktop/open-webui` (shallow clone; смотреть `src/tailwind.css`, `src/app.css`, `src/lib/components/common|layout`, `src/routes/auth`). Не runtime-зависимость.

**UI skill (в репо):** `.cursor/skills/ui-ux-pro-max/` — `uipro init --ai cursor` from [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Design system persist: `design-system/voxly/MASTER.md` (Twenty tokens override; не blue SaaS). Workflow: `search.py --design-system` → UX/stack domains → implement.

**Статус кода:** CRM chat + INC-024…**/078**. **2026-07-31 вечер** полный деплой: партнёрский баланс (hold + withdraw + redeem), каналы AI (AiUsageLog.channel), атомарное списание AI-кошелька (INC-075), Robokassa идемпотентность (INC-076), productScope/durationMonths enforcement (INC-077), WA handoff при нуле баланса (INC-074). 4 миграции на проде. Все 5 сервисов (saas-api, saas-portal, ai-telegram-worker, ai-whatsapp-worker, gift-bot-worker) задеплоены и smoke-тестированы. Backup 20260731-151337. **Portal:** shadcn **indigo** + amber `/dashboard/crm` **on prod**. **Prod:** `150.241.98.135` `/opt/voxly`. Gaps: SMTP invite mail deferred; GramJS outbound media; gift no sales LLM; **rotate root SSH password**.

**Локальные URL**
- Портал: `http://localhost:3001`
- API: `http://localhost:3002`
- Gift-бот UI: `http://localhost:3001/dashboard/bots`
- CRM: `http://localhost:3007` / `{slug}.localhost:3007` (SSO с дашборда, **новая вкладка**) — **Twenty v2.22.0**
- Manager bot service: `:3003`, gift-bot-worker: `:3004`

**Prod URL**
- Live HTTPS: `https://getvoxly.ru` / `www` → portal; `https://api.getvoxly.ru` → API; `https://app.getvoxly.ru` → Twenty.
- Tenant HTTPS: `https://{slug}.getvoxly.ru`, `https://{slug}-crm.getvoxly.ru` (wildcard LE). Internal: Host → `http://127.0.0.1:8880`.

**Аккаунты**
- Клиенты (local): `test1@test.ru`, `test2@test.ru` — роль `member`.
- Супер-админ **prod**: `admin@getvoxly.ru` / пароль в `/opt/voxly/.env` (`SUPERADMIN_PASSWORD`) — сменить сразу.
- Для E2E gift-бота выбран **test2** (local).

**Telegram Manager Bot**
- Username: `@VoxlyGiftbot` (Manager Bot, не child gift-бот клиента).
- Bot Management Mode: включён.
- Token: в корневом `.env` (`TELEGRAM_MANAGER_BOT_TOKEN` + `TELEGRAM_MANAGER_BOT_USERNAME=VoxlyGiftbot`) — `getMe` ok.
- Docker: `docker compose ... --env-file .env`.

**Что уже в коде (gift + портал)** — ключевые файлы
- API (`apps/saas-api`): trial, provision-link, campaign, channel/verify, promo draft/publish, `POST .../media`, broadcasts, subscribers, messages/reply; `GET /api/admin/funnels`; `GET /api/bots` → `subscriberCount` + `promoPost`.
- Портал (`apps/saas-portal`): `/dashboard` (4 блока + CRM в новой вкладке + подсказка/popup-blocker); `/dashboard/bots`, `/dashboard/bots/[botId]` (канал → пост акции → прогрев side-by-side → подписчики), `/dashboard/bots/broadcasts`; `/admin` воронки; лендинг/login/register/legal + dashboard на shadcn **indigo**; `AppShell` (Sheet mobile) + motion/UX (Alert, CopyButton, PageHeader).
- Shared: `DEFAULT_GIFT_FUNNEL` / `DEFAULT_GIFT_PROMO`, `buildVoxlyBotUsername`, `telegram-md.ts`, `resolveTelegramMedia`.
- Worker (`apps/gift-bot-worker`): воронка + delays + broadcasts + promo clicks; `detectStoredMediaKind`; BullMQ `jobId` без `:`; напоминания `not_gifted` / `not_subscribed` / `after_gift` (см. сводку §3); Person/Opportunity + notes; `fireGoal` + `campaignId`/`botInstanceId`; MarkdownV2.
- Username новых ботов: `voxly_{slug}_{01}_bot`.
- Twenty App custom ChatMessage — не ставится; чат = портал + **SDK tab «Чат»** (`twenty-app/voxly-crm-chat` → logic → `/api/crm/chat`) + notes. Inject файл сохранён для rollback.

**E2E test2**
- Бот `@voxlycmrm0vuatmbot` (legacy-имя; новые = `voxly_test2_01_bot`), кампания/канал/воронка ок.
- Подписчиков может быть >0 после проверок; при сомнении — новый `/start` → Person/Сделка.
- Пост акции: `/dashboard/bots/<botId>` → блок 2 → файл + опубликовать.

**Следующие шаги (приоритет)**
0. **Robokassa store activation:** legal pages **на prod** (`https://getvoxly.ru/terms` …). Подать заявку в ЛК Robokassa → после одобрения прописать боевые ключи в prod `.env`. **Сменить root SSH пароль** (светился в чате).
0b. **Mailing UX 0.1.22 on prod:** hard-refresh john-crm → «Рассылка». Disk monitor on VPS (was 100%). Optional: WA ack→read wiring.


1. Retest WA LID peer → Person phone from `remoteJidAlt`/`senderPn` after Evolution **v2.3.7-lid** (done 2026-07-26; no QR needed on reconnect).
2. Superadmin `/admin` → «Удалить» tenant `john` (confirm slug) → зарегистрироваться заново → проверить CRM Chat кнопки AI + создание сделок.
3. Telegram Business: включить «Отвечать на сообщения» для AI-бота (`can_reply=true`) — иначе ответы не уходят в TG (INC-056).
4. Smoke prod QR login on `/dashboard/ai/gramjs` (tenant account).
5. Rotate VPS root SSH + `SUPERADMIN_PASSWORD`.

### Пайплайн (всё зелёное на момент последней проверки)
- `pnpm install` ✓
- `pnpm --filter @voxly/shared test` — 33 ✓; typecheck ai-telegram-worker + gramjs-bridge ✓
- Full `pnpm typecheck` / `build` — not re-run entire turbo this session

### Чек-лист фаз

| ID | Фаза | Статус |
|---|---|---|
| phase1-infra | Docker Compose + Traefik + PostgreSQL + Redis | ✅ DONE |
| phase1-control | Control plane: Prisma, auth, Robokassa, provisioning | ✅ DONE |
| phase1-portal | Клиентский портал + супер-админка | ✅ DONE |
| phase1-referral | Реферальная программа (коды, атрибуция, вознаграждения) + супер-админ `/admin/partners` (per-tenant правила, ручные выплаты) | ✅ DONE |
| phase1-manager-bot | Telegram Manager Bot (Managed Bots) | ✅ DONE |
| phase1-twenty-app | Twenty App voxly-platform (объекты stub) | ✅ DONE (stub archived; chat = voxly-crm-chat) |
| phase2-gift-bot | gift-bot-worker (воронка, подписка, рассылки, promo, media file_id) | ✅ DONE |
| phase2-analytics | Сквозная аналитика (Метрика/GA4/FB/VK) | ✅ DONE |
| phase2-gramjs | GramJS bridge (личный аккаунт, опционально) | 🟡 PORTAL+SOFT+PROD (bridge up on prod; hard Robokassa SKU open) |
| phase3-ai-telegram | ai-telegram-worker Business + OpenRouter + handoff | 🟡 IN PROGRESS (media ✅; portal split ADR-014 ✅; AiAgent schema ✅; **default AI OFF**; OPENROUTER/E2E + prod migrate open) |
| phase4-ai-whatsapp | ai-whatsapp-worker + Evolution QR | 🟡 IN PROGRESS (QR works on prod INC-035; soft trial; needs phone-scan E2E + hard Robokassa) |
| final-polish | Dockerfiles, тесты, сборка | ✅ DONE |
| encryption | AES-256-GCM для секретов | ✅ DONE |
| twenty-2.22 | Upgrade CRM 2.21 → 2.22.0 + white-label Voxly | ✅ DONE |
| twenty-deal-chat | Чат в карточке (SDK tab + `/api/crm/chat`; inject off) | ✅ DONE 20.07 (test2) |

**Закрыто: 12/14 отмеченных пунктов.** GramJS scaffolded; AI Telegram Phase 1 media done.

---

## 5. Что осталось сделать

### Prod (срочно)
- Rotate root SSH password; change prod `SUPERADMIN_PASSWORD` in `/opt/voxly/.env`; rotate reg.ru API password.

### Следующий крупный кусок
- **AI Agents Phase 1** — portal/CRM/SKU ✅; Whisper/vision ✅; FAQ/prompt UI; paid Robokassa `ai_tg` / `ai_gramjs`.
- Gift E2E + UI verify SDK tab: CRM → Opportunity/Person → «Чат» → photo preview + reply → Telegram.

### Опциональное
- **Phase 2b: GramJS bridge** — portal QR ✅; soft SKU/trial ✅; **prod bridge up** ✅; hard Robokassa remaining.
- Tenant UI метрик воронки на `/dashboard/bots` (сейчас только супер-админ `/admin`).

### Известные TODO / пробелы
- `emailWorker` в `saas-api` — logging-stub → SMTP (nodemailer + `.env.example`).
- `notifyHumanOperator` в AI-воркерах — не реализован.
- **AI Phase 1** — prod Business AI shipped 2026-07-23; media parity ADR-021 ✅; optional prod `--profile gramjs` already used.
- **Gift-бот E2E** — живой прогон media enrich + funnel на test2.
- **Чат** — SDK tab «Чат» (test2) + портал + notes; inject off (rollback file kept).
- **Superadmin** — готов (`admin@getvoxly.ru`); воронки: `/admin` + `GET /api/admin/funnels`. Счётчик «Проверки» только из новых `ConversionEvent` с `campaignId`.
- **Prisma migrations** — схема через `db push`; перед продом `pnpm db:migrate`. Есть `GiftSubscriber`, у `ConversionEvent` — `campaignId`/`botInstanceId`.
- **Docker runtime** — Colima; TG polling локально (`GIFT_BOT_USE_POLLING` / `MANAGER_USE_POLLING`).
- **GramJS outbound media** — still text-only from CRM.

### Перед продакшеном
- Заполнить `.env` реальными кредами (Robokassa, Telegram Manager Bot, OpenAI, SMTP, `ENCRYPTION_KEY` через `openssl rand -hex 32`).
- Домен `getvoxly.ru`, wildcard DNS → сервер.
- `TELEGRAM_MANAGER_BOT_TOKEN` + Bot Management Mode.
- Twenty: образ 2.22+, `IS_MULTIWORKSPACE_ENABLED=true`.
- `docker compose up -d` из `docker/`.

---

## 6. Команды разработки

> Lean-доки и журналы агента: [`docs/agent/`](docs/agent/README.md) (стек, capabilities, WORKLOG, INCIDENTS).

```bash
# Установка
pnpm install

# Разработка
pnpm dev                              # все сервисы через turbo
pnpm --filter @voxly/saas-api dev     # отдельный сервис

# Сборка и проверки
pnpm typecheck                        # 20/20
pnpm build                            # 13/13
pnpm test                             # 32/32

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
9. **Чат в карточке Сделки (Twenty 2.22)** — Apps SDK: `defineFrontComponent` + `definePageLayoutTab` на `opportunityRecordPage`; сообщения остаются в control-plane Prisma; front зовёт только logic function (секреты не в sandbox); установка через `syncApplication`/`installApplication`, не legacy `installApp`.

---

## 8. Инструменты памяти (как я помню контекст между чатами)

Чтобы не тратить токены на пересканирование кодовой базы, используется каскад:

1. **`docs/agent/`** — lean facts: `CAPABILITIES` (anti-reimplementation), `WORKLOG` / `INCIDENTS`, STACK/DATA/FLOWS/DECISIONS. Старт: `docs/agent/README.md`.
2. **`steps.md` (этот файл)** — история, §4 снимок сессии, чек-лист фаз.
3. **Graphify** (`graphify-out/`) — AST-граф; `query/path/explain` перед широким чтением кода (правило `graphify.mdc`).
4. **`docs/ARCHITECTURE.md`** — глубокое погружение.
5. **Context7 MCP** — актуальные доки библиотек.
6. **Cursor Rules** (`.cursor/rules/*.mdc`) + agent transcripts (цитирование, не линейное чтение).

> **Правило обновления:** после значимых изменений — WORKLOG + при необходимости CAPABILITIES/INCIDENTS/DECISIONS; обновить §3–§5 этого файла; `graphify . --code-only --update`.
