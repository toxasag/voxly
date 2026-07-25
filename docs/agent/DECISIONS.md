# Решения (короткие ADR)

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

## ADR-009 — «Кабинет Voxly» в сайдбаре Twenty

**Статус:** обновлено 2026-07-20  

В Twenty нет native «назад в Voxly».  
**Сейчас:** Twenty Apps SDK `defineNavigationMenuItem` (`NavigationMenuItemType.LINK`) — пункт «Кабинет Voxly» в «Рабочая область» → portal `/dashboard` (`cabinet-voxly.ts`).  
**Legacy inject:** `docker/twenty-cabinet-link.js` → `/voxly-cabinet.js` отключён (`DISABLE_FLOATING_CABINET=true`); файл оставлен для rollback / rebuild.  
URL в манифесте локальный (`http://localhost:3001/dashboard`); для prod менять `link` перед apply.

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
| «Кабинет Voxly» once | SDK `cabinet-voxly.ts` + shell dedupe + `docker/dedupe-cabinet-nav.sql`. Floating inject stays off. |
| «Чат» tab order | `position: 15` (after Home=10, before Timeline=20) in `page-layout-tabs/*-chat.page-layout-tab.ts` + `docker/set-chat-tab-position.sql`. |
| New workspace provisioning | **Target = parity with test2/john.** `applyWorkspaceDefaults` (kanban + card fields + note title label + **social fields**) runs on provision. **Still TODO:** (1) run note title-sync + latest-first SQL triggers for new schema automatically; (2) seats counter = Twenty CRM workspace members (not only Voxly TenantMember). |
| Persistence | Scripts baked in `docker/twenty.Dockerfile`; hot-patch survives until container recreate — then rebuild image or re-copy + re-sed `index.html`. |

**Re-apply after Twenty recreate:**
1. Rebuild `voxly-twenty:2.22.0` **or** `docker cp docker/twenty-shell-ux.js …/voxly-shell-ux.js` + ensure `<script src="/voxly-shell-ux.js">` in `index.html` (API URL must be sed'd).
2. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-default.sql`
3. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-card-defaults.sql`
4. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-chat-tab-position.sql`
5. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/dedupe-cabinet-nav.sql`
6. `POST /api/admin/tenants/:id/reapply-crm-defaults` (social fields + kanban GraphQL)
7. Re-apply chat app if needed: `yarn twenty apply --remote <ws> --force`

---

## ADR-002 — Медиа через Telegram `file_id`

Не хранить обязательный публичный HTTPS URL.  
`POST /api/bots/:botId/media` → upload в TG → `{ fileId, mediaType }`.  
Promo/funnel: `telegramFileId` (+ legacy `mediaUrl`/`imageUrl`).  
Send: `sendPhoto`/`sendVideo`/`sendDocument` по kind (`AgAC`→photo, `BQAC`→document, …).

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
| Defaults = test2 | `applyWorkspaceDefaults`: ru-RU + RU object labels (`isLabelSyncedWithName:false`) + kanban/notes; `skipInstallAppsOnboarding` on provision. SQL triggers still manual. | Каждый новый workspace сразу: + **title←body triggers** без ручного SQL. |

**Telegram → Person fields (visibility):** Bot API **не** отдаёт email/ДР из профиля. Телефон — если пользователь нажал «поделиться контактом» (воронка `collect_phone` / Business contact) **или** GramJS видит `Api.User.phone` (контакты/privacy). Пишем в `Person.phones`; AI sync также **ищет** существующий Person по телефону/`whatsapp` перед create (INC-044). Email/ДР → ручной ввод в CRM.

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
| **GramJS** | Личный Telegram → CRM (как WA) | `ai_gramjs` ~500 ₽/акк |
| **WhatsApp** | Connected accounts (Evolution QR) | `ai_wa` ~500 ₽/акк |
| **Gift bot** | Отдельный продукт | unchanged |
| **Business bot** | User creates bot in @BotFather (+ Business Mode), pastes token in portal; ≤10 Business accounts | «Автоматизация чатов» ~1000 ₽/10 |
| **AI-агенты** | Ортогональный слой: prompt/settings, вешается на любой чат/аккаунт | wallet usage |

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
