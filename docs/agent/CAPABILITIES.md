# Capabilities (существует — не переписывать)

Чеклист product surface. ✅ = в коде. ❌ = нет / stub / pending. Пути — якоря.

Обновляй этот файл при изменении API/UI/worker surface.

---

## Portal pages (`apps/saas-portal/src/app`)

| Path | Статус | Файл |
|---|---|---|
| `/` лендинг | ✅ AIDA conversion landing; industrial-tech art direction; маскот **Voxly**; Unbounded + Manrope; 7 дней free, CRM от 500 ₽; mobile sticky CTA; реквизиты ИП | `page.tsx` + `components/landing/vox-relay.tsx` |
| `/terms`, `/privacy`, `/consent`, `/refund` | ✅ публичные юр. страницы (Robokassa / 152-ФЗ); `LegalPageShell` + Separator/Card; реквизиты в `lib/legal.ts` | `terms|privacy|consent|refund/page.tsx` |
| `/login`, `/register` | ✅ OTP через `@GetVoxlybot` (`register/start`→`confirm`, `login`→`login/confirm`); superadmin login без OTP; checkbox оферта+ПДн на register | `login/page.tsx`, `register/page.tsx` |
| `/dashboard` | ✅ **stats overview** + teaser техподдержки `@GetVoxlybot`; messages, dialogs, leads, AI spend, tariffs, gift funnel; CRM open; partners | `dashboard/page.tsx` |
| `/dashboard/partners` | ✅ реферальная программа: основная ссылка/код; проекты (campaign links); stats за период; расходы по проекту; pending/earned/net; **резервы баланса** (holds), **заявки на вывод**, **транзакции**, **«Оплатить балансом»** (applyBalanceRub через checkout) | `dashboard/partners/page.tsx` |
| `/dashboard/crm` | ✅ amber CRM portal: Trial/seats, URL+SSO, Robokassa, invite; **hard lock paywall** when sub ended (ADR-023) | `dashboard/crm/page.tsx` |
| `/dashboard/bots` | ✅ список gift-ботов | `dashboard/bots/page.tsx` |
| `/dashboard/bots/[botId]` | ✅ **1.1** канал → **1.2** первое сообщение (Telegram description до /start) → **1.3** стартовое (/start funnel) → promo, funnel, media, chat, subscribers; **расписание проекта** | `dashboard/bots/[botId]/page.tsx` |
| `/dashboard/bots/broadcasts` | ✅ funnelPhase + edit scheduled + TelegramPreview + MediaPicker (file_id) | `dashboard/bots/broadcasts/page.tsx` |
| `/dashboard/mailing` | ✅ хаб 4 раздела | `dashboard/mailing/page.tsx` |
| `/dashboard/mailing/bot` | ✅ alias → broadcasts UI | `dashboard/mailing/bot/page.tsx` |
| `/dashboard/mailing/gramjs` | ✅ Conversation audience + schedule/edit/preview (text; media N/A) | `dashboard/mailing/gramjs/page.tsx` |
| `/dashboard/mailing/whatsapp` | ✅ Conversation audience + schedule/edit/preview + mediaUrl | `dashboard/mailing/whatsapp/page.tsx` |
| `/dashboard/mailing/stories` | ✅ schedule/edit/preview; GramJS send; WA/ai_tg → unsupported on send (ADR-019) | `dashboard/mailing/stories/page.tsx` |
| Twenty sidebar «Рассылка» | ✅ expandable FOLDER + 4 PAGE_LAYOUT; crm-chat **0.1.23** composer+preview+history (edit/dup/delete); accounts filters CRM stage + gift + read; stage rules gift|gramjs|wa; receipts sent (+ delivered/read when acks) | `mailing-*-panel.tsx` + `mailing/*` |
| `/dashboard/ai` | ✅ **Телеграм Секретарь** (единая страница): тариф `ai_tg` 1000₽/10 акк, BotFather+token, Business-аккаунты + unlink + `ai_tg_extra_conn` 200₽, назначение агента, диалоги/handoff; `?bot=`; **не** обзор всех каналов и **не** top-up | `dashboard/ai/page.tsx` + `ai-secretary-hero.tsx` |
| `/dashboard/ai/gramjs` | ✅ **Telegram** (личный аккаунт): landing как WA; QR+2FA; trial/оплата `ai_gramjs` 500₽; QR gated `requiresPayment` | `dashboard/ai/gramjs/page.tsx` + `ai-gramjs-hero.tsx` |
| `/dashboard/ai/whatsapp` | ✅ Evolution QR + trial/оплата `ai_wa`; QR gated `requiresPayment` | `dashboard/ai/whatsapp/page.tsx` |
| `/dashboard/ai/agents` | ✅ list/create/**edit**; **SKU `ai_agent` 500₽/слот** (gate 402 + grandfather); assign; **usage** byAgent+byChannel; KB + won-deal; **пополнение баланса AI**; hero | `dashboard/ai/agents/page.tsx` |
| `/dashboard/ai/[botId]` | ✅ thin redirect → `/dashboard/ai?bot=` | `dashboard/ai/[botId]/page.tsx` |
| `/admin` | ✅ stats + tenants + воронки + **system health** + **полное удаление аккаунта**; sidebar супер-админ **Обзор** + **CRM портал** (не кабинет) | `admin/page.tsx` + `app-shell.tsx` ADMIN_NAV |
| `/admin/bot` | ✅ GetVoxlybot: подписчики, очередь поддержки (reply), рассылки, notify trial/paid expiry | `admin/bot/page.tsx` |
| `/admin/crm` | ✅ платформенные цены + per-tenant pricing; отчёт CRM (trial/paid/revenue); ресурсы (RAM оценка + диск по клиентам, 60s refresh); purge; CRM-login; impersonate | `admin/crm/page.tsx` |
| `/admin/partners` | ✅ супер-админ партнёрской программы: список партнёров + метрики за период, карточка партнёра (рефералы, коды, проекты, транзакции), дефолтное правило вознаграждения + **индивидуальное правило на тенанта** (+ **productScope**), ручные выплаты/корректировки (`ReferralTransaction`), **очередь заявок на вывод** (`admin-withdrawals-queue.tsx`), вкл/выкл кодов и проектов, блокировка партнёра | `admin/partners/page.tsx` + `components/portal/admin-partners-rule.tsx`, `admin-partners-detail.tsx`, `admin-withdrawals-queue.tsx` |
| Tenant funnel stats на `/dashboard/bots` | ❌ только супер-админ | — |
| Deal-card chat UI в Twenty | ✅ SDK tab «Чат» Person+Opportunity: history, reply, **format toolbar** (ПКМ; no format cheat-sheet), **📎 multi-attach**, **pinned composer**, remount clear, **photo + video/audio/document preview** (signed URL for video/audio/**PDF·DOCX**; MIME sniff/Range; Fastify `maxParamLength`+`/media/*`), MarkdownV2, **channel/identity header** + **presence/last-seen** (GramJS live; WA via PRESENCE_UPDATE cache; TG Business hide), **multi-thread switcher**, **AI вкл/пауза/выкл**, **clickable http(s) links** (INC-050/055/057/063/067, app ≥0.1.20) | `twenty-app/voxly-crm-chat` (+ `docker/twenty-deal-chat.js` rollback; `patch-twenty-file-base64.cjs`; `twenty-shell-ux.js`) |
| Inbound message left toast | ✅ shell-ux poll prefer `/s/crm-chat/inbound-toasts` ~4s; toast + **auto-refresh open Chat** (click «Обновить» / soft ~4.5s); skew 15s | `docker/twenty-shell-ux.js` + `get-inbound-toasts` + `crm-chat.ts` |
| Unread chat badges (deals + contacts) | ✅ count = inbound `role=user` after `Conversation.lastOperatorReadAt`; mark-read on Chat GET **all** linked threads; shell-ux **one** badge per card (title) + «Чат» tab; poll `/s/crm-chat/unread-badges` ~8s | `crm-chat.ts` + `get-unread-badges` + `twenty-shell-ux.js` |
| Кабинет Voxly (CRM → portal) | ✅ sidebar LINK «Кабинет Voxly»; floating inject off; **dedupe** shell + SQL | `navigation-menu-items/cabinet-voxly.ts` (+ `docker/dedupe-cabinet-nav.sql`) |
| Hide CRM «Создать рабочее пространство» | ✅ inject `voxly-shell-ux.js` (baked + hot-patch) | `docker/twenty-shell-ux.js` |
| Sidebar workspace vs user clarity | ✅ top-left «CRM · {slug}» + chip «Вы: {member}» (workspace ≠ profile); Chat operator = Twenty member name (not «Менеджер») | `twenty-shell-ux.js` + `crm-chat` **0.1.23** + `resolveTwentyOperatorLabel` |
| Сделки views = «Канбан» + «Списком» | ✅ default INDEX **Канбан** (`type=KANBAN`, stage groupBy, `openRecordIn=SIDE_PANEL`, width 320); secondary TABLE **Списком**; stages = john golden; **locked** Новый лид / Успешная / Провалена (PG trigger); middle stages editable; card fields name/createdAt/amount/…/noteTargets | SQL `set-opportunity-kanban-default.sql` + `ensureOpportunityRuDefaults` (INC-081) + `twenty-client.applyWorkspaceDefaults` |
| Person «Социальные сети» | ✅ LinkedIn + Telegram/WhatsApp/OK/VK/Instagram/Facebook/Threads/**Сайт (website)**; WA business profile fills email + website (+ IG/FB if URLs in profile) | `twenty-client.ensureSocialFields` |
| Вкладка «Чат» после «Главная» | ✅ `position: 15` Person+Opportunity | `page-layout-tabs/*-chat` + `set-chat-tab-position.sql` |

Shared UI: `components/portal/*`, `components/ui/*`, `components/telegram-preview.tsx`.

**Design workflow:** Cursor skill `ui-ux-pro-max` at `.cursor/skills/ui-ux-pro-max/` (`uipro init --ai cursor`). Persist/search via `python3 .cursor/skills/ui-ux-pro-max/scripts/search.py … --design-system`. Tokens stay Twenty light in `globals.css`; synthesized rules in `design-system/voxly/MASTER.md`.

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
| POST | `/checkout`, `/result` | ✅ checkout: `ai_tg_extra_conn`, `ai_gramjs`, `ai_wa`, `ai_topup`, `crm_base`+`extraSeats`, `extra_seat`; **`applyBalanceRub`** (партнёрский баланс → hold → fulfilPaymentTransactional); **idempotent result** (conditional claim); webhook persists `Subscription.extraSeats`; InvId via advisory lock; wallet / extraSlots / referral by resolved rule (productScope + durationMonths enforced) |
| GET | `/success`, `/fail`, `/status` | ✅ success/fail → `/dashboard/crm?paid=ok\|fail` |

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
| GET | `/` (+ subscriberCount, promoPost, aiAddon, gramjsAddon, conversationCount; gift: `telegramDescription` / `telegramShortDescription`) | ✅ |
| PUT | `/:botId/telegram-profile` | ✅ gift: `setMyDescription` + `setMyShortDescription` → `BotInstance` |
| PUT | `/:botId/campaign` (+ `campaignId`, `name`) | ✅ |
| POST | `/:botId/campaigns` (создать проект) | ✅ |
| PATCH | `/:botId/campaigns/:campaignId` (`name`, `isActive`; **один active на бота**) | ✅ |
| GET | `/` → `campaigns[]` + `campaign` (active/newest) | ✅ |
| PUT | `/:botId/promo` (+ `campaignId`) | ✅ |
| POST | `/:botId/media`, `/:botId/promo/publish`, `/:botId/channel/verify` | ✅ |
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
| GET/POST | `/api/crm/chat/:recordId` (+ `/reply`, `/file/:fileId`, `/file/:fileId/signed-url`, `/media/*`) | ✅ Opportunity **или** Person id; link = GiftSubscriber **или** Conversation (gift / `ai_tg` / `ai_gramjs` / `ai_wa`); GET returns `threads[]` + channel/identity labels + optional `presence` (online/lastSeenAt/approx); optional `?conversationId=` / `giftSubscriberId` (reply body too); text+media+MarkdownV2 (GramJS outbound text-only; **inbound media preview** via gramjs: fileIds + WA via Evolution getBase64; **video/audio/documents via HMAC signed URL** — long token via `maxParamLength`+wildcard); **read** on GET (WA/TG Business); **typing only on reply** (not on poll); **marks `lastOperatorReadAt`** on open; auth = portal/crm JWT **или** `VOXLY_SERVICE_TOKEN` + `X-Twenty-Workspace-Id` |
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
| GET | `/accounts` | ✅ list `ai_gramjs` + soft billing warning |
| POST | `/start-trial` | ✅ soft **7d** addon `ai_gramjs` (`TRIAL_PERIOD_DAYS`) + Robokassa `ai_gramjs` |
| POST | `/auth/qr/start` | ✅ |
| GET | `/auth/qr/status`, `/auth/qr/png` | ✅ |
| POST | `/auth/qr/password` | ✅ 2FA |
| POST | `/sessions/connect` | ✅ |

### WhatsApp proxy `/api/bots/whatsapp` (portal JWT → ai-whatsapp-worker + Evolution)
| Method | Path | ✅ |
|---|---|---|
| GET | `/accounts` | ✅ list `ai_wa` (`name`/`displayName` + `slug`) + soft billing + evolutionConfigured; prunes underscore never-connected stubs |
| POST | `/start-trial` | ✅ soft **7d** addon `ai_wa` (`TRIAL_PERIOD_DAYS`) + Robokassa `ai_wa` |
| POST | `/auth/qr/start` | ✅ Evolution instance + QR; persists human `displayName` (Cyrillic OK), ascii slug for Evolution |
| GET | `/auth/qr/status` | ✅ connectionState + QR refresh |
| DELETE | `/accounts/:botId` | ✅ Evolution logout/delete + remove `BotInstance` |

### Admin `/api/admin`
| Method | Path | ✅ |
|---|---|---|
| GET | `/health` | ✅ Postgres/Redis/queues/workers + expiring addons/subs, low wallets |
| GET | `/stats`, `/tenants`, `/tenants/:id`, `/funnels` | ✅ |
| GET | `/crm` | ✅ platform CRM pricing + tenants with Twenty workspaces |
| PUT | `/crm/pricing` | ✅ `PlatformSetting` `crm_base_monthly` / `extra_seat_monthly` (`crm-pricing-settings.ts`) |
| POST | `/tenants/:id/impersonate` | ✅ JWT as tenant owner → portal `/dashboard/crm` |
| POST | `/tenants/:id/crm-login` | ✅ Twenty SSO URL as workspace owner |
| POST | `.../suspend`, `.../pricing`, `.../credit`, `.../ai-credit`, `.../reapply-crm-defaults`, `.../refresh-crm-chat` | ✅ `ai-credit` = manual AI wallet top-up; `refresh-crm-chat` force-reinstalls voxly-crm-chat tarball |
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
| CRM Person/Opportunity + notes | gift-bot-worker + twenty-client | ✅ + custom Person.`telegram` (`@username`); phone → Person.phones when contact shared |
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
| AI Business SKU | PRODUCT_CODES.AI_TELEGRAM + addon gate | ✅ Телеграм Секретарь 1000₽/10; extra `ai_tg_extra_conn` 200₽/slot |
| AI agent SKU | PRODUCT_CODES.AI_AGENT + `config.agentSlots` | ✅ 500₽/slot; create gated 402; grandfather `20260731220000` |
| AI usage by agent + channel | AiUsageLog.aiAgentId + **channel** + GET `/api/ai/agents/usage` | ✅ charge on reply; portal breakdown **byAgent** + **byChannel**; `uncollectedRub` for shortfall tracking |
| AI cost (OpenRouter) | `@voxly/ai-core` `resolveProviderCostRub` | ✅ `usage.cost` → else `GET /models` pricing × tokens → USD×`USD_RUB_RATE`/`usd_rub_rate` → markup; TG+WA workers |
| AI knowledge + sales RAG | AiKnowledge* + AiSalesExample + retrieveAgentContext | ✅ files txt/md/pdf; learn only from won Opportunity stage (`USPESHNAYA_SDELKA` + legacy `CUSTOMER`); inject into LLM prompt |
| Referral default | ReferralRule percent_recurring 20% | ✅ excl. `ai_topup`; webhook `creditReferralForPayment` |
| Referral per-tenant rule + transactions + withdrawals | `referral-program.ts` (резолв правила) + `referral-admin.ts` | ✅ `ReferralRule.tenantId` (индивидуальное правило имеет приоритет над дефолтным); `billing.ts` начисляет по резолвнутому правилу (**productScope** + **durationMonths** enforced); `ReferralTransaction` (`payout`/`manual_credit`/`manual_debit`/`redeem`) — ручные выплаты и корректировки из `/admin/partners`; **`ReferralWithdrawal`** (создание/отмена/approve/reject); **`releaseBalanceHold`** (hold на Payment при checkout, часовой sweep зависших); резолв вынесен из `referral-admin` чтобы разорвать циклическую зависимость |
| `emailWorker` SMTP | queues.ts | ❌ logging stub |
| `notifyHumanOperator` | AI workers | ❌ |
| GramJS bridge | `apps/gramjs-bridge` | 🟡 QR + encrypted session + human 1h pause + soft SKU + `POST /messages/send` (CRM operator); portal via saas-api proxy |
| Skip bot senders | ai-telegram / gramjs / WA | ✅ TG `is_bot` → no AI, no Conversation, no CRM lead; GramJS `User.bot`; WA skip status/newsletter/broadcast |
| GramJS → AI handoff | `POST /internal/inbound` on ai-telegram-worker | ✅ Bearer `VOXLY_SERVICE_TOKEN`; returns bubbles |
| GramJS portal UI | saas-portal `/dashboard/ai/gramjs` | ✅ QR + status + accounts; browser never hits bridge |
| Twenty App SDK deal chat | twenty-app/voxly-crm-chat + `/api/crm/chat` | ✅ tab + format toolbar + multi-📎 (INC-017/018/020 JPEG shrink) + pinned composer (INC-019) + remount (INC-016) + photo preview (INC-014); inject off |
| `installApp` in provisioning | queues + twenty-client | ✅ private `uploadAppTarball` + `installApplication` + set `WORKSPACE_ORIGIN`/`VOXLY_API_URL` (tarball in saas-api image / `VOXLY_CRM_CHAT_TARBALL`) |
| Skip `/install-apps` onboarding | `twenty-client.skipInstallAppsOnboarding` + SQL `clearTwentyOnboardingFlags` | ✅ GraphQL skip (owner + invite) + SQL DELETE all `ONBOARDING_*_PENDING` early/late in provision (INC-080) |
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
