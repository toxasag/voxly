# Voxly — AI memory: Features

Журнал реализованных фич для протокола `apps/.cursorrules`.  
Шаблон записи — внизу файла и в `apps/.cursorrules`. Чеклист surface: `docs/agent/CAPABILITIES.md`.

---

### Gift bot — первое сообщение (до /start) vs стартовое (после /start)

- **Назначение:** На странице gift-бота два разных текста: (1) описание профиля Telegram при переходе по ссылке до «Старт»; (2) сообщение в чате сразу после `/start` (подписка на канал).
- **Файлы:** portal `dashboard/bots/[botId]` cards **1.2** / **1.3**; API `PUT /api/bots/:botId/telegram-profile`; Prisma `BotInstance.telegramDescription` / `telegramShortDescription`.
- **Хранение:** control PG + Telegram Bot API `setMyDescription` / `setMyShortDescription`; funnel `start` остаётся в `GiftCampaignConfig.funnelJson`.
- **Взаимосвязи:** не путать с promo-постом в канале (шаг 2).
- **Статус:** ✅ код готов; prod deploy + migration pending

### Telegram Business — список аккаунтов + агент на бота

- **Назначение:** На странице бота видно, к каким Business-аккаунтам подключён бот (баны/переподключения). Один `AiAgent` на бота → все аккаунты (до 10). Входящий диалог → CRM сделка с меткой Business-аккаунта; ответ из CRM — через бота или GramJS-тред.
- **Файлы:** `apps/ai-telegram-worker` (`upsertBusinessAccountLink`, `syncLeadToCrm` + label, `pauseOnHumanOutbound` sync); `apps/saas-api` `GET /api/bots/:id/conversations` → `businessAccounts`; portal `dashboard/ai/[botId]`.
- **Хранение:** Conversation `channel=telegram_business_account` (реестр; не диалог клиента); status `limited` если `can_reply=false`.
- **Взаимосвязи:** ADR-014 agent на `BotInstance.defaultAiAgentId`; CRM chat reply `ai_tg` + `business_connection_id`.
- **Ограничения:** без прав ответа в Telegram Business automation входящие/`business_message` не приходят (INC-047).
- **Статус:** ✅ Done (prod 2026-07-24)

### CRM Chat (мульти-канальный инбокс в Twenty)

- **Назначение:** Единый чат на карточке Person / Opportunity в CRM: история переписки и ответ оператора клиенту. Канал может быть gift-бот, Telegram Business, личный Telegram (GramJS) или WhatsApp. В шапке видно **откуда/от кого** пишем; при нескольких привязках — **переключатель треда**, куда уйдёт ответ. AI сюда не «вшит»: сообщения пишутся всегда, LLM отвечает только если на аккаунт/чат назначен `AiAgent` (ADR-014).

- **Файлы/Компоненты:**
  - UI: `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx`
  - Logic: `twenty-app/voxly-crm-chat/src/logic-functions/get-crm-chat.ts`, `reply-crm-chat.ts`, `get-crm-chat-file.ts`, `voxly-proxy.ts`
  - API: `apps/saas-api/src/routes/crm-chat.ts` (`GET/POST /api/crm/chat/:recordId`, `.../reply`, `.../file/:fileId`, **`GET /inbound-toasts`**)
  - Logic: `get-inbound-toasts` → `GET /s/crm-chat/inbound-toasts` (shell-ux; service token server-side)
  - Inbound gift: `apps/gift-bot-worker` (`GiftSubscriber` + `ChatMessage`)
  - Inbound TG AI/Business: `apps/ai-telegram-worker`
  - Inbound/outbound GramJS: `apps/gramjs-bridge` + proxy `apps/saas-api/src/routes/gramjs.ts`
  - Inbound/outbound WA: `apps/ai-whatsapp-worker` + Evolution; proxy `apps/saas-api/src/routes/whatsapp.ts`
  - Установка app: `@voxly/twenty-client` `ensureCrmChatAppInstalled`; tarball в образе saas-api
  - Shell UX: `docker/twenty-shell-ux.js` — left inbound toasts (~5s), cabinet dedupe, kanban note clamp, Opportunity create CTA → «Новая Сделка»

- **Хранение данных:**
  - Control PG: `Conversation` (platformUserId, channel, businessConnectionId, twentyPersonId/OpportunityId, botInstanceId, aiAgentId, pausedUntil, aiDisabled…), `ChatMessage` (role, content, attachments JSON)
  - Gift: дополнительно `GiftSubscriber` с twenty ids + `conversationId`
  - `BotInstance`: `botType` (`gift` \| `ai_tg` \| `ai_gramjs` \| `ai_wa`), `displayName` (человеческое имя WA/др.), encrypted token/session
  - Twenty: Person / Opportunity (связь по uuid в control); текст SoT — не в Twenty notes как primary store
  - Person «Социальные сети»: LinkedIn (built-in) + custom TEXT `telegram`, `whatsapp`, `odnoklassniki`, `vkontakte`, `instagram`, `facebook`, `threads` via `applyWorkspaceDefaults` / `ensureSocialFields`
  - Opportunity RU labels: `labelSingular=Сделка` / `labelPlural=Сделки` (`isLabelSyncedWithName:false`) → nav, list header, Person relation, create CTA; views: default INDEX **«Канбан»** (KANBAN) + secondary **«Списком»** (TABLE); not «All Сделки» as a second kanban

- **Взаимосвязи:**
  - Provision воркспейса → install `voxly-crm-chat` на `{slug}-crm` + `applyWorkspaceDefaults` (kanban «Канбан», RU object labels, social fields, note label)
  - Portal: подключение каналов (`/dashboard/ai` = BotFather token + delete, `/gramjs`, `/whatsapp`) и назначение AI (`/dashboard/ai/agents`); удаление аккаунта (корзина) на GramJS/WA/ai_tg
  - Auth logic→API: `VOXLY_SERVICE_TOKEN` + `X-Twenty-Workspace-Id` → tenant
  - Toast poll: shell-ux prefer same-origin `/s/crm-chat/inbound-toasts` → saas-api; fallback CRM JWT. Open «Чат» live via host click «Обновить» (~4.5s / matching toast) — Remote DOM has no timers (INC-048).
  - Reply: gift/`ai_tg` → Telegram Bot API; `ai_gramjs` → bridge `/messages/send`; `ai_wa` → worker → Evolution (в т.ч. `peer@lid`)
  - WA lead E.164 → Person.`phones` **и** Person.`whatsapp`
  - GET может отдать `threads[]` + `?conversationId=` / body для выбора треда при reply

- **Особенности и правила:**
  - Резолв чата: **GiftSubscriber ИЛИ Conversation** по Person/Opportunity id (не только gift — INC-032)
  - Пустой чат без привязки → **200** + `info`, не 404 вкладки
  - Шапка: `channelLabel` + `identityLabel` (бот @x / GramJS / WA displayName) + peer
  - Вложения: gift/`ai_tg`/WA из CRM OK (WA → Evolution `sendMedia`); GramJS из CRM — text-first
  - WA Linked ID (`@lid`): хранится в `Conversation.platformUserId`; слать как `digits@lid`; phone в Twenty только E.164 из `remoteJidAlt`/`senderPn` **или** Evolution Contact book (profilePic / unique pushName) (INC-037/038/039/**043**)
  - Имя Person: `pushName` / «WhatsApp» — **не** суффикс LID в firstName/lastName (INC-039)
  - Presence: CRM GET/reply → WA `sendPresence` composing + `markMessageAsRead`; TG Business → `sendChatAction` typing + `readBusinessMessage`
  - Composer placeholder: «Ответ в {channelLabel}…» (не hardcode Telegram) — `voxly-crm-chat` ≥0.1.3; **clickable http(s) links** in message HTML (INC-050)
  - Remote DOM: не FileReader в worker; composer remount после send; ошибки reply показывать из JSON `error` (не только HTTP status)
  - Send errors: saas-api `humanizeCrmChatSendError` — удалённый/недоступный peer → «Аккаунт удалён или недоступен»; privacy/block; WA `exists:false` (INC-040); LID/media RU messages не перетирать
  - Inbound toast: host `shell-ux` poll (не Remote DOM) — prefer `/s/…/inbound-toasts` while logged into CRM; portal `#voxlyChatToken` only fallback (INC-041: never sed-check placeholder literally); **click only if `personId`/`opportunityId` present** (no dead URL)
  - CRM lead sync (WA/TG): on every inbound validate stored Twenty ids; if Person/Opportunity missing (wipe/delete) → clear + recreate (INC-042); toast alone ≠ lead created
  - **Cross-channel Person merge by phone:** TG/GramJS + WA `syncLeadToCrm` call `findPersonByPhone` (phones + `whatsapp` field, RU variants) before create; reuse Person + attach Conversation; Opportunity reuse if already linked; ambiguous → `needsReview` (INC-044)
  - Kanban «Заметки»: chip = note.`title` ← `bodyV2Markdown` (SQL trigger); shell clamp ≤5 lines (`set-opportunity-kanban-card-defaults.sql`)
  - Sidebar: один «Кабинет Voxly» (SDK nav + shell dedupe + `docker/dedupe-cabinet-nav.sql`)
  - Не ломать gift/GramJS при правках WA и наоборот — общий `findCrmChatTarget` / `listCrmChatTargets` расширять точечно
  - Runtime-сбои и verify: `docs/agent/INCIDENTS.md` (INC-032…044), flows: `docs/agent/FLOWS.md`

---

### Cross-channel Person merge by phone (TG ↔ WA)

- **Назначение:** Один контакт Twenty Person для одного телефона: inbound Telegram (GramJS / Business contact) с видимым номером мержится в Person, созданный из WhatsApp (phones / `whatsapp`), и наоборот. Второй канал = второй Conversation/thread под тем же Person.
- **Файлы/Компоненты:** `@voxly/twenty-client` `findPersonByPhone` / `normalizePhoneToE164` / `phoneSearchVariants`; `apps/ai-telegram-worker` + `apps/ai-whatsapp-worker` `syncLeadToCrm`; `apps/gramjs-bridge` передаёт `Api.User.phone`
- **Хранение данных:** Twenty Person.`phones` + custom `whatsapp` / `telegram`; control `Conversation.twentyPersonId` (+ `needsReview` при ambiguous)
- **Взаимосвязи:** CRM Chat threads switcher already lists by Person; INC-042 stale recreate preserved; INC-043 WA phone fill feeds merge key
- **Особенности и правила:** нет телефона → create Person как раньше; несколько кандидатов → `needsReview`; не orphan Conversation; Opportunity reuse с уже привязанного Person, иначе create

---

### CRM workspace defaults (Person social + toast + cabinet)

- **Назначение:** Единые defaults для новых порталов и backfill john: социальные поля Person, inbound toast, один пункт «Кабинет Voxly», kanban note body.
- **Файлы/Компоненты:** `@voxly/twenty-client` `applyWorkspaceDefaults` / `ensureSocialFields`; `docker/twenty-shell-ux.js`; `docker/dedupe-cabinet-nav.sql`; `GET /api/crm/chat/inbound-toasts`; WA `syncLeadToCrm` → `whatsapp`
- **Хранение данных:** Twenty `fieldMetadata` на Person; control `ChatMessage` для toast feed
- **Взаимосвязи:** provision + `POST /api/admin/tenants/:id/reapply-crm-defaults`; Twenty image rebuild for shell-ux
- **Особенности и правила:** Opportunity social group не трогаем (нет той же группы); toast = poll ~4s, не SSE; SQL triggers notes всё ещё вручную на новых schema (ADR-010 TODO)

---

## Шаблон новой записи

```markdown
### [Название фичи]
- **Назначение:** <Зачем нужен этот функционал>
- **Файлы/Компоненты:** `<пути к файлам>`
- **Хранение данных:** <Схема БД, таблицы, ключи, state>
- **Взаимосвязи:** <С какими другими фичами/компонентами связан>
- **Особенности и правила:** <Важные нюансы реализации, логика работы, переиспользование>
```
