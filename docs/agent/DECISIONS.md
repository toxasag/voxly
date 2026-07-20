# Решения (короткие ADR)

## ADR-001 — Чат в карточке Сделки / Контакта (Twenty 2.22)

**Статус:** interim ✅ 2026-07-20 (inject UI) · Apps SDK tab — later  

| Вопрос | Выбор |
|---|---|
| Host UI (сейчас) | Inject `docker/twenty-deal-chat.js` на Opportunity **и** Person record: кнопка «Чат» → панель |
| Auth | `GET /api/tenant/crm-login` → `chatToken` (JWT) в hash → `localStorage` в CRM |
| SoT сообщений | Control Prisma `Conversation` / `ChatMessage` |
| Lookup | `GiftSubscriber.twentyOpportunityId` **или** `twentyPersonId` |
| API | `GET/POST /api/crm/chat/:recordId` (+ `/reply`, `/file/:fileId`) |
| Media | inbound TG file_id в `ChatMessage.attachments`; outbound multipart → sendPhoto/Video/Document |
| Format | client Markdown (`**bold**`…) → MarkdownV2 при send; UI: select → ПКМ |
| CRM create | Twenty 2.22: `createPerson(data:)` / `createOpportunity(data:)` (не `input`) |
| Dedup Person | reuse by `telegramId` across campaigns + `findPersonByHint` (@username / tg id) |
| Person.telegram | custom TEXT field via `ensureTelegramField` / `applyWorkspaceDefaults`; value `@username` |

**Отклонено как SoT:** custom ChatMessage objects в Twenty; Telethon user-session messenger.

**Next (SDK):** Yarn 4 → `create-twenty-app` → `definePageLayoutTab` → logic function → убрать inject.

---

## ADR-009 — Кнопка «Кабинет» в Twenty CRM

**Статус:** сделано 2026-07-18  

В Twenty нет native «назад в Voxly». Решение: white-label inject  
`docker/twenty-cabinet-link.js` → `/voxly-cabinet.js` + script в `index.html`.  
Плавающая кнопка «← Кабинет» → `VOXLY_CABINET_URL` (local: `http://localhost:3001/dashboard`).  
Позже можно заменить на nav item Twenty Apps SDK.

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
