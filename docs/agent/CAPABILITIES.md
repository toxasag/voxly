# Capabilities (существует — не переписывать)

Чеклист product surface. ✅ = в коде. ❌ = нет / stub / pending. Пути — якоря.

Обновляй этот файл при изменении API/UI/worker surface.

**Module freeze:** before editing WA sync / GramJS CRM / chat panel / MAX personal / social links / gift-bot / AI agent / Telegram secretary / deal dedupe → read `docs/agent/modules/README.md` + the module card; run its smoke after changes.

## Verified baseline (user-confirmed WORKING / FROZEN)

User lock: keep these green; do not break with other module work. Cards: `docs/agent/modules/`. PR #1 merged `263e4ef`; prod tip backup `20260806-132913` (+ INC-103 `20260806-125415`).

| Surface | Status | Freeze card |
|---|---|---|
| CRM chats (panel, media, write-as, multi-channel) | 🟢 WORKING / FROZEN **2026-08-07 ~16:14 MSK** (MAX+WA user OK; crm-chat **0.1.28**) | [`crm-chat-panel.md`](modules/crm-chat-panel.md) |
| WhatsApp CRM chat + sync (Evolution + ai-whatsapp-worker) | 🟢 WORKING / FROZEN **2026-08-07 ~16:14 MSK** (outbound media INC-114; preview INC-115; widget INC-116) | [`wa-crm-sync.md`](modules/wa-crm-sync.md) |
| Telegram GramJS personal | 🟢 WORKING (2026-08-06) | [`gramjs-crm-sync.md`](modules/gramjs-crm-sync.md) |
| Gift bot (бот выдачи подарков) | 🟢 WORKING (2026-08-06) | [`gift-bot.md`](modules/gift-bot.md) |
| AI agent | 🟢 WORKING (2026-08-06) | [`ai-agent.md`](modules/ai-agent.md) |
| Telegram secretary (телеграм секретарь) | 🟢 WORKING (2026-08-06) | [`telegram-secretary.md`](modules/telegram-secretary.md) |
| MAX personal (личный MAX → CRM chat) | 🟢 WORKING / FROZEN **2026-08-07 ~16:14 MSK** | [`max-personal.md`](modules/max-personal.md) |

**Chat channels lock (2026-08-07 ~16:14 MSK):** user confirmed **MAX chat** and **WhatsApp chat** both work as expected — do not change without explicit request (docs freeze only that day; no redeploy for the freeze itself).

Cross-cutting: social TG link ≠ chat send; gift only for subscribers; never invent `t.me/+phone`; Contact book ≠ deals source; never wipe prod volumes; **never** write connected MAX owner phone/TG onto peer Person (INC-113).

**New vs existing portals:** runtime code is shared on the same docker services for all tenants. New workspaces get defaults/apps via provision. Existing often need explicit backfill/reapply (e.g. `enrich-persons-by-phone`, `sync-opportunity-chat-activity`, Social layout INC-107, `refresh-crm-chat`). Agent memory: `ADDRESS_BOOK.md` + `RISK_GATE.md` + `CAPACITY.md`; enrich card `modules/cross-channel-enrich.md`.

---

## Portal pages (`apps/saas-portal/src/app`)

| Path | Статус | Файл |
|---|---|---|
| `/` лендинг | ✅ **Friendly SaaS**: phone-first hero, pain/solution, phone tabs, features, **pricing calculator ← `GET /api/pricing/catalog`** (CRM 600/10 seats + modules), referral calc, custom-dev sheet, FAQ, gift FAB. Awwwards **v3** archived: `app/_archive/landing-v3/` | `page.tsx` + `components/landing/friendly/*` + RegisterLink/ReferralCapture |
| `/lp/friendly` | ✅ alias → redirect `/` (сохраняет `?ref=`) | `lp/friendly/page.tsx` |
| `/terms`, `/privacy`, `/consent`, `/refund` | ✅ публичные юр. страницы (Robokassa / 152-ФЗ); `LegalPageShell` + Separator/Card; реквизиты в `lib/legal.ts` | `terms|privacy|consent|refund/page.tsx` |
| `/login`, `/register` | ✅ OTP через `@GetVoxlybot`; **Friendly LP chrome** (`AuthShell`, blue/white, без маскота); checkbox оферта+ПДн на register | `login/page.tsx`, `register/page.tsx` + `components/landing/friendly/auth-shell.tsx` |
| `/dashboard` | ✅ amber industrial hub (`DashboardPortalHero`): «Сейчас важно», KPI (лиды/диалоги/сообщения/AI), сетка разделов, партнёрский баланс, gift-воронка collapsed; CRM open; без admin-деталей (токены/себестоимость) | `dashboard/page.tsx` + `dashboard-portal-hero.tsx` |
| `/dashboard/settings` | ✅ профиль: email/имя/роль/workspace из `GET /api/auth/me` (read-only); смена пароля/PATCH профиля — позже; avatar menu desktop+mobile → сюда | `dashboard/settings/page.tsx` |
| `/dashboard/partners` | ✅ реферальная программа: основная ссылка/код; проекты (campaign links); stats за период; расходы по проекту; pending/earned/net; **резервы баланса** (holds), **заявки на вывод от 1000 ₽**, **транзакции**, **«Оплатить свой счёт»** — любые свои сервисы Voxly с opt-in «Зачесть партнёрский баланс» (CRM/seats/AI/gift/mailing/`ai_topup`) | `dashboard/partners/page.tsx` |
| `/dashboard/crm` | ✅ amber CRM portal: Trial/seats, URL+SSO, Robokassa, invite; **hard lock paywall** when sub ended (ADR-023); **Приём заявок с сайта** (FormWebhookEndpoint URL/secret + last leads, ADR-026) | `dashboard/crm/page.tsx` + `form-leads-section.tsx` |
| `/dashboard/bots` | ✅ **Подарки Telegram** — SKU `gift_bot` 500 ₽/бот | `dashboard/bots/page.tsx` |
| `/dashboard/bots/max` | ✅ **Подарки MAX** — SKU `gift_bot_max` 500 ₽/бот; token connect | `dashboard/bots/max/page.tsx` |
| `/dashboard/bots/[botId]` | ✅ **Canonical gift setup UX (ADR-027)** — data-driven by `botId` for **all** tenants (no per-bot hardcode). TG steps **1–6** + **Дожим**; dual photos; emoji under preview (step 2); media-file proxy preview; unified TG preview chrome; partners amber page chrome; `InputWithEmoji` / `TelegramMdTextarea`; PNG→JPG profile. Details + **Do not regress** below. **MAX `gift_max`:** без TG greeting/promo | `dashboard/bots/[botId]/page.tsx` + `bot-greeting-preview.tsx` + `telegram-preview.tsx` + `telegram-preview-chrome.tsx` + `telegram-md-textarea.tsx` + `input-with-emoji.tsx` + `emoji-picker.tsx` + `to-jpeg.ts` + `upload-bot-media.ts` |
| `/dashboard/bots/broadcasts` | ✅ funnelPhase + edit scheduled + TelegramPreview + MediaPicker (file_id) | `dashboard/bots/broadcasts/page.tsx` |
| `/dashboard/mailing` | ✅ хаб 4 раздела | `dashboard/mailing/page.tsx` |
| `/dashboard/mailing/bot` | ✅ alias → broadcasts UI; **MailingBillingBanner** + partner-balance opt-in | `dashboard/mailing/bot/page.tsx` |
| `/dashboard/mailing/gramjs` | ✅ Conversation audience + schedule/edit/preview (text; media N/A); billing banner + balance opt-in | `dashboard/mailing/gramjs/page.tsx` |
| `/dashboard/mailing/whatsapp` | ✅ Conversation audience + schedule/edit/preview + mediaUrl; billing banner + balance opt-in | `dashboard/mailing/whatsapp/page.tsx` |
| `/dashboard/mailing/stories` | ✅ schedule/edit/preview; GramJS send; WA/ai_tg → unsupported on send (ADR-019); billing banner + balance opt-in | `dashboard/mailing/stories/page.tsx` |
| Twenty sidebar «Рассылка» | ✅ expandable FOLDER + 4 PAGE_LAYOUT; crm-chat **0.1.23** composer+preview+history (edit/dup/delete); accounts filters CRM stage + gift + read; stage rules gift|gramjs|wa; receipts sent (+ delivered/read when acks) | `mailing-*-panel.tsx` + `mailing/*` |
| `/dashboard/ai` | ✅ **Телеграм Секретарь** (единая страница): тариф `ai_tg` 1000₽/10 акк, BotFather+token, Business-аккаунты + unlink + `ai_tg_extra_conn` 200₽, назначение агента, диалоги/handoff; `?bot=`; **не** обзор всех каналов и **не** top-up | `dashboard/ai/page.tsx` + `ai-secretary-hero.tsx` |
| `/dashboard/ai/gramjs` | ✅ **Telegram** (личный аккаунт): landing как WA; QR+2FA; trial/оплата `ai_gramjs` 500₽; QR gated `requiresPayment`; **переименование** `PATCH …/accounts/:botId` (`displayName`); **sync history** button only (no auto on connect) | `dashboard/ai/gramjs/page.tsx` + `ai-gramjs-hero.tsx` |
| `/dashboard/ai/max` | ✅ **MAX** (личный, **FROZEN** INC-104/109/113): QR+2FA; trial/оплата `ai_max` 500₽; disclaimer неофициальный API; CRM reply **text+media** (📎); inbound media + read receipts; **typing N/A**; private DIALOG only (skip CHANNEL/CHAT/bots/self; `me.contact`); owner phone strip (`selfPhone`/`stripOwnerPhone`/`forbidPhones`); `/open/max` = peer **user** id; **sync history** button only | `dashboard/ai/max/page.tsx` + `ai-max-hero.tsx` + `max-bridge` + `max-phone-guard.ts` |
| `/dashboard/ai/whatsapp` | ✅ Evolution QR + trial/оплата `ai_wa`; QR gated `requiresPayment`; **переименование** `PATCH …/accounts/:botId` (`displayName`); **sync history** button only (no auto on connect) | `dashboard/ai/whatsapp/page.tsx` |
| `/dashboard/ai/agents` | ✅ list/create/**edit**; **SKU `ai_agent` 500₽/слот** (gate 402 + grandfather); assign; **usage** byAgent+byChannel; KB + won-deal; **пополнение баланса AI** + partner-balance opt-in на слот и `ai_topup`; hero | `dashboard/ai/agents/page.tsx` |
| `/dashboard/ai/[botId]` | ✅ thin redirect → `/dashboard/ai?bot=` | `dashboard/ai/[botId]/page.tsx` |
| `/admin` | ✅ stats + tenants + воронки + **system health** + **полное удаление аккаунта**; sidebar супер-админ | `admin/page.tsx` + `app-shell.tsx` ADMIN_NAV |
| `/admin/pricing` | ✅ платформенные + per-tenant цены (override от 0 ₽); **«Выдать бесплатно»** 1/3/6/12 мес (CRM+addons, без AI-баланса); AuditLog | `admin/pricing/page.tsx` + `platform-pricing.ts` + `comp-access.ts` |
| `/admin/ai-balance` | ✅ глобальная + per-tenant **AI markup %**; статистика списаний/маржи/пополнений за период; nav «AI баланс» | `admin/ai-balance/page.tsx` + `admin-ai-balance.ts` |
| `/admin/services` | ✅ ops: addons expire/extend, bot suspend, impersonate deep-link в `/dashboard/*` | `admin/services/page.tsx` |
| `/admin/bot` | ✅ GetVoxlybot: подписчики, очередь поддержки (reply), рассылки, notify trial/paid expiry | `admin/bot/page.tsx` |
| `/admin/crm` | ✅ CRM цены (subset) + отчёт + ресурсы + purge + CRM-login + impersonate; ссылка на `/admin/pricing` | `admin/crm/page.tsx` |
| `/admin/partners` | ✅ супер-админ партнёрской программы: список партнёров + метрики за период, карточка партнёра (рефералы, коды, проекты, транзакции), дефолтное правило вознаграждения + **индивидуальное правило на тенанта** (+ **productScope**) + **ставки по сервисам** (`ReferralServiceRate`: per-SKU %), ручные выплаты/корректировки (`ReferralTransaction`), **очередь заявок на вывод** (`admin-withdrawals-queue.tsx`), вкл/выкл кодов и проектов, блокировка партнёра | `admin/partners/page.tsx` + `components/portal/admin-partners-rule.tsx`, `admin-partners-detail.tsx`, `admin-withdrawals-queue.tsx` |
| Tenant funnel stats на `/dashboard/bots` | ❌ только супер-админ | — |
| Deal-card chat UI в Twenty | ✅ SDK tab «Чат» Person+Opportunity: history, reply, **format toolbar** (ПКМ; no format cheat-sheet), **📎 multi-attach** (GramJS+MAX+WA; not gift_max — INC-117), **pinned composer**, remount clear, **photo + video/audio/document preview** (signed URL for **photo**/video/audio/**PDF·DOCX** + GramJS `document`+`image/*`; media resolve by attachment-owning channel on multi-thread Person — INC-115; MIME sniff/Range; Fastify `maxParamLength`+`/media/*`), client MD→MarkdownV2 (Bot API) / HTML entities (GramJS), **«Пишем от»** (gift only if subscribed; WA if Person.whatsapp; **GramJS if Person.telegram userId/@username or TG Conversation** — social open link alone was not enough until INC-103; first send creates Conversation + optional ImportContacts by phone), **channel/identity header** + **presence/last-seen** (GramJS live; WA via PRESENCE_UPDATE cache; TG Business hide), **multi-thread switcher**, **AI вкл/пауза/выкл**, **«Не создавать сделку»** (`suppressDealCreation`), **clickable http(s) links**; soft-refresh fingerprints content+attachments (not ids-only); hide legacy `[media]` when attachments present (INC-050/055/057/063/067/096/098/099/103/115, app ≥**0.1.28**) | `twenty-app/voxly-crm-chat` (+ `docker/twenty-deal-chat.js` rollback; `patch-twenty-file-base64.cjs`; `twenty-shell-ux.js`); freeze: `modules/crm-chat-panel.md` |
| Inbound message left toast | ✅ shell-ux poll prefer `/s/crm-chat/inbound-toasts` ~4s; toast + **auto-refresh open Chat** (click «Обновить» / soft ~4.5s); skew 15s | `docker/twenty-shell-ux.js` + `get-inbound-toasts` + `crm-chat.ts` |
| Unread chat badges (deals + contacts) | ✅ count = inbound `role=user` after `Conversation.lastOperatorReadAt`; mark-read on Chat GET **all** linked threads; shell-ux **one** badge per card (title) + «Чат» tab; poll `/s/crm-chat/unread-badges` ~8s | `crm-chat.ts` + `get-unread-badges` + `twenty-shell-ux.js` |
| Кабинет Voxly (CRM → portal) | ✅ sidebar LINK «Кабинет Voxly»; floating inject off; **dedupe** shell + SQL | `navigation-menu-items/cabinet-voxly.ts` (+ `docker/dedupe-cabinet-nav.sql`) |
| Hide CRM «Создать рабочее пространство» | ✅ inject `voxly-shell-ux.js` (baked + hot-patch) | `docker/twenty-shell-ux.js` |
| Sidebar workspace vs user clarity | ✅ top-left «CRM · {slug}» + chip «Вы: {member}» (workspace ≠ profile); Chat operator = Twenty member name (not «Менеджер») | `twenty-shell-ux.js` + `crm-chat` **0.1.23** + `resolveTwentyOperatorLabel` |
| Сделки views = «Канбан» + «Списком» | ✅ default INDEX **Канбан** (`type=KANBAN`, stage groupBy, `openRecordIn=SIDE_PANEL`, width 320); secondary TABLE **Списком**; stages = john golden; **locked** Новый лид / Успешная / Провалена (PG trigger); middle stages editable; card fields name/createdAt/amount/…/noteTargets; note chip = **body** via title←bodyV2Markdown | SQL `set-opportunity-kanban-default.sql` + `ensureOpportunityRuDefaults` + `ensureOpportunityKanbanCardDefaults` (INC-021) + `twenty-client.applyWorkspaceDefaults` |
| Person «Социальные сети» | ✅ LinkedIn + **Telegram→WhatsApp→MAX** + OK/VK/Instagram/Facebook/Threads/**Сайт** as **LINKS** (force view order); visible label = full URL (`primaryLinkLabel` = `primaryLinkUrl`); WA `wa.me`; TG `@username` → `https://t.me/{user}`; **no @username but MTProto userId** → clickable `https://api.getvoxly.ru/open/tg/{id}` (label `tg://user?id={id}`; page opens Telegram) — never invent `t.me/+phone` / `max.ru/+phone`; WA business profile fills email + website (+ IG/FB if URLs in profile); migrate via `migrate-social-links` + admin `backfill-telegram-open-links`; layout drift → INC-107 | `twenty-client.telegramOpenLink` + `ensureSocialFields` + `socialFieldToUrl` + `linksInput` + `open-tg.ts` |
| Вкладка «Чат» после «Главная» | ✅ `position: 15` Person+Opportunity | `page-layout-tabs/*-chat` + `set-chat-tab-position.sql` |

Shared UI: `components/portal/*`, `components/ui/*`, `components/telegram-preview.tsx`.

**Design workflow:** Cursor skill `ui-ux-pro-max` at `.cursor/skills/ui-ux-pro-max/` (`uipro init --ai cursor`). Persist/search via `python3 .cursor/skills/ui-ux-pro-max/scripts/search.py … --design-system`. Tokens stay Twenty light in `globals.css`; synthesized rules in `design-system/voxly/MASTER.md`.

### Gift bot detail — canonical UX (all tenants, ADR-027)

Reference live shape: any `/dashboard/bots/:botId` (e.g. prod bot used for polish). **Same** React page + APIs for every tenant/bot — driven by `useParams().botId` + `GET /api/bots` row; **never** hardcode a bot/tenant id in portal or API.

| Step | Content |
|---|---|
| **1** Канал | Channel username + verify (`POST …/channel/verify`); project/campaign picker |
| **2** Настройка бота | Display name / description / short description; **profile photo** (Telegram `setMyProfilePhoto`, PNG/WebP→JPEG via `fileToJpegFile`); **separate card photo** before Start (localStorage per `botId`, not TG profile); **emoji panel under preview** (`EmojiPickerPanel` + `InputWithEmoji`); «Сохранить настройки бота» → `PUT …/telegram-profile`; `BotGreetingPreview` |
| **3** Пост акции | Promo draft + media + publish; `TelegramPreview`; optional `showClickCounter` (default true) on channel button |
| **4** Пост после старта | Funnel greeting / after-start post + media + preview; optional `extraButtons` (URL) under post |
| **5** Подарок | Gift content + media + preview; optional `extraButtons` |
| **6** После выдачи | After-gift post + media + preview (`MessageList`); per-message `extraButtons` |
| **Дожим** | Follow-up / nudge block (same preview + MD/emoji patterns); per-message `extraButtons` on notGifted / notSubscribed |

**Shared preview/input chrome (do not fork per step):**
- `TelegramPreview` + `telegram-preview-chrome` — unified TG look; resolves `botId`+`telegramFileId` via `GET …/media-file` (blob after upload preferred)
- `TelegramMdTextarea` — client Markdown → preview / MarkdownV2 path
- `InputWithEmoji` + `emoji-picker` — text + emoji insert (esp. step 2 under preview)
- `uploadBotMedia` — direct API XHR + progress (not Next rewrite on prod)
- Page chrome: partners amber industrial (`land-btn`, cream `#faf8f5`, amber `#f5a623`) — **must not** replace TG preview chrome with generic cards

#### Do not regress (gift-bot portal)

Without an **explicit** user ask, agents must **not** break or “simplify away”:
1. Live Telegram-like **previews** for steps 2–6 + Дожим (incl. photo/video via media-file proxy after reload)
2. **Text input** + client Markdown (`TelegramMdTextarea`) and **emoji** (`InputWithEmoji` / panel under step-2 preview)
3. **Media** upload/kinds (photo/video/document/voice/video_note/audio), progress, `file_id` persistence, prefix-wins `detectStoredMediaKind` (BQAC+photo|video = quality staging intent, INC-094)
4. **Dual photos** on step 2: profile (TG API) ≠ card photo (local per bot)
5. **PNG/WebP → JPEG** before profile photo upload
6. **Multi-tenant** data-driven `botId` routing — no single-bot/tenant special cases
7. Partners-style **page** chrome vs intact **TG preview** chrome
8. Optional **`extraButtons`** (URL) under posts (steps 4–6 + Дожим) — persist via `sanitizeFunnel` (INC-095)

Related incidents: INC-005, INC-086…091, INC-093, INC-095. Cursor rule: `.cursor/rules/gift-bot-setup-ux.mdc`.

---

## Quality / release gate

| Surface | Статус | Где |
|---|---|---|
| Unit tests (shared/billing/crypto/ai-core) | ✅ vitest | `packages/*/tests` |
| API integration tests (money, trial, RBAC, degradation) | ✅ vitest + `voxly_test`; skipIf DB down | `apps/saas-api/tests` |
| Playwright cabinet smoke | ✅ skip without `.auth` / `SKIP_E2E=1` | `apps/saas-portal/e2e` |
| `pnpm verify` | ✅ typecheck + test + portal lint | root `package.json` |
| CI | ✅ Postgres+Redis services | `.github/workflows/ci.yml` |
| Release methodology | ✅ 7 направлений + client acceptance | `docs/agent/RELEASE-CHECKLIST.md` |
| Prod smoke | ✅ landing, api/health(+body), 4 cabinet URLs | `scripts/prod-deploy.sh` |

---

## API (`apps/saas-api` → prefix в `src/index.ts`)

### Auth `/api/auth`
| Method | Path | ✅ |
|---|---|---|
| POST | `/register/start`, `/register/confirm` | ✅ Telegram OTP via `@GetVoxlybot`; confirm создаёт User/Tenant + provision |
| POST | `/register` | ✅ legacy → 400 (use start/confirm) |
| POST | `/login`, `/login/confirm` | ✅ OTP каждый логин; **superadmin** — сразу JWT без OTP |
| GET | `/me` | ✅ flat `user.tenant` |
| POST | `/invite` | ✅ Voxly+Twenty user; returns `crmUrl`+`tempPassword` (SMTP deferred); skips `/install-apps` for new member; **blocked when CRM locked** (ADR-023) |

### Platform bot (internal + admin)
| Method | Path | ✅ |
|---|---|---|
| POST | `/api/internal/platform-bot/bind-auth` | ✅ service-token: bind nonce → send OTP |
| POST | `/api/internal/platform-bot/ensure-subscriber` | ✅ `/start` без auth payload |
| POST | `/api/internal/platform-bot/support-inbound` | ✅ DM → inbox |
| GET/POST | `/api/admin/platform-bot/*` | ✅ stats, subscribers, support reply/read, broadcasts, notify-expiring |

### Billing `/api/billing`
| Method | Path | ✅ |
|---|---|---|
| POST | `/checkout`, `/result` | ✅ checkout: `ai_tg_extra_conn`, `ai_gramjs`, `ai_max`, `ai_wa`, `ai_topup`, `crm_base`+`extraSeats`, `extra_seat`, mailing_*; **`applyBalanceRub`** (партнёрский баланс → hold → fulfilPaymentTransactional; full-cover redirect по productCode); **idempotent result** (conditional claim); webhook persists `Subscription.extraSeats`; InvId via advisory lock; wallet / extraSlots / referral by resolved rule (productScope + durationMonths + **per-SKU ReferralServiceRate** enforced) |
| GET | `/success`, `/fail`, `/status` | ✅ success/fail → `/dashboard/crm?paid=ok\|fail` |

### Public pricing `/api/pricing`
| Method | Path | ✅ |
|---|---|---|
| GET | `/catalog` | ✅ platform monthly SKUs + seatsIncluded (PlatformSetting / shared fallback) for landing calculator; Cache-Control 60s; no auth |

### Tenant `/api/tenant`
| Method | Path | ✅ |
|---|---|---|
| GET | `/dashboard` | ✅ overview stats + mailing addons; CRM `isTrial`; **`crmAccessLocked` fields** (ADR-023) |
| GET | `/crm` | ✅ CRM portal payload: trial, seats, members, pricing; **`crmAccessLocked` + reason/error/grace** |
| GET | `/`, `/members`, `/crm-login` | ✅ crm-login: owner/member Twenty password; **402/403 when CRM locked** |
| PATCH | `/` | ✅ |
| GET | `/members/:memberId/credentials` | ✅ owner: reveal stored CRM password (no regenerate) |
| DELETE | `/members/:memberId` | ✅ remove Voxly seat + Twenty `deleteUserFromWorkspace`; reassign opportunity.ownerId + task.assigneeId → owner; people stay in workspace |
| POST | `/members/:memberId/reissue-credentials` | ✅ owner: set/change password (`{ password? }`) + CRM sync |

### Bots `/api/bots`
| Method | Path | ✅ |
|---|---|---|
| POST | `/gift/start-trial`, `/ai/start-trial`, `/ai/connect`, `/provision-link` | ✅ `ai_tg` = manual token (`/ai/connect`); provision-link gift only (ai_tg rejected) |
| POST | `/gift/max/start-trial` | ✅ trial SKU `gift_bot_max` (1 слот) |
| POST | `/gift/max/connect` | ✅ MAX gift token → `gift_max`; soft-gate `gift_bot_max`; webhook HTTPS |
| GET | `/` (+ subscriberCount, promoPost, aiAddon, gramjsAddon, conversationCount; gift: `telegramDescription` / `telegramShortDescription`) | ✅ |
| GET/PUT | `/:botId/telegram-profile` | ✅ gift greeting: name (`setMyName`), description/short → `BotInstance`; GET syncs from Telegram |
| POST/DELETE | `/:botId/telegram-profile/photo` | ✅ `setMyProfilePhoto` (static JPG; portal converts PNG/WebP→JPEG) / `removeMyProfilePhoto` |
| GET | `/:botId/telegram-profile/avatar` | ✅ auth proxy of current bot profile photo |
| PUT | `/:botId/campaign` (+ `campaignId`, `name`) | ✅ |
| POST | `/:botId/campaigns` (создать проект) | ✅ |
| PATCH | `/:botId/campaigns/:campaignId` (`name`, `isActive`; **один active на бота**) | ✅ |
| GET | `/` → `campaigns[]` + `campaign` (active/newest) | ✅ |
| PUT | `/:botId/promo` (+ `campaignId`) | ✅ |
| POST | `/:botId/media`, `/:botId/promo/publish`, `/:botId/channel/verify` | ✅ media: photo/video/document/voice/video_note/audio → Telegram `file_id` (direct `api.getvoxly.ru` XHR; INC-086/088/091); photo/video staged as document for quality, delivered via download→sendPhoto/Video (INC-094) |
| GET | `/:botId/media-file?fileId=` | ✅ auth+tenant proxy Telegram `getFile` → blob for portal `TelegramPreview` (INC-093); photo/video/video_note; document/voice/audio → text indicators |
| GET/POST | `/mailing/stage-rules`, `PATCH …/:id`, `POST …/fire` | ✅ Opportunity-stage auto-send rules |
| POST/GET | `/:botId/broadcasts` | ✅ gift / gramjs / wa / **story**; soft-gate mailing_* addon |
| PATCH | `/:botId/broadcasts/:broadcastId` | ✅ only `status=scheduled` |
| GET/POST | `/mailing/billing`, `/mailing/start-trial` | ✅ mailing_bot / mailing_accounts / mailing_stories |
| GET | `/:botId/subscribers`, `.../messages` | ✅ |
| POST | `.../reply` | ✅ |
| GET | `/:botId/conversations`, `.../messages` | ✅ AI dialog list + history + `businessCapacity` |
| DELETE | `/:botId/business-accounts/:accountId` | ✅ unlink Business slot (swap) |
| PATCH | `/:botId/conversations/:conversationId` | ✅ mode / pause / aiDisabled / needsReview |
| DELETE | `/:botId` | ✅ |
| POST | `/webhook/:botId` | ✅ (prod webhook; local = poll) |
| GET/POST | `/api/crm/chat/:recordId` (+ `/reply`, `/file/:fileId`, `/file/:fileId/signed-url`, `/media/*`, `/ai`, `/suppress-deal`) | ✅ Opportunity **или** Person id; link = GiftSubscriber **или** Conversation (gift / `ai_tg` / `ai_gramjs` / `ai_max` / `ai_wa`); GET resolves Opportunity→`pointOfContact` Person when Conversation linked only by personId (INC-097); returns `threads[]` + **`sendFromOptions[]`** + **`suppressDealCreation`**; reply **`sendFromBotId`**; **POST `/suppress-deal`** toggles no-auto-Opportunity; text+media+MarkdownV2; orphaned GramJS threads (null `botInstanceId`) still listed via fallback bot; auth = portal/crm JWT **или** `VOXLY_SERVICE_TOKEN` + `X-Twenty-Workspace-Id` |
| GET | `/api/crm/chat/inbound-toasts` | ✅ recent role=`user` ChatMessages for CRM left toasts (crm-chat JWT / service token) |
| GET | `/api/crm/chat/unread-badges` | ✅ `{ opportunities:[{id,count}], persons:[{id,count}] }` unread inbound since `lastOperatorReadAt` |

### AI agents `/api/ai/agents` (ADR-014)
| Method | Path | ✅ |
|---|---|---|
| GET | `/` | ✅ list tenant AiAgent |
| POST | `/` | ✅ create |
| PATCH | `/:agentId` | ✅ update / archive |
| PATCH | `/assign/bot/:botId` | ✅ set `BotInstance.defaultAiAgentId` (null = AI off) |

Conversation override: `PATCH /api/bots/:botId/conversations/:id` body `aiAgentId`.

### GramJS proxy `/api/bots/gramjs` (portal JWT → internal bridge + `VOXLY_SERVICE_TOKEN`)
| Method | Path | ✅ |
|---|---|---|
| GET | `/accounts` | ✅ list `ai_gramjs` + soft billing warning; includes `displayName` |
| POST | `/start-trial` | ✅ soft **7d** addon `ai_gramjs` (`TRIAL_PERIOD_DAYS`) + Robokassa `ai_gramjs` |
| POST | `/auth/qr/start` | ✅ |
| GET | `/auth/qr/status`, `/auth/qr/png` | ✅ |
| POST | `/auth/qr/password` | ✅ 2FA |
| POST | `/sessions/connect` | ✅ |
| PATCH | `/accounts/:botId` | ✅ rename (`displayName`, max 80) |
| POST | `/accounts/:botId/sync-history` | ✅ `runGramjsPrivateChatSync` (manual only) — **all** private dialogs × **30** msgs; no QR; clear error if session dead |
| DELETE | `/accounts/:botId` | ✅ |

### MAX proxy `/api/bots/max` (portal JWT → max-bridge + `VOXLY_SERVICE_TOKEN`) — ADR-025
| Method | Path | ✅ |
|---|---|---|
| GET | `/accounts` | 🟡 list `ai_max` + soft billing |
| POST | `/start-trial` | 🟡 soft **7d** addon `ai_max` |
| POST | `/auth/qr/start` | 🟡 → max-bridge PyMax QR |
| GET | `/auth/qr/status`, `/auth/qr/png` | 🟡 |
| POST | `/auth/qr/password` | 🟡 2FA |
| POST | `/sessions/connect` | 🟡 |
| POST | `/accounts/:botId/sync-history` | 🟡 background → `runMaxPrivateChatSync` (DIALOG ×30 msgs; reuse open Opp; GET accounts `historySyncing`) |
| DELETE | `/accounts/:botId` | 🟡 |

### MAX internal `/api/internal/max` (service token + `X-Voxly-Service: max-bridge`)
| Method | Path | ✅ |
|---|---|---|
| GET | `/bots/active` | 🟡 restore sessions on boot |
| POST | `/bots/upsert`, `/bots/delete` | 🟡 |
| POST | `/inbound` | 🟡 Conversation+ChatMessage+CRM sync (no sales LLM; reuse open Opp) |

### WhatsApp proxy `/api/bots/whatsapp` (portal JWT → ai-whatsapp-worker + Evolution)
| Method | Path | ✅ |
|---|---|---|
| GET | `/accounts` | ✅ list `ai_wa` (`name`/`displayName` + `slug`) + soft billing + evolutionConfigured; prunes underscore never-connected stubs |
| POST | `/start-trial` | ✅ soft **7d** addon `ai_wa` (`TRIAL_PERIOD_DAYS`) + Robokassa `ai_wa` |
| POST | `/auth/qr/start` | ✅ Evolution instance + QR; persists human `displayName` (Cyrillic OK), ascii slug for Evolution |
| GET | `/auth/qr/status` | ✅ connectionState + QR refresh; marks `active` on `open` (no auto history sync) |
| PATCH | `/accounts/:botId` | ✅ rename (`displayName`, max 80) |
| POST | `/accounts/:botId/sync-history` | ✅ Evolution `findChats`+`findMessages` → Conversation/ChatMessage + CRM (**open private dialogs with messages** × **30**; Contact book enrich only; skip `@g.us` / 0-msg; honor `suppressDealCreation`, idempotent by `externalMessageId`; concurrency 1 + sleep) |
| DELETE | `/accounts/:botId` | ✅ Evolution logout/delete + remove `BotInstance` |

### Admin `/api/admin`
| Method | Path | ✅ |
|---|---|---|
| GET | `/health` | ✅ Postgres/Redis/queues/workers + expiring addons/subs, low wallets |
| GET | `/stats`, `/tenants`, `/tenants/:id`, `/funnels` | ✅ |
| GET/PUT | `/pricing` | ✅ platform monthly SKU grid (`platform-pricing.ts`); AuditLog `pricing_platform_update` |
| GET/PUT | `/pricing/tenants`, `/pricing/tenants/:id` | ✅ per-tenant overrides (0…1e6 ₽) + seats; AuditLog `pricing_tenant_update` |
| POST | `/pricing/tenants/:id/comp-access` | ✅ free grant 1/3/6/12 мес: tenant active, crm_base, prices 0, extend addons, Twenty unlock; AI wallet untouched; AuditLog `comp_access_grant` |
| GET | `/ai-balance?from=&to=` | ✅ global markup + period usage/margin/topups/wallets (`admin-ai-balance.ts`) |
| GET | `/ai-balance/tenants?from=&to=&search=` | ✅ per-tenant override + wallet + period usage |
| PUT | `/ai-balance/markup` | ✅ `PlatformSetting ai_markup_percent` 0…500; AuditLog `ai_markup_global_update` |
| PUT | `/ai-balance/tenants/:id/markup` | ✅ `Tenant.aiMarkupPercent` or null=global; AuditLog `ai_markup_tenant_update` |
| GET | `/services/tenants` | ✅ addons/bots/wallet summary per tenant |
| PATCH | `/services/addons/:id`, `/services/bots/:id` | ✅ expire/extend/activate addon; suspend/activate bot |
| GET | `/crm` | ✅ platform CRM pricing + tenants with Twenty workspaces |
| PUT | `/crm/pricing` | ✅ CRM subset → same PlatformSetting keys via `platform-pricing` |
| POST | `/tenants/:id/impersonate` | ✅ JWT as tenant owner → portal `/dashboard/crm` |
| POST | `/tenants/:id/crm-login` | ✅ Twenty SSO URL as workspace owner |
| POST | `.../suspend`, `.../pricing`, `.../credit`, `.../ai-credit`, `.../reapply-crm-defaults`, `.../refresh-crm-chat`, `.../enrich-telegram-profiles`, `.../enrich-persons-by-phone`, `.../sync-opportunity-chat-activity`, `.../backfill-telegram-open-links` | ✅ `ai-credit` = manual AI wallet top-up; `refresh-crm-chat` force-reinstalls voxly-crm-chat tarball; `enrich-persons-by-phone` = phone → TG + MAX + WA IsOnWhatsApp; `sync-opportunity-chat-activity` = Opp.updatedAt ← max ChatMessage (Kanban sort); also `POST /api/admin/sync-opportunity-chat-activity` all tenants; backfill TG open links |
| DELETE | `/tenants/:id` body `{ confirmSlug }` | ✅ full wipe ЛК+CRM+bots+chats (`purge-tenant.ts`) |
| PATCH | `/settings` | ✅ |

### AI agents `/api/ai/agents`
| Method | Path | ✅ |
|---|---|---|
| GET/POST | `/` | ✅ |
| PATCH | `/assign/bot/:botId` | ✅ |
| GET | `/usage` | ✅ spend by `aiAgentId` (+ wallet balance) |
| GET/POST/DELETE | `/:id/knowledge` | ✅ upload txt/md/pdf → chunk+embed |
| GET/DELETE | `/:id/sales-examples` | ✅ from won CRM deals |
| POST | `/:id/sales-examples/sync` | ✅ re-ingest won Opportunities |

### Referral `/api/referrals`
| Method | Path | ✅ |
|---|---|---|
| GET | `/`, `/dashboard?from=&to=` | ✅ stats, campaigns, expenses, referrals list |
| POST | `/campaigns`, `/campaigns/:id/expenses` | ✅ project links + manual spend |
| GET | `/rules`, `/click/:code` → `/register?ref=` | ✅ (legacy; landing also calls click) |
| Portal | `GET /r/:code` → `/?ref=` | ✅ legacy short links |
| Portal | `/?ref=` + CTA → `/register?ref=` | ✅ partner links; sessionStorage + click once |
| POST | `/rules` (superadmin) | ✅ |
| GET | `/campaigns/code-available?code=` | ✅ inline-валидация; `POST /campaigns` отдаёт **409** на занятый кастомный код |

### Admin referrals `/api/admin/referrals` (superadmin)
| Method | Path | ✅ |
|---|---|---|
| GET | `/?from=&to=` | ✅ партнёры + метрики (клики/регистрации/оплаты/начислено/выплачено/баланс) |
| GET | `/partners/:tenantId` | ✅ карточка: рефералы, коды, проекты, транзакции, действующее правило |
| PUT | `/rule` | ✅ дефолтное `ReferralRule` (`tenantId = null`) |
| PUT | `/partners/:tenantId/rule` | ✅ **индивидуальное правило** на тенанта (`ReferralRule.tenantId`, `@@unique`) |
| PUT | `/partners/:tenantId/service-rates` | ✅ upsert per-SKU % (`ReferralServiceRate`, 0–100; каталог `REFERRAL_COMMISSION_SKUS`) |
| DELETE | `/partners/:tenantId/service-rates/:productCode` | ✅ удалить ставку сервиса |
| POST | `/partners/:tenantId/transactions` | ✅ `ReferralTransaction` `payout` / `manual_credit` / `manual_debit` |
| PATCH | `/codes/:id`, `/campaigns/:id` | ✅ активация/деактивация кода и проекта |
| PATCH | `/partners/:tenantId/block` | ✅ блокировка партнёра |
| PATCH | `/referrals/:id` | ✅ ручная правка статуса реферала |
| GET | `/withdrawals?status=` | ✅ очередь заявок на вывод (pending/paid/rejected/cancelled) + summary |
| PATCH | `/withdrawals/:id` | ✅ approve (paid) / reject заявки на вывод |

### Referral `/api/referrals` (additions)
| Method | Path | ✅ |
|---|---|---|
| POST | `/withdrawals` | ✅ создать заявку на вывод (min 1000 ₽, hold на TenantBalance) |
| DELETE | `/withdrawals/:id` | ✅ отменить pending-заявку (возврат hold) |
| POST | `/holds/:paymentId/release` | ✅ освободить резерв по неоплаченному счёту |

### Analytics `/api/analytics`
| Method | Path | ✅ |
|---|---|---|
| GET/POST/DELETE | integrations | ✅ |
| GET | `/click/:code`, `/conversions`, `/admin/stats` | ✅ |
| POST | `/fire` | ✅ |

### Web form lead intake `/api/forms` + `/api/webhooks/forms` (ADR-026)
| Method | Path | ✅ |
|---|---|---|
| POST | `/api/webhooks/forms/:token` | ✅ public; Tilda form-urlencoded + JSON; `test=test` → 200 `ok`; secret via `X-Voxly-Webhook-Secret` / body / query; persist `FormLead` + BullMQ ≤5s ACK |
| GET/POST | `/api/forms/endpoints` | ✅ tenant JWT CRUD; token + secret + URL |
| PATCH/DELETE | `/api/forms/endpoints/:id` | ✅ rotate secret, dedupeMode `reuse_open`\|`always_new`, isActive |
| GET | `/api/forms/leads` | ✅ recent leads (status/error/person/opp) |
| POST | `/api/forms/leads/:id/retry` | ✅ re-enqueue failed |

### Health
`GET /health` ✅

---

## Workers / features

| Feature | Где | ✅ |
|---|---|---|
| Managed Bot provision + encrypt token | manager-bot-service | ✅ |
| Funnel + delays + channel verify + gift | gift-bot-worker | ✅ |
| Promo click / deep-link `g_{id}` | gift-bot-worker + bots routes | ✅ |
| Media via Telegram `file_id` | bots media + worker send | ✅ |
| Client Markdown → MarkdownV2 | `packages/shared/src/telegram-md.ts` | ✅ |
| Broadcasts | gift-bot-worker | ✅ gift + gramjs/wa + stories (GramJS); attribution tags |
| Mailing GramJS / WA | portal + Broadcast | ✅ Phase 3 |
| Mailing stories | gramjs-bridge `/stories/send` | ✅ GramJS; WA/ai_tg explicit unsupported |
| Mailing billing | PRODUCT_CODES mailing_* | ✅ 500/500/1000 + trial gate; soft 402 → portal Robokassa (`productCode` / `?pay=1`) |
| Trial period | `TRIAL_PERIOD_DAYS` | ✅ **7** days (was 14) |
| CRM Person/Opportunity + notes | gift-bot-worker + twenty-client | ✅ Person.`telegram`; GramJS enrich phone/about/birthday; GramJS history/enrich via portal sync button or admin enqueue (not auto on connect) |
| Media ASR/vision/docs | ai-telegram-worker / ai-whatsapp-worker / gramjs-bridge / **gift-bot-worker** | ✅ **Platform default** (worker-global; no per-tenant flag). Whisper via OpenRouter STT (voice + **video_note/ptv + regular video** / doc-video; ffmpeg demux; tags `[голос]`/`[кружочек]`/`[видео]`, ≤**20MB** / ≤**180s**); vision multimodal; **PDF/DOCX** → `[документ PDF|DOCX]:` (≤25k, `@voxly/ai-core` pdf-parse/mammoth); `MEDIA_INBOUND_HINT` on AI channels; fail → clear RU fallback. **Gift:** same enrich into `ChatMessage` for CRM (no sales LLM); `ai_tg` still forwarded to telegram-worker. New workspaces: `ensureCrmChatAppInstalled(forceReinstall)` on provision |
| Bot outbound media in CRM chat | gift-bot-worker `logBotOutbound` | ✅ photo/video/document `attachments.fileId` (INC-024); same preview path as inbound |
| Gift inbound media CRM | gift-bot-worker `storeInboundMessage` + `enrichGiftInboundMedia` | ✅ attachments + ASR/vision/PDF/DOCX text (video_note included); ffmpeg in image; OPENROUTER_* in compose |
| fireGoal + campaignId/botInstanceId | gift-bot-worker → ConversionEvent | ✅ |
| Username `voxly_{slug}_{NN}_bot` | `buildVoxlyBotUsername` | ✅ |
| AI Telegram / WhatsApp workers | apps/ai-* | ✅ **Golden path `docs/agent/CHAT.md`**: WA эталон (debounce 10s + in-flight queue, typing via `sendText(delay)` ≥~3s, bubble gaps 4–6s, LID→PN no CUID-phone, business email+website + soft-delete email free INC-062; IG/FB only if URL in profile). TG Business: same agent/debounce model; typing shorter than WA. **AI reply only if AiAgent assigned** (ADR-014); skip TG `is_bot`; WA skip groups/status/newsletter |
| Gift → AI webhook forward | gift-bot-worker `/tg` | ✅ if `botType === 'ai_tg'` → `ai-telegram-worker:3005` |
| PATCH conversation handoff | `PATCH /api/bots/:botId/conversations/:conversationId` | ✅ mode / pause / aiDisabled / needsReview / **aiAgentId** |
| AI portal onboarding | saas-portal `/dashboard/ai` + `/agents` + `/whatsapp` + `/gramjs` | ✅ Секретарь + agents (SKU+wallet) + WA + Telegram(GramJS) |
| Evolution API | compose `evolution-api` (profile `whatsapp`) | 🟡 Baileys QR; image `voxly-evolution-api:v2.3.7-lid` (INC-059 LID→PN); `EVOLUTION_API_KEY` + DB `evolution` |
| AiAgent model | packages/db | ✅ tenant agents; bot default + conversation override; null = AI off |
| AI CRM lead Person+Opportunity | ai-telegram-worker / ai-whatsapp-worker `syncLeadToCrm` | ✅ dedupe; **not for bot senders** (early return before CRM); **cross-channel merge by phone** (`findPersonByPhone` phones+whatsapp, INC-044); ambiguous → `needsReview`; **stale Twenty ids after wipe → clear+recreate (INC-042)**; WA E.164 from webhook/vCard/explicit Evolution fields only (no avatar invent, INC-059) |
| Web form → CRM + attribution | saas-api `processFormLead` + BullMQ `form-leads` | ✅ Tilda/WP/JSON; Person phone→email dedupe; Opportunity reuse_open; `AttributionSession` + `fireGoal('web_form_lead')`; phone → `enrichPersonCrossChannelByPhone` (TG+MAX+WA); **not** gift funnel |
| Cross-channel enrich by phone | `enrichPersonCrossChannelByPhone` + `POST /api/internal/crm/enrich-by-phone` + WA `/internal/crm/check-on-whatsapp` | ✅ Shared hub: site / TG / GramJS sync / MAX / gift contact-share / admin; WA inbound keeps local TG+MAX; wa.me only if IsOnWhatsApp exists; freeze: [`modules/cross-channel-enrich.md`](modules/cross-channel-enrich.md) |
| AI Business SKU | PRODUCT_CODES.AI_TELEGRAM + addon gate | ✅ Телеграм Секретарь 1000₽/10; extra `ai_tg_extra_conn` 200₽/slot |
| AI agent SKU | PRODUCT_CODES.AI_AGENT + `config.agentSlots` | ✅ 500₽/slot; create gated 402; grandfather `20260731220000` |
| AI usage by agent + channel | AiUsageLog.aiAgentId + **channel** + GET `/api/ai/agents/usage` | ✅ charge on reply; portal breakdown **byAgent** + **byChannel**; `uncollectedRub` for shortfall tracking |
| AI cost (OpenRouter) | `@voxly/ai-core` `resolveProviderCostRub` + `getEffectiveMarkup` | ✅ `usage.cost` → else `GET /models` pricing × tokens → USD×rate → markup; admin `/admin/ai-balance` sets global/`Tenant.aiMarkupPercent`; TG+WA workers |
| AI knowledge + sales RAG | AiKnowledge* + AiSalesExample + retrieveAgentContext | ✅ files txt/md/pdf; learn only from won Opportunity stage (`USPESHNAYA_SDELKA` + legacy `CUSTOMER`); inject into LLM prompt |
| Referral default | ReferralRule percent_recurring 20% | ✅ excl. `ai_topup`; webhook `creditReferralForPayment` |
| Referral per-tenant rule + transactions + withdrawals | `referral-program.ts` (резолв правила) + `referral-admin.ts` | ✅ `ReferralRule.tenantId` (индивидуальное правило имеет приоритет над дефолтным); **`ReferralServiceRate`** (tenantId+productCode → %; при начислении SKU-override > rule.value, иначе personal/global); `billing.ts` начисляет по резолвнутому правилу (**productScope** + **durationMonths** enforced); `ReferralTransaction` (`payout`/`manual_credit`/`manual_debit`/`redeem`) — ручные выплаты и корректировки из `/admin/partners`; **`ReferralWithdrawal`** (создание/отмена/approve/reject); **`releaseBalanceHold`** (hold на Payment при checkout, часовой sweep зависших); резолв вынесен из `referral-admin` чтобы разорвать циклическую зависимость |
| `emailWorker` SMTP | queues.ts | ❌ logging stub |
| `notifyHumanOperator` | AI workers | ❌ |
| GramJS bridge | `apps/gramjs-bridge` | ✅ QR + session + soft SKU + `POST /messages/send` (HTML entities + optional media); **private DM only** for AI/CRM (skip group/channel); `POST /crm/private-dialogs` + **portal sync button** → CRM chat sync (**all** private dialogs × **30** msgs, rate-limited; no auto on connect); audience sync separate; portal via saas-api proxy |
| Skip bot / group senders | ai-telegram / gramjs / WA / MAX | ✅ TG `is_bot`; GramJS `User.bot` + **non-private chat**; WA skip `@g.us` / status/newsletter/broadcast (inbound + manual history sync); MAX skip `CHANNEL`/`CHAT`/negative id/self (`me.contact`) + bot heuristic + owner-phone strip (INC-113) |
| suppressDealCreation | Conversation + GiftSubscriber | ✅ Manual CRM chat toggle «Не создавать сделку» only (never auto-set on Opportunity delete); honored in TG/WA/gift syncLead + GramJS/WA connect import |
| WA private chat history sync | ai-whatsapp-worker `runWhatsAppPrivateChatSync` | ✅ **Manual only** (portal «Синхронизировать» / `POST …/sync-history`); no auto on CONNECTION_UPDATE/`authorized`; Evolution **findChats + fetchAllEvoMessagesForJid** (open private dialogs with history, default **500** msgs/chat); Contact book **enrich only** — not dialog source (INC-097 v6); LID→PN via `resolveLidPhoneFromEvolution()` (Message.key → Redis lid-mapping → IsOnWhatsapp → whatsappNumbers → book → profile-index) (INC-097 v7); **merge LID↔PN twin Conversations** (`mergeWaLidPnTwinConversations`, `repairOnly`); after twin merge soft-delete orphan Opps; before createOpportunity **reuse** open Opp on Person (`findOpenOpportunityByPerson`, INC-100); LID+PN message merge; skip 0-msg rows; skip groups/self/`0@`; always Person+Opportunity per chat (`nonameN` if no name); Opportunity `{seq} · WA · {bot.displayName}`; phone in Person.phones+whatsapp when resolvable; repair soft-deletes legacy shells; TG presence after phone (no `t.me/+`); concurrency 1 + sleep |
| Save-time CRM deal dedupe | `crm-deal-dedupe` + crm-chat LFs ≥**0.1.27** | ✅ On Opportunity create/update + Person phones/whatsapp update → soft-merge People by phone/whatsapp + collapse duplicate open Opps on same Person (keep Conversation-linked) |
| Telegram presence by phone | gramjs-bridge `POST /users/by-phone` (+ GetFullUser) + `/users/full` + WA `enrichTelegramPresenceFromPhone` + admin `enrich-persons-by-phone` | ✅ ImportContacts → `@username` **or** MTProto `userId` → `telegramOpenLink` (`t.me/{user}` / `/open/tg/{id}`→`tg://`); GetFullUser name/about/birthday (replace only `nonameN`/empty); phone only if matches WA E.164; **never** invent `https://t.me/+{phone}`; scrape never discards known userId (INC-106); leave empty if not on TG |
| MAX presence by phone | max-bridge `POST /users/by-phone` + WA `enrichMaxPresenceFromPhone` + admin/shared enrich (`channels:["max"]`) + sync/inbound `applyMaxProfile` | ✅ PyMax `search_by_phone` → `import_contacts` fallback; WA/site/TG paths enrich when `ai_max` connected; live MAX inbound merges Person/Opp by **peer** phone + reverse TG/WA enrich (`forbidPhones` for owner); Person.`max` LINKS only when `User.link` is real `max.ru/…`; name placeholder-guard; about from `description`; phone **fill-empty**; **birthday N/A**; never invent `max.ru/+{phone}`; never apply connected-account phone onto peer |
| WhatsApp presence by phone | WA worker `POST /internal/crm/check-on-whatsapp` + `enrichOnePersonWhatsappByPhone` | ✅ Evolution `whatsappNumbers` / IsOnWhatsApp; writes `wa.me` only when `exists`; used from site/TG/MAX/gift (not invent from phone alone) |
| GramJS → AI handoff | `POST /internal/inbound` on ai-telegram-worker | ✅ Bearer `VOXLY_SERVICE_TOKEN`; returns bubbles |
| GramJS portal UI | saas-portal `/dashboard/ai/gramjs` | ✅ QR + status + accounts; browser never hits bridge |
| Twenty App SDK deal chat | twenty-app/voxly-crm-chat + `/api/crm/chat` | ✅ tab + format toolbar + multi-📎 (INC-017/018/020 JPEG shrink) + pinned composer (INC-019) + remount (INC-016) + photo preview (INC-014); inject off |
| `installApp` in provisioning | queues + twenty-client | ✅ private `uploadAppTarball` + `installApplication` + set `WORKSPACE_ORIGIN`/`VOXLY_API_URL` (tarball in saas-api image / `VOXLY_CRM_CHAT_TARBALL`) |
| Skip `/install-apps` onboarding | `twenty-client.skipInstallAppsOnboarding` + SQL `clearTwentyOnboardingFlags` | ✅ GraphQL skip + SQL DELETE install-apps/sync-email/invite/connect ( **keeps CREATE_PROFILE** ) early/late in provision; `syncOwnerProfileFromControlDb` backfill |
| CRM sidebar order | `ensureWorkspaceNavOrder` + `docker/set-workspace-nav-order.sql` | ✅ Сделки→…→Панели; cabinet pos 6; provision + `reapply-crm-defaults` |
| Redis flat-map flush | `flushTwentyWorkspaceRedisCache` | ✅ after provision / reapply (INC-086 blank kanban) |
| RU object labels on provision | `applyWorkspaceDefaults` + SQL | ✅ GraphQL labels Сделка/Сделки; SQL `ensureOpportunityRuDefaults` / `set-opportunity-kanban-default.sql` sets `isLabelSyncedWithName=false` + INDEX **Канбан** + TABLE **Списком** (strips poisoned kanban `overrides`); shell-ux CTA → «Новая Сделка» |
| `VOXLY_SERVICE_TOKEN` on Twenty | compose twenty-server/worker | ✅ LOCAL logic → saas-api (INC-026) |

---

## Deploy / ops surface

| Surface | Статус | Где |
|---|---|---|
| Local compose + override ports | ✅ | `docker/docker-compose.yml` + `docker-compose.override.yml` |
| Prod beside NPM (Traefik :8880) | ✅ VPS `/opt/voxly` | `docker/docker-compose.prod-npm.yml` + `/opt/voxly/.env` |
| NPM Proxy Hosts for getvoxly.ru | ❌ user config pending | STACK.md «Prod (VPS + NPM)» |

---

## Shared helpers (не дублировать)

- Shared helpers: `packages/ai-core` (`extractAudioFromVideo`, `extractDocumentText`, `MEDIA_INBOUND_HINT`)
- `DEFAULT_GIFT_FUNNEL` / `DEFAULT_GIFT_PROMO` — `packages/shared`
- `resolveTelegramMedia`, `buildVoxlyBotUsername`
- `parseTelegramClientMd` / `clientMdToMarkdownV2`
- Crypto: `@voxly/crypto`
