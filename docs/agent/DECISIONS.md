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
| Composer | format toolbar + textarea + right stack Прикрепить→Отправить; multi-file chips; Enter send, Shift+Enter newline |
| Media preview | logic JPEG compress before base64 (INC-014); photo/sticker `<img>` |
| SoT UX reference | parity with inject `docker/twenty-deal-chat.js` (format + attach + media preview) |
| CRM create | Twenty 2.22: `createPerson(data:)` / `createOpportunity(data:)` |
| Dedup Person | reuse by `telegramId` + `findPersonByHint` |
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
| Default Opportunities view | Seeded TABLE `key=INDEX` → promote existing **By Stage** KANBAN to `key=INDEX` via SQL (`docker/set-opportunity-kanban-default.sql`). GraphQL `updateView` cannot set `key`. |
| Kanban column width | **320** via `view.kanbanColumnWidth` + `overrides.kanbanColumnWidth` (`docker/set-opportunity-kanban-card-defaults.sql` + `ensureOpportunityKanbanDefault`). |
| Kanban card fields | name, createdAt, amount, createdBy, closeDate, company, pointOfContact, taskTargets, noteTargets — positions/sizes in `OPPORTUNITY_KANBAN_CARD_FIELDS` (`twenty-client`). |
| Note on kanban card | Note `labelIdentifier` = **bodyV2** (текст заметки, не title); shell-ux clamps ≈5 lines. |
| «Чат» tab order | `position: 15` (after Home=10, before Timeline=20) in `page-layout-tabs/*-chat.page-layout-tab.ts` + `docker/set-chat-tab-position.sql`. |
| New workspace provisioning | `applyWorkspaceDefaults` → kanban type/groups + column width + card fields + note body label. |
| Persistence | Scripts baked in `docker/twenty.Dockerfile`; hot-patch survives until container recreate — then rebuild image or re-copy + re-sed `index.html`. |

**Re-apply after Twenty recreate:**
1. Rebuild `voxly-twenty:2.22.0` **or** `docker cp docker/twenty-shell-ux.js …/voxly-shell-ux.js` + ensure `<script src="/voxly-shell-ux.js">` in `index.html`.
2. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-default.sql`
3. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-opportunity-kanban-card-defaults.sql`
4. `docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty < docker/set-chat-tab-position.sql`
5. Re-apply chat app if needed: `yarn twenty apply --remote <ws> --force`

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
