# CRM / AI chat — golden path (не регрессировать)

Канон поведения мессенджер-чата в Twenty «Чат» + AI. Заказчик 2026-07-26: **WA чат работает идеально** — этот документ фиксирует эталон. Telegram/GramJS должны держаться того же UX-контракта, где код уже умеет; отличия помечены.

Связано: ADR-014 (агенты OFF по умолчанию), ADR-016 (knowledge/learn), INC-059…069, FLOWS §4 (UI CRM).

## 1. Общий контракт (все каналы)

| Правило | Деталь |
|---|---|
| Один inbound burst → один CRM lead | Один **Person** + одна открытая **Opportunity** на peer; не плодить сделки на LID/PN twin / CUID |
| Сообщения всегда пишутся | `ChatMessage` + Conversation даже если AI OFF |
| AI отвечает только с агентом | `Conversation.aiAgentId` \|\| `BotInstance.defaultAiAgentId`; иначе тишина (ADR-014) |
| Handoff | `aiDisabled` / `pausedUntil` / `mode≠ai` / `status=closed` → нет LLM |
| Debounce inbound | `@voxly/ai-core` `createInboundAiDebouncer`, default **10s** (`AI_INBOUND_DEBOUNCE_MS`); in-flight queue — **не** параллельные `humanLike` на один chat |
| Bubbles | `normalizeAiBubbles` ≤**4**, ≤**~140** символов; короткие «живые» сообщения |
| Abort mid-send | Если за время набора пришёл новый `role=user` → остановить оставшиеся bubbles |
| CRM UI | Вкладка «Чат», presence/last-seen где канал умеет, AI вкл/пауза/выкл, threads multi-channel — FLOWS §4; **unread badges** на карточках сделок/контактов (shell-ux + `lastOperatorReadAt`); Kanban **«Последнее обновление»** = Opportunity.updatedAt bumped on chat activity (`touchOpportunityActivity` + admin backfill) |
| Не выдумывать телефон | Только явные PN/E.164 из webhook / vCard / Contact fields |

## 2. WhatsApp (`ai-whatsapp-worker` + Evolution) — эталон ✅

**Транспорт:** только Evolution (Baileys QR). Image `v2.3.7-lid`. Env: `EVOLUTION_*`, `AI_WHATSAPP_*`, worker `TWENTY_DATABASE_URL` (INC-062).

### Identity / CRM sync
1. PN из `remoteJidAlt` / `senderPn` / vCard / explicit Contact|Chat — **не** avatar/pushName (default). Opt-in: `WA_LID_AVATAR_PHONE_MATCH=1`.
2. **Не** трактовать Evolution Contact CUID как E.164 (INC-060).
3. Dedupe LID↔PN conversations / messageId — один диалог; при resolve E.164 **merge sibling Conversations** (move ChatMessages, keep LID `platformUserId` + `platformUsername` +E.164, close twin) — INC-097 v6.1.
4. `syncLeadToCrm`: Person phone + whatsapp `+E.164`; имя без LID в lastName (INC-039). **Before** ASR/vision/doc enrich (INC-068) — lead must not wait on media AI.
5. Business profile (`fetchBusinessProfile`): **email**, **website** → Person; Instagram/Facebook **только** если URL есть в ответе Evolution или в website/description. Meta-linked IG в UI WA **не** в Baileys API — не выдумывать.
6. Email unique в Twenty включает soft-delete: при fail → `releaseSoftDeletedPersonEmail` (SQL через `TWENTY_DATABASE_URL`) → retry `updatePersonEmail` (INC-062). Create Person без email, потом attach.

### History sync (`runWhatsAppPrivateChatSync`, INC-097 v6)
1. **Источник сделок** — только **открытые private** чаты из `findChats` **с историей** (`findMessages` / `fetchAllEvoMessagesForJid`). Contact book — **только enrich** (LID→PN, имя), **не** источник диалогов.
2. **LID→PN (INC-097 v7 order):** `resolveLidPhoneFromEvolution()` — **findChats** `remoteJidAlt`/`senderPn` (Evolution v8.1 patch: Baileys `getPNForLID` + Redis `lid-mapping-*_reverse`) → Message.key SQL → Redis worker → `IsOnWhatsapp.jidOptions` → `POST /chat/whatsappNumbers` → Contact book → Chat DB → **profile-index last** (`fetchProfile` on open findChats PN-кандидаты only; email/website/pic→E.164; match на LID `fetchProfile`). WhatsApp UI **всегда** показывает телефон — если он есть в UI/profile, **запрещено** оставлять Phones пустым. **Честность:** только LIDs с Baileys/Redis mapping или profile-index hit получают E.164 — не выдумывать.
3. **Сообщения:** пагинация до `messageLimit` (default **500**); для LID+PN — merge обоих JID, dedupe по `message.id`. CRM не выдумывает сообщения, которых нет в Evolution.
4. **Person:** real name **или** `noname1`, `noname2`… — **никогда** `firstName=WhatsApp` без identity; phone всегда в `phones` + `whatsapp` (+E.164) когда известен.
5. **Opportunity title:** `{seq} · WA · {accountDisplayName}` где `account` = `bot.displayName` подключённого WA-бота (не `{contactName} · WA · {ownNumber}`).
6. Skip groups/channels/self/`0@`; один Person + одна open Opportunity на peer; `suppressDealCreation` — **только** ручной CRM toggle.
7. **Cross-channel enrich (maximize Person fields):** after phone resolve → shared `enrichPersonCrossChannelByPhone` (saas-api): (a) GramJS by-phone → telegram LINKS + name if `nonameN`/empty; (b) if `ai_max` → Person.`max` (real `max.ru` only; no birthday); (c) if `ai_wa` → Evolution IsOnWhatsApp → `wa.me` (**never** invent without `exists`). Wired on: **WA inbound** (worker local TG+MAX), **site form-lead**, **MAX inbound/sync** (TG+WA), **GramJS sync** + **TG worker** when phone known (MAX+WA), **gift contact-share**. **Never** invent `t.me/+phone` / `max.ru/+phone`. INC-106 scrape guard. Social order: Telegram → WhatsApp → **MAX**. Backfill: admin `enrich-persons-by-phone` (`channels` include `whatsapp`). Internal: `POST /api/internal/crm/enrich-by-phone`.

### AI pacing / typing (эталон «идеально»)
1. Debounce **10s** + очередь пока идёт flush.
2. Перед ответом: mark read (best-effort).
3. Каждый bubble: `sendPresence(composing)` + `sendText({ delay })` — `typingDelayMs` ≈ **3.0–6.5s** (base 1400 + 40×chars). Evolution `delay` держит «печатает…» до отправки.
4. Между bubbles: `humanBubbleGapMs()` (~4–6s) + composing на gap.
5. После ответа / abort / error: `sendPresence(paused)` — не оставлять залипший «печатает…» (INC-067).
6. CRM presence: worker/cache → saas-api `crm-chat` presence line.
### Не ломать
- Группы / status / newsletter — skip.
- Soft trial addon на канале.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` (+ `compose` если менялся env).

## 3. Telegram Business (`ai-telegram-worker`)

| Тема | Сейчас |
|---|---|
| Вход | BotFather Business Mode → token в `/dashboard/ai` |
| CRM | Person/Opportunity + ChatMessage; AI только с assigned agent |
| Debounce | Тот же `DEFAULT_INBOUND_DEBOUNCE_MS` **10s** |
| Typing | `sendChatAction(typing)` + `typingDelayMs` (base 800, max 5s) — **короче**, чем WA эталон; при полировке TG подтянуть к WA ≥~3s visible |
| Bubbles | parse multi-bubble + normalize где подключено |
| Skip | `is_bot` senders |
| Media | ASR/vision/PDF/DOCX через OpenRouter + `@voxly/ai-core` (platform default, all tenants); degrade placeholder |
| Presence в CRM | Business: hide/limited (см. CAPABILITIES) |

Цель: тот же UX, что WA (короткие bubbles, нет параллельных flush, один lead). Не ослаблять debounce / assignment model.

## 4. GramJS личный Telegram (`gramjs-bridge` + worker path)

| Тема | Сейчас |
|---|---|
| Продукт | Отдельный SKU `ai_gramjs` (~500 ₽), UI `/dashboard/ai/gramjs` |
| CRM chat outbound | Bridge `POST /messages/send`; client MD → HTML entities (`parseMode: html`, spoiler/code); **photo/video/voice/document** via `mediaBase64` (parity MAX/WA) |
| CRM chat inbound media | Photo/video/sticker/voice/doc → `attachments` `gramjs:{peer}:{msgId}` + CRM `/file` via bridge `POST /messages/media`; **video/audio/documents** via HMAC signed URL (`/file-url` → `/media/:token`) with MIME sniff + Range |
| AI media | Photo/sticker → vision; voice/audio → ASR; **кружочек + обычное видео** → ASR (`[кружочек]:` / `[видео]:`, ffmpeg demux, ≤20MB/180s); **PDF/DOCX** → `[документ PDF|DOCX]:` (≤25k); else fallback «не удалось разобрать»; animation/GIF → placeholder |
| Presence | Live через GramJS → crm-chat |
| AI | Тот же AiAgent assign / OFF default |

При изменениях AI-ответов — тот же debounce + human pacing, что WA/TG Business.

## 4a. MAX личный (`max-bridge` + PyMax) — ADR-025 Phase 1

| Тема | Сейчас |
|---|---|
| Продукт | SKU `ai_max` (~500 ₽), UI `/dashboard/ai/max`, soft trial 7d |
| Transport | Python sidecar `apps/max-bridge` (PyMax / неофициальный user API) |
| CRM | `platform=max` / `channel=max_personal`; inbound → `/api/internal/max/inbound`; **history sync** bridge `POST /crm/private-dialogs` → `runMaxPrivateChatSync` (DIALOG only ×30; `platformUserId`=chat id; reuse open Opp); reply → bridge `POST /messages/send` **text-only** |
| Sync fields | chat id, peer name/phone/link (if `get_user`), message text/media placeholder, direction; no groups/channels |
| Phone enrich | Bridge `POST /users/by-phone` (`search_by_phone` → `import_contacts`); Person.`max` only with real `max.ru` link; **birthday N/A**; admin `enrich-persons-by-phone` channels include `max` |
| AI | OFF by default (ADR-014); agent assign Phase 3 |
| Media / presence | Phase 3 (CRM reply still text-only) |
| Disclaimer | Portal warning: ban / breaking-change risk |

## 4b. Gift-бот (`gift-bot-worker`)

| Тема | Сейчас |
|---|---|
| Продукт | Воронка подарков (не sales LLM). `botType=ai_tg` → forward на `ai-telegram-worker` |
| MAX gift | `botType=gift_max`, тот же SKU `gift_bot`; webhook `/max/{tenantId}/{botId}`; local `GIFT_MAX_USE_POLLING` |
| Channel membership (MAX) | **gap** — нет паритета TG `getChatMember`; кнопка «Продолжить» выдаёт подарок |
| CRM inbound media | attachments `file_id` + preview; **video_note** stored (TG); MAX text MVP |
| Media understanding | **Same extractors** as Business: voice/audio ASR, кружочек+video ASR, photo/sticker vision, PDF/DOCX text → enriched `ChatMessage.content` for operators; soft-charge AI wallet if present (TG gift; MAX Phase 3) |
| AI reply | Нет на gift funnel; только CRM display + notes |

## 5. AI-агенты (ортогональный слой)

- Portal: `/dashboard/ai/agents` + bind на аккаунт/чат.
- `systemPrompt` + `settings`; knowledge chunks + learn from **won** deals (ADR-016).
- После PATCH prompt/model workers **перечитывают** AiAgent на следующий inbound; история **до** `agent.updatedAt` (user+assistant) не few-shot'ит старую персону (INC-064/066); assistant-отказы «не могу просмотреть/прослушать» вырезаются из history (INC-067); при отказе **после** `[голос]/`/`[видео]:` — один retry (INC-069).
- **Schema:** новые поля Prisma на `ChatMessage` (напр. `deliveryStatus`) **обязаны** быть мигрированы на prod до деплоя saas-api — иначе GET chat **500** и пустой «Чат» (INC-069).
- Стоимость: OpenRouter `usage.cost` → wallet (ADR-015).
- CRM panel: оператор может вкл/пауза/выкл AI на треде без отключения канала.

## 6. Файлы (точки входа)

| Что | Где |
|---|---|
| WA inbound / sync / humanLike | `apps/ai-whatsapp-worker/src/index.ts` |
| TG Business inbound / typing | `apps/ai-telegram-worker/src/index.ts` |
| Gift inbound + media enrich | `apps/gift-bot-worker/src/index.ts` (`enrichGiftInboundMedia`) |
| Debounce / bubbles / gap / media hint | `packages/ai-core` (`inbound-debounce`, `document-text`, `extract-audio`) |
| CRM API + presence | `apps/saas-api/src/routes/crm-chat.ts` |
| Chat UI | `twenty-app/voxly-crm-chat` |
| Person socials / email | `packages/twenty-client` (`website`, `updatePersonEmail`, …) |
| Agents API | `apps/saas-api/src/routes/ai-agents.ts` |

## 7. Smoke (после правок чата)

1. WA personal: inbound → «печатает» ≥~3s → 1–N коротких bubbles с паузами; один Person+Opportunity.
2. WA business: Person phone + website + email; IG только если URL в профиле.
3. Burst 2–3 сообщений за &lt;10s → **один** AI-ответ (не шторм).
4. CRM вкладка «Чат»: history, reply, presence (где канал умеет), AI toggle.
5. Без assigned agent → сообщения в CRM, **без** LLM reply.
6. Media (all channels): voice / кружочек / video → `[…]: transcript`; photo → `[фото]: …`; PDF/DOCX → `[документ …]:`; gift CRM shows same enriched text.

## Media parity (platform default)

| Capability | Business | GramJS | WA | Gift |
|---|---|---|---|---|
| Voice/audio ASR | ✅ | ✅ | ✅ | ✅ CRM text |
| Кружочек / ptv ASR | ✅ | ✅ | ✅ | ✅ CRM text |
| Regular video ASR | ✅ | ✅ | ✅ | ✅ CRM text |
| Photo/sticker vision | ✅ | ✅ | ✅ | ✅ CRM text |
| PDF/DOCX extract | ✅ | ✅ | ✅ | ✅ CRM text |
| Sales LLM reply | ✅ if agent | ✅ if agent | ✅ if agent | ❌ funnel only |
| CRM attachment preview | ✅ | ✅ | ✅ | ✅ |

No per-tenant feature flag — workers enrich whenever `OPENROUTER_API_KEY` is set. New portals get latest crm-chat via provision `forceReinstall`.
