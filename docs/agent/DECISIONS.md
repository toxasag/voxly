# Решения (короткие ADR)

## ADR-027 — Gift-bot portal setup UX = canonical for all tenants

**Статус:** ✅ 2026-08-04

| Вопрос | Выбор |
|---|---|
| Scope | `/dashboard/bots/[botId]` Telegram gift setup for **every** current and new tenant/bot |
| Parity | UX polished on one prod bot is the **standard**, not a one-off; same components + `/:botId` APIs for all |
| Data binding | `useParams().botId` + tenant-scoped `GET/PUT/POST /api/bots/:botId/*` — **no** hardcoded bot/tenant ids |
| Surface | Steps **1** channel → **2** bot profile (dual photos + emoji under preview) → **3** promo → **4** after-start → **5** gift → **6** after-gift → **Дожим**; each with TG preview |
| Inputs | `InputWithEmoji`, `TelegramMdTextarea`, `EmojiPickerPanel`; profile photo via `fileToJpegFile` (PNG/WebP→JPG) |
| Previews | `TelegramPreview` + `telegram-preview-chrome`; media after save via `GET …/media-file?fileId=` (INC-093) |
| Page chrome | Partners amber industrial tokens; **do not** restyle TG preview bubbles into generic dashboard cards |
| Regressions | **Forbidden** without explicit user ask: breaking previews, text/MD input, emoji, media upload/kinds/proxy, dual photos, JPEG profile convert, or introducing per-bot hardcode |
| Code changes | Prefer docs + surgical bugfixes; do not “improve/refactor” preview/text/media paths casually |

**Отклонено:** отдельный UI/флаги под одного клиента; hardcode bot id в portal/API; упрощение превью до placeholder без media-file; уборка emoji/MD «для чистоты».

**Related:** CAPABILITIES «Gift bot detail — canonical UX»; INC-005/086–091/093; ADR-002 (`file_id`); `.cursor/rules/gift-bot-setup-ux.mdc`.

---

## ADR-026 — Web form lead intake (Tilda / WordPress → CRM + attribution)

**Статус:** ✅ Phase 1 MVP (2026-08-03)

| Вопрос | Выбор |
|---|---|
| Surface | Public `POST /api/webhooks/forms/:token` + tenant CRUD `/api/forms/*` |
| Sources | Tilda form-urlencoded (+ `test=test`, COOKIES/TILDAUTM, `tranid`); generic JSON (WP/CF7/Gravity/n8n) |
| Auth | Unguessable `token` in URL; optional shared secret (`X-Voxly-Webhook-Secret` / body / query) |
| Latency | Persist `FormLead` + **200 `ok` immediately**; CRM via BullMQ `form-leads` (Tilda ≤5s) |
| CRM | `@voxly/twenty-client`: Person phone→email dedupe; Opportunity `reuse_open` (default) or `always_new`; note with raw fields/UTM |
| Ambiguous Person | `FormLead.needsReview` + status `needs_review` (no silent merge) |
| Idempotency | `@@unique([tenantId, source, externalId])` (Tilda `tranid` / WP `entry_id`) |
| Analytics | New `AttributionSession` (`clickId=fl_{leadId}`) + `fireGoal('web_form_lead')` — **does not** change gift goals |
| Billing | **Included in CRM base** for Phase 1 (no separate SKU); revisit Phase 3 if needed |
| Portal | Section on `/dashboard/crm` — URL, secret once, last leads, RU instructions |
| Not in scope | Gift funnel, messenger channels, PHP WP plugin, field-mapping UI, `deal_won` hook (Phase 2) |

**Отклонено:** синхронный Twenty sync в webhook handler; отдельный gift-style worker app; хранить prod secrets в git.

**Related:** ADR-014 (agents unrelated); CHAT.md peer→Person rule adapted to phone/email; analytics-dispatchers `fireGoal`.

---

## ADR-025 — MAX messenger: personal (`ai_max`) + gift Phase 2

**Статус:** 🟡 Phase 1 scaffold + Phase 2 gift in progress (2026-08-03)

| Вопрос | Выбор |
|---|---|
| Personal MAX | Python sidecar `apps/max-bridge` (PyMax / `maxapi-python` ≥3.10), **not** inside `gramjs-bridge` |
| `botType` personal | `ai_max` |
| Conversation personal | `platform=max`, `channel=max_personal` |
| SKU personal | `ai_max` — 500 ₽/мес, soft trial 7d (как `ai_gramjs`) |
| Referral personal | в `REFERRAL_COMMISSION_SKUS` |
| Auth personal | QR via `WebClient` + custom `QrHandler` → portal; SMS fallback later |
| Session personal | SQLite per bot on volume + marker in `BotInstance.botTokenEncrypted` |
| Inbound personal | bridge → `POST /api/internal/max/inbound` → Conversation + ChatMessage + CRM sync |
| CRM reply personal | `crm-chat` → `max-bridge` `POST /messages/send` (text-only MVP) |
| AI agent | Phase 3 (ADR-014 OFF by default; messages always stored) |
| **Gift MAX** | `botType=gift_max`; **SKU `gift_bot_max`** (отдельный продукт от Telegram `gift_bot`); 500 ₽/слот; portal `/dashboard/bots/max`; official Bot API `platform-api2.max.ru` |
| Gift Conversation | `platform=max`, `channel=max_gift`; `GiftSubscriber.telegramId` = MAX user id (string peer) |
| Gift worker | extend `gift-bot-worker`: webhook `/max/{tenantId}/{botId}` + local long-poll |
| Gift channel check | **gap**: TG `getChatMember` equivalent may be limited — MVP: callback «Продолжить» / skip strict membership; document in CAPABILITIES |
| Disclaimer personal | UI: неофициальный user API (риск бана / breaking changes) |

**Отклонено:** пихать PyMax в Node gramjs-bridge; один SKU на TG+MAX; unlimited gift на аккаунт; sales LLM на gift MAX.

**Related:** ADR-014 (agents OFF), CHAT.md golden path, GramJS as personal-TG эталон.

---

## ADR-024 — Release verification: local DB tests + hybrid gate

**Статус:** ✅ 2026-08-02

| Вопрос | Выбор |
|---|---|
| Contour | Local `voxly_test` on postgres-control; **no** separate staging for now |
| Automate first | Money (webhook/wallet/balance), tenant isolation, status transitions |
| Manual / hybrid | Integrations with live TG/WA/Robokassa; client acceptance |
| API test entry | `export buildServer()` + `app.inject()`; `VOXLY_DISABLE_WORKERS=1` |
| Scheduler multi-replica | Redis NX lock (`withSchedulerLock`); fail-open if Redis down |
| OutSum | Must match `Payment.amount` (net cash) or ResultURL rejected |
| ai_tg / gift trial | One-shot via `startChannelTrial` + `trialConsumed` |
| Agent slots | `resolveAgentCapacity` **read-only** on GET (grandfather = migration) |
| Gate command | `pnpm verify`; CI `.github/workflows/ci.yml`; methodology `RELEASE-CHECKLIST.md` |

**Отклонено:** full e2e of every surface before money tests; prod load testing; staging on the same VPS as prod.

---

## ADR-023 — Hard CRM lock when subscription ends

**Статус:** ✅ 2026-07-30

| Вопрос | Выбор |
|---|---|
| Source of truth | `evaluateCrmAccess()` in `@voxly/shared` (same rules as scheduler) |
| Trial end | lock immediately (`periodMonths===0`, endsAt &lt; now) |
| Paid end | `GRACE_PERIOD_DAYS` (7) still open; then lock |
| Tenant `suspended`/`cancelled` | lock (overrides in-grace) |
| Portal SSO | `GET /api/tenant/crm-login` → **402/403** + `crmAccessLocked` |
| Portal UI | `/dashboard/crm` paywall; «Открыть CRM» disabled; invite blocked |
| CRM chat | service token + portal/crm JWT + signed `/media/*` gated |
| Direct Twenty login | reversible `core.workspace.activationStatus=INACTIVE` on suspend; `ACTIVE` on Robokassa `crm_base` renew |
| Restore | ResultURL sets tenant `active` + new sub → unlock Twenty |

**Отклонено:** удаление workspace/данных при suspend; блокировка всего ЛК (оплата должна оставаться доступной).

**Остаточный gap:** уже выданный Twenty session JWT может жить до истечения/refresh; UI workspace INACTIVE + chat API 403 закрывают practically. Не тестировать lock на prod `john` без mock/local.

---

## ADR-022 — CRM member delete = remove from Twenty + reassign owner

**Статус:** ✅ 2026-07-30

| Вопрос | Выбор |
|---|---|
| Portal delete `/dashboard/crm` | `DELETE /api/tenant/members/:id` |
| Voxly | delete `TenantMember` (frees seat); User row kept if other tenants |
| Twenty | `deleteUserFromWorkspace(workspaceMemberId)` as owner |
| Deals | `opportunity.ownerId` → owner workspaceMember (if set) |
| Tasks | `task.assigneeId` → owner |
| People / companies | **остаются** в workspace (нет owner-поля; Twenty docs: data stays) |
| createdBy | не переписываем (аудит) |
| Invite onboarding | after `signUpInWorkspace` → member session `skipInstallAppsOnboarding` |

**Отклонено:** только удалять Voxly seat (CRM доступ оставался); hard-delete Person rows.

---

## ADR-021 — Inbound media understanding = platform default (all channels)

**Статус:** ✅ 2026-07-26

| Вопрос | Выбор |
|---|---|
| Scope | TG Business, GramJS, WhatsApp, Gift inbound CRM |
| Enablement | **Worker-global** when `OPENROUTER_API_KEY` set — **no per-tenant feature flag** |
| Shared code | `@voxly/ai-core`: `extractAudioFromVideo`, `extractDocumentText`/`formatDocumentAiText`, `MEDIA_INBOUND_HINT` |
| Caps | Video ASR ≤20MB / ≤180s; docs ≤15MB / ≤25k chars |
| Tags | `[голос]` / `[кружочек]` / `[видео]` / `[фото]` / `[документ PDF\|DOCX]:` |
| Gift | Funnel does **not** sales-LLM; still enriches `ChatMessage` for operators; `ai_tg` → telegram-worker |
| New portals | Provision `ensureCrmChatAppInstalled({ forceReinstall: true })` ships latest crm-chat; media extract is server-side (workers), not app-gated |

**Отклонено:** per-tenant «enable media AI» toggle; legacy `.doc` (non-docx).

---

## ADR-001 — Чат в карточке Сделки / Контакта (Twenty 2.22)

**Статус:** ✅ 2026-07-20 Apps SDK tab (inject disabled, file kept for rollback)

| Вопрос | Выбор |
|---|---|
| Host UI | `definePageLayoutTab` «Чат» на `personRecordPage` + `opportunityRecordPage` (`twenty-app/voxly-crm-chat`) |
| Front | `defineFrontComponent` ChatPanel → `RestApiClient` `/s/crm-chat/:recordId` (+ `/reply`) |
| Logic | `get-crm-chat` / `reply-crm-chat` proxy → saas-api |
| Auth (SDK) | `VOXLY_SERVICE_TOKEN` (server var) + `X-Twenty-Workspace-Id` (из JWT `TWENTY_APP_ACCESS_TOKEN`) → Tenant via `twentyWorkspaceId` |
| Auth (legacy inject) | `GET /api/tenant/crm-login` → `chatToken` (отключён: `DISABLE_FLOATING_CHAT=true`) |
| SoT сообщений | Control Prisma `Conversation` / `ChatMessage` |
| Lookup | `GiftSubscriber.twentyOpportunityId` **или** `twentyPersonId` |
| API | `GET/POST /api/crm/chat/:recordId` (+ `/reply`, `/file/:fileId`) |
| Media | inbound TG `file_id` preview; outbound **multi-📎** → sequential multipart `/reply` (API limit 1 file) |
| Format | client Markdown → MarkdownV2; UI: **always-visible format toolbar** (ПКМ abandoned — Remote DOM); без `.focus()` |
| Composer | format toolbar + textarea + right stack Прикрепить→Отправить; multi-file chips; **Enter = newline**, **⌘/Ctrl+Enter = send** (INC-022) |
| Media preview | logic JPEG compress before base64 (INC-014); photo/sticker `<img>` |
| SoT UX reference | parity with inject `docker/twenty-deal-chat.js` (format + attach + media preview) |
| CRM create | Twenty 2.22: `createPerson(data:)` / `createOpportunity(data:)` |
| Dedup Person | reuse by `telegramId` / gift / `findPersonByHint` / **`findPersonByPhone`** (phones + `whatsapp`, cross-channel TG↔WA, INC-044); ambiguous → `needsReview` |
| Person.telegram | custom TEXT field; value `@username` |

**Отклонено как SoT:** custom ChatMessage objects в Twenty; Telethon user-session messenger.

**Rollback:** `docker/twenty-deal-chat.js` → `DISABLE_FLOATING_CHAT = false` + rebuild Twenty front; SDK app uninstall via `yarn twenty app:uninstall`.

---

## ADR-019 — Stories mailing (GramJS send; WA/Business explicit unsupported)

**Статус:** 2026-07-26  

| Вопрос | Выбор |
|---|---|
| Storage | Same `Broadcast` with `messageJson.channel='story'` + `storyVia` |
| GramJS | Bridge `POST /stories/send` → uploadFile + `stories.SendStory` (InputPeerSelf, AllowAll) |
| WhatsApp / ai_tg | Schedule/edit/preview OK; worker marks `failed` + `stories_unsupported_*` until Evolution/Bot API exists |
| Billing | Addon `mailing_stories` 1000₽/мес + one-shot trial (`TRIAL_PERIOD_DAYS`) |

---

## ADR-018 — «Рассылка» в Twenty CRM (FOLDER + in-app pages, reuse Broadcast)

**Статус:** amended 2026-07-26 (folder UX + stage trigger)  

| Вопрос | Выбор |
|---|---|
| CRM UI | Expandable `FOLDER` «Рассылка» + **4** child `PAGE_LAYOUT` STANDALONE_PAGE front-components (crm-chat ≥0.1.18): **Бот**, **Аккаунты**, **Сторис**, **По этапу сделки**. In-CRM only — **не** portal LINK |
| Bot / accounts / stories | Reuse `Broadcast` + gift-bot-worker scanner; schedule via `datetime-local` → `scheduledAt`; edit `PATCH` while `scheduled`; duplicate = prefill create |
| Accounts | One page, GramJS/WA toggle; billing `mailing_accounts` |
| Stories | Media URL + caption; GramJS send (ADR-019); billing `mailing_stories` |
| Stage trigger | `MailingStageRule` + `POST …/stage-rules/fire`; Twenty LF `opportunity.updated` (stage); send via Broadcast `subscriberIds` (worker filter). Gift-bot linked by `twentyOpportunityId` |
| Billing / trial | mailing_*; trial from each panel; pay → Кабинет Voxly |
| Attribution | unchanged |

**Отклонено:** portal LINK / FOLDER+https as primary CRM UX.  
**Отклонено:** rewrite `processBroadcast` (only additive `subscriberIds` / `conversationIds` filters).

**Portal:** `/dashboard/mailing*` остаётся для кабинета.

---

## ADR-009 — «Кабинет Voxly» в сайдбаре Twenty

**Статус:** обновлено 2026-07-20  

В Twenty нет native «назад в Voxly».  
**Сейчас:** Twenty Apps SDK `defineNavigationMenuItem` (`NavigationMenuItemType.LINK`) — пункт «Кабинет Voxly» в «Рабочая область» → portal `/dashboard` (`cabinet-voxly.ts`).  
**Legacy inject:** `docker/twenty-cabinet-link.js` → `/voxly-cabinet.js` отключён (`DISABLE_FLOATING_CABINET=true`); файл оставлен для rollback / rebuild.  
URL в манифесте локальный (`http://localhost:3001/dashboard`); для prod менять `link` перед apply.  
**Related:** ADR-018 — in-CRM «Рассылка» PAGE_LAYOUT (cabinet LINK remains separate).

---

## ADR-010 — Twenty shell UX: no create-workspace + Сделки kanban defaults

**Статус:** ✅ 2026-07-21 (расширен: ширина колонок, карточка, заметки, вкладка Чат)

| Вопрос | Выбор |
|---|---|
| Create workspace in CRM ⋯ menu | Hide via inject `docker/twenty-shell-ux.js` → `/voxly-shell-ux.js` (RU/EN labels). Workspaces come from Voxly provisioning only. |
| Default Opportunities views | INDEX = **Канбан** (KANBAN); secondary = **Списком** (TABLE/`IconList`). Seeded TABLE INDEX → promote **By Stage** via SQL (`set-opportunity-kanban-default.sql`). GraphQL `updateView` cannot set `key`; type/icon often land in `overrides` — SQL must strip KANBAN overrides on the list view or UI shows fake kanban «All Сделки». Do not GraphQL-convert INDEX when a separate board exists. |
| Kanban column width | **320** via `view.kanbanColumnWidth` + `overrides.kanbanColumnWidth` (`docker/set-opportunity-kanban-card-defaults.sql` + `ensureOpportunityKanbanDefault`). |
| Kanban card fields | name, createdAt, amount, createdBy, closeDate, company, pointOfContact, taskTargets, noteTargets — positions/sizes in `OPPORTUNITY_KANBAN_CARD_FIELDS` (`twenty-client`). |
| Note on kanban card | Note `labelIdentifier` = **title** (TEXT). `bodyV2` is RICH_TEXT → `[object Object]` if used as label (INC-021). Body mirrored into `title` via SQL trigger + backfill; `createNoteForPerson` sets title←body. Latest note first via `noteTarget.position` (ASC). Shell-ux clamps ≈5 lines. |
| Person social fields | `ensureSocialFields` in `applyWorkspaceDefaults`: Telegram + WhatsApp + OK + VK + Instagram + Facebook + Threads (TEXT) next to LinkedIn. WA sync fills `whatsapp` (+phones). Opportunity: no social group → skip. |
| Inbound left toast | Host `twenty-shell-ux.js` polls `GET /api/crm/chat/inbound-toasts` with `voxlyChatToken` (~4s). Not true push (Remote DOM has no host timers for front components). |
| Unread chat badges | **Unread** = `ChatMessage.role=user` with `sentAt > Conversation.lastOperatorReadAt` (null = never opened in CRM Chat). Mark-read on `GET /api/crm/chat/:recordId` for **all** conversations linked to the Person/Opportunity (not only the active thread). Counts aggregated by `twentyPersonId` / `twentyOpportunityId` (+ gift links). Shell-ux polls `GET /unread-badges` (~8s) and paints **one** overlay badge per card/row (board title host; no nested field/chip duplicates) + «Чат» tab — no Twenty custom NUMBER field. Existing conversations backfilled `lastOperatorReadAt` on migrate so deploy does not flood historical counts. |
| «Кабинет Voxly» once | SDK `cabinet-voxly.ts` (`position: 6`, after Notes) + shell dedupe + `docker/dedupe-cabinet-nav.sql`. Floating inject stays off. |
| Sidebar order | **Сделки → Люди → Компании → Рассылка → Задачи → Заметки → Кабинет Voxly → Workflows → Панели** (`ensureWorkspaceNavOrder` + `docker/set-workspace-nav-order.sql`; SDK `mailing-folder` pos 3, `cabinet-voxly` pos 6). |
| Onboarding | Skip install-apps / sync-email / invite / connect-account via `clearTwentyOnboardingFlags` + GraphQL skip. **Keep** `ONBOARDING_CREATE_PROFILE_PENDING` so owner enters ФИО on first CRM open. Existing workspaces: `syncOwnerProfileFromControlDb` fills empty `workspaceMember` from Voxly `User.firstName/lastName`. |
| Redis after SQL | `flushTwentyWorkspaceRedisCache` after provision / `reapply-crm-defaults` (INC-086 blank kanban). |
| «Чат» tab order | `position: 15` (after Home=10, before Timeline=20) in `page-layout-tabs/*-chat.page-layout-tab.ts` + `docker/set-chat-tab-position.sql`. |
| New workspace provisioning | `applyWorkspaceDefaults` + `ensureOpportunityRuDefaults` + `ensureOpportunityKanbanCardDefaults` (title←body triggers + noteTargets width) + `ensureWorkspaceNavOrder` + `clearTwentyOnboardingFlags` (CREATE_PROFILE kept) + `syncOwnerProfileFromControlDb` + `flushTwentyWorkspaceRedisCache` in `queues.ts`. |
| Persistence | Scripts baked in `docker/twenty.Dockerfile`; hot-patch survives until container recreate — then rebuild image or re-copy + re-sed `index.html`. |

**Re-apply after Twenty recreate:**
1. Rebuild `voxly-twenty:2.22.0` **or** `docker cp docker/twenty-shell-ux.js …/voxly-shell-ux.js` + ensure `<script src="/voxly-shell-ux.js">` in `index.html` (API URL must be sed'd).
2. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-default.sql`
3. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-card-defaults.sql`
4. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-chat-tab-position.sql`
5. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/dedupe-cabinet-nav.sql`
6. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-workspace-nav-order.sql`
7. `POST /api/admin/tenants/:id/reapply-crm-defaults` (social + kanban + nav + redis flush)
8. Re-apply chat app if needed: `yarn twenty apply --remote <ws> --force`

### New CRM portal checklist (must match john / ADR-010)

1. Provision job completes: `twentyWorkspaceId` set, chat app installed.
2. Onboarding: `/install-apps` skipped; **first CRM open shows /create/profile (ФИО)** unless Voxly User already has names (`syncOwnerProfileFromControlDb`).
3. Sidebar: Сделки · Люди · Компании · Рассылка · Задачи · Заметки · Кабинет Voxly · Workflows · Панели.
4. Сделки INDEX = **Канбан** `type=KANBAN` + 6 stage `viewGroup` rows; secondary **Списком** TABLE.
5. After SQL view/nav fix: Redis flat-map flush + `metadataVersion` bump.
6. Hard-refresh `{slug}-crm.getvoxly.ru` — kanban columns visible, cabinet opens portal.

---

## ADR-002 — Медиа через Telegram `file_id`

Не хранить обязательный публичный HTTPS URL.  
`POST /api/bots/:botId/media` → upload в TG → `{ fileId, mediaType }`.  
Promo/funnel: `telegramFileId` (+ legacy `mediaUrl`/`imageUrl`).  
Send: `sendPhoto`/`sendVideo`/`sendDocument` по kind (`AgAC`→photo, `BAAC`→video, `BQAC`→document, …).

**Quality (INC-094):** photo/video staging uses `sendDocument` first so `file_id` keeps original bytes; stored `mediaType` stays `photo`/`video`. Delivery downloads (`getFile` ≤20 МБ) then `sendPhoto`/`sendVideo` (one TG compress at publish/send). Avatar still PNG/WebP→JPEG via portal `fileToJpegFile` only.

---

## ADR-003 — Username child gift-бота

Паттерн: `voxly_{slug}_{01}_bot` (`buildVoxlyBotUsername`).  
Не cuid/nanoid. Manager Bot отдельно: `@VoxlyGiftbot`.

---

## ADR-004 — Чат: портал vs CRM notes

Сейчас: операторский чат **в портале**; в CRM — notes на Person.  
Custom Twenty ChatMessage objects **не** ставятся.  
Будущий CRM UI = ADR-001 (тот же Prisma SoT).

---

## ADR-005 — Control plane ≠ Twenty DB

Две PostgreSQL. Биллинг/боты/чат в control; CRM-сущности в Twenty через GraphQL.  
Provisioning создаёт workspace; SSO через `/api/tenant/crm-login`.

---

## ADR-006 — Локальный Telegram = polling

Без публичного HTTPS webhook: `GIFT_BOT_USE_POLLING` / `MANAGER_USE_POLLING`.  
Webhook path prod: `/tg/{tenantId}/{botId}` (gift), manager labels на Traefik.

---

## ADR-007 — Client Markdown

В портале клиентский MD (`**`, `__`, `~~`, `||`, code) → при send/publish `MarkdownV2` (`telegram-md.ts`).  
Превью: `TelegramPreview`.

---

## ADR-008 — Проект = GiftCampaignConfig (не бот)

**Статус:** принято 2026-07-18  

| Сущность | Смысл |
|---|---|
| **Бот** | Telegram-аккаунт (`BotInstance`) |
| **Проект** | `GiftCampaignConfig`: имя, канал, подарок, воронка, promo, `isActive`, своя статистика |

- У одного бота много проектов; **одновременно активен только один** (`isActive`).
- Включение проекта выключает остальные на этом боте (API + UI Switch).
- Deep-link `?start=g_{campaignId}` → только **активный** проект.
- Bare `/start` → единственный активный проект бота.
- Сделка в CRM: `@user · {проект} · @{bot} · @{channel}`.
- UI: блок «Проекты» на `/dashboard/bots/[botId]`; API `POST/PATCH .../campaigns`.

---

## ADR-011 — Product parity gaps (accepted intent 2026-07-21)

**Статус:** 🟡 partially done (chat auto-install ✅ 2026-07-22; seats + SQL triggers still TODO)

| Требование | Сейчас | Нужно |
|---|---|---|
| Seats 1/10 | Считает `TenantMember` (Voxly `/invite`). Twenty «Пригласить пользователя» **не** учитывается. | Счётчик и лимит = **участники CRM workspace** (Twenty). Extra seat = доп. CRM user (300 ₽). Инвайт из CRM должен отражаться в портале / блочить на 10. |
| «Чат» app | **Auto-install on provision:** private `uploadAppTarball` + `installApplication`, then set `WORKSPACE_ORIGIN` / `VOXLY_API_URL`. Tarball baked into saas-api image. | Keep CLI apply for hotfixes; optional re-install on gift-bot activate. |
| Defaults = test2 | `applyWorkspaceDefaults`: ru-RU + RU object labels (`isLabelSyncedWithName:false`) + kanban/notes; `skipInstallAppsOnboarding` on provision. `ensureOpportunityKanbanCardDefaults` installs title←body triggers on provision + reapply. | — |

**Telegram → Person fields (visibility):** Bot API отдаёт только id/username/first_name. Телефон / «О себе» / ДР / канал — через **GramJS** `users.GetFullUser` (`POST gramjs-bridge/users/full`), если у тенанта есть активный `ai_gramjs` и privacy/контакты это показывают. Маппинг: phone→`phones`, about→`about`, birthday→`birthday` (DATE), names, channel→`website`, username→`telegram`.

**On GramJS connect (all portals):** bridge → `POST /api/internal/gramjs/connected` → BullMQ `gramjs-crm-enrich` → `runTelegramCrmEnrich`: сканирует gift + telegram Conversations с `twentyPersonId`, обогащает, **soft-merge** дублей по телефону (перенос GiftSubscriber/Conversation на canonical Person + notes; при >2 матчах `needsReview`). Новые лиды после connect: gift/AI sync вызывают enrich на create. Manual: `POST /api/admin/tenants/:id/enrich-telegram-profiles` (`async:true` = queue).

**Bot outbound media in CRM chat:** fixed INC-024 (2026-07-22) — `logBotOutbound` stores `attachments`.

---

## ADR-012 — Prod edge = NPM + Traefik :8880 (2026-07-22)

**Статус:** ✅ deployed on `150.241.98.135`

| Вопрос | Выбор |
|---|---|
| TLS / :80/:443 | Existing **Nginx Proxy Manager** (`automation-npm-1`) |
| Internal router | Traefik **v3.6.6** on host **8880** (HTTP only); no websecure; no HTTP→HTTPS redirect |
| Why ≥3.6.1 | Docker Engine 29 min API 1.44 breaks Traefik ≤3.5 docker provider |
| Networks | Traefik on `docker_voxly-net` + external `automation_automation_net` |
| Portal LB port | **3000** (Dockerfile `PORT=3000`; base compose label 3001 was wrong for prod) |
| Host rules | `Host(a) \|\| Host(b)`; wildcards = Go `HostRegexp` |
| Compose files | `docker-compose.yml` + `docker-compose.prod-npm.yml`; **never** local override on prod |
| Data | Named volumes only; never `-v` on prod |

---

## ADR-013 — Safe prod deploy via whitelist scripts (2026-07-22)

**Статус:** ✅ process in repo (scripts run from laptop → `/opt/voxly`)

| Вопрос | Выбор |
|---|---|
| Transport | `rsync` **only** through `scripts/prod-deploy.sh` (git pull on VPS deferred — no deploy key yet) |
| Drift check | `scripts/prod-diff.sh` (sha256 hot files) |
| Backup | `pg_dump -Fc` control + twenty → `/opt/voxly/backups/<stamp>/` before rebuild |
| Compose | `docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env up -d --build` |
| Forbidden | `-v`, local `.env` sync, `override.yml`, ad-hoc multi-file rsync into one parent dir |
| Docs | `docs/agent/DEPLOY.md`, `docs/agent/ENVIRONMENTS.md`, rule `prod-deploy-updates.mdc` |

**Why not full-tree rsync:** Dockerfile build contexts are per-service; accidental flatten already wiped landing `page.tsx`. Whitelist keeps relative paths.

---

## ADR-014 — Channels vs AI agents; default AI OFF (2026-07-23)

**Статус:** ✅ locked (заказчик 2026-07-23)

### Product surfaces (separate — not one «Автоматизация чатов» blob)

| Surface | Что это | SKU / note |
|---|---|---|
| **GramJS** | Личный Telegram → CRM (как WA); UI «Telegram» | `ai_gramjs` 500 ₽/акк |
| **WhatsApp** | Connected accounts (Evolution QR) | `ai_wa` 500 ₽/акк |
| **Gift bot** | Бот выдачи подарков | unchanged |
| **Телеграм Секретарь** | BotFather + Business Mode token; ≤10 Business-аккаунтов; UI `/dashboard/ai` | `ai_tg` 1000 ₽/10; extra `ai_tg_extra_conn` 200 ₽/слот |
| **AI-агенты** | Ортогональный слой: prompt/settings на любой канал | **`ai_agent` 500 ₽/слот** (addon `config.agentSlots`) + wallet usage за ответы |

### Assignment model

- `AiAgent` — tenant-scoped (name, systemPrompt, settings, status).
- `BotInstance.defaultAiAgentId` (nullable) — account-level default.
- `Conversation.aiAgentId` (nullable) — chat override; wins over account default.
- **Both null → AI OFF.** Messages + CRM lead still stored; no LLM reply.
- Handoff `aiDisabled` / `pausedUntil` / mode still apply **when** an agent is assigned.

### Default-off (BREAKING vs older TZ)

| Было (v0.2–0.3) | Стало |
|---|---|
| Подключение канала → AI ON | Подключение → AI **OFF** until explicit agent assign |
| GramJS inside Business card | Separate «Аккаунты / каналы» vs Business vs «AI-агенты» |

**Migration soft:** existing conversations keep `aiAgentId` null → AI stops until tenant assigns an agent. No mass-enable.

**Portal paths (minimal churn):** Business `/dashboard/ai`; GramJS `/dashboard/ai/gramjs`; WhatsApp `/dashboard/ai/whatsapp`; agents `/dashboard/ai/agents`.

### WhatsApp transport (2026-07-23)

**ONE stack:** Evolution API (Baileys QR) via `evolution-api` compose profile `whatsapp` + `ai-whatsapp-worker`. Meta Cloud API path retired (do not dual-run). Env: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `AI_WHATSAPP_WORKER_URL`, `AI_WHATSAPP_WEBHOOK_URL`.

### WhatsApp LID → E.164 (2026-07-26, INC-059)

**Prod today (2026-07-26):** `voxly-evolution-api:v2.3.7-lid` (`FROM evoapicloud/evolution-api:v2.3.7` + PR #2544 `@lid` bypass on ~150 dist chunks). Expect `remoteJidAlt`/`senderPn` on newer inbound; WhatsApp **client** lidMapping is still separate from phone address book. Avoid `v2.4.0` until licensing accepted.

**Worker policy:** accept PN only from webhook fields / shared vCard / explicit Contact|Chat row fields. Do **not** invent via avatar/pushName (default). Opt-in only: `WA_LID_AVATAR_PHONE_MATCH=1`.

**Upgrade (required for reliable phones):**
1. Target image `evoapicloud/evolution-api:v2.3.7` (stable; Baileys LID mapping + remoteJidAlt). Re-apply `@lid` send bypass in Dockerfile if still needed (native in 2.4.0-rc2).
2. Avoid `v2.4.0` until Evolution Foundation **licensing** activation is accepted.
3. Deploy: backup → change Dockerfile `FROM` / compose tag → `./scripts/prod-deploy.sh evolution-api,ai-whatsapp-worker` (**no** `-v`). Risk: Baileys session may need QR re-scan; Postgres volumes must persist.
4. After upgrade: smoke inbound LID chat → log `phone resolved source=webhook` with `remoteJidAlt`/`senderPn`.

---

## ADR-015 — AI provider cost from OpenRouter (2026-07-25)

**Статус:** ✅ locked

### Was
Hardcoded USD/1M table in workers + average input/output × `total_tokens` × fake `×100` FX.

### Now
1. Prefer OpenRouter response `usage.cost` (credits ≈ USD).
2. Else cache `GET /api/v1/models` (~1h) → `prompt_tokens × pricing.prompt + completion_tokens × pricing.completion`.
3. USD→RUB: env `USD_RUB_RATE` > platformSetting `usd_rub_rate` > 90.
4. Then existing markup (`ai_markup_percent` / tenant override) → `AiWallet` + `AiUsageLog`.

Shared helper: `@voxly/ai-core` `resolveProviderCostRub`. No hardcoded model price lists in workers.

---

## ADR-016 — Agent knowledge base + learn from won deals (2026-07-25)

**Статус:** ✅ locked

### Knowledge
- Per-agent files: `.txt` / `.md` / `.pdf` ≤10 МБ → extract → chunk → OpenRouter embeddings → `AiKnowledgeChunk`.
- Portal upload/delete; storage volume `ai-knowledge-data`.

### Learning
- **Only successful CRM deals**: Conversation linked Opportunity stage ∈ `wonStages` (default `USPESHNAYA_SDELKA` + legacy `CUSTOMER`).
- Extract `user`→`operator` pairs (not AI assistant turns) → `AiSalesExample`.
- Scheduler ~10 min + portal «Обновить обучение».
- Not every operator reply; not fine-tune.

### Runtime
`retrieveAgentContext` + `formatRagPromptBlock` injected into TG/WA system prompt before LLM.

---

## ADR-017 — Opportunity board golden path = john-crm (2026-07-26)

**Статус:** ✅ locked (заказчик: john-crm Сделки view)

### SoT
`https://john-crm.getvoxly.ru/objects/opportunities` INDEX view **Канбан** (`viewId` example `26f24648-…`).

### Must match on every new workspace (provision + `reapply-crm-defaults`)
| Setting | Value |
|---|---|
| Object labels | Сделка / Сделки, `isLabelSyncedWithName=false` |
| INDEX view | name **Канбан**, type KANBAN, IconLayoutKanban, key INDEX |
| Secondary view | **Списком**, TABLE, IconList |
| openRecordIn | SIDE_PANEL |
| kanbanColumnWidth | 320 (overrides) |
| Card fields | name, createdAt, amount, createdBy, closeDate, company, pointOfContact, taskTargets, noteTargets (sizes as `OPPORTUNITY_KANBAN_CARD_FIELDS`) |
| Stages | **Locked:** Новый лид `NOVYY_LID`, Успешная сделка `USPESHNAYA_SDELKA`, Сделка провалена `SDELKA_PROVALENA` (PG trigger restores if Settings edits). **Editable:** Screening / Meeting / Proposal + any custom middle stages |

### Implementation
- SQL/TS: `ensureOpportunityRuDefaults` (PG enum RENAME/ADD + merge locked options + `viewGroup`) + trigger `trg_voxly_lock_opportunity_stage_options` + `docker/set-opportunity-kanban-default.sql`
- GraphQL: `applyWorkspaceDefaults` / `ensureOpportunityKanbanDefault` (card fields + list rename)
- Won-learn default stages: `USPESHNAYA_SDELKA` (+ `CUSTOMER` legacy)

### Chat defaults on new portals
- **Yes (product UX):** `voxly-crm-chat` auto-install on provision (tab «Чат», composer, AI bar, presence) — latest tarball (**0.1.23+**: operator name from Twenty member, not «Менеджер»).
- **Yes (runtime):** WA/TG debounce, typing, CRM sync — code defaults in workers (`CHAT.md`), not per-tenant CRM settings.
- **Yes (shell, all workspaces):** baked `voxly-shell-ux.js` — hide create-workspace; «CRM · {slug}» + «Вы: {member}»; toasts/badges.
- **Yes (portal):** every tenant gets `/dashboard/crm` (trial/seats/invite/paywall ADR-023); members land on CRM portal only.
- **Yes (invite):** Twenty member + `skipInstallAppsOnboarding`; credentials stored encrypted for reveal/edit.
- **No (tenant content):** john’s AI agents / prompts / channel bindings are **not** copied — each tenant configures agents (ADR-014 default OFF).
---

## ADR-020 — Portal UI = shadcn indigo (2026-07-26)

**Статус:** ✅ (branch `ui/indigo-shadcn-dashboard`)

| Вопрос | Выбор |
|---|---|
| Theme | shadcn classic **indigo** primary (`226.5 70.7% 40.2%`) on zinc neutrals in `globals.css` |
| Radius | `--radius: 0.5rem` (demo-like), not Twenty 18px pills |
| CTAs | `Button` default/solid → `bg-primary` indigo |
| Legacy tokens | `ink/canvas/paper/hairline/mid-gray/ember` aliased → semantic for gradual cleanup |
| Shell | Sidebar tokens + indigo accent active; mobile `Sheet` |
| Scope | Landing + auth/legal + all `dashboard/*` + admin + portal components |

**Отклонено:** Twenty-light ink CTAs as long-term SoT.
