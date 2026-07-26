# CRM / AI chat — golden path (не регрессировать)

Канон поведения мессенджер-чата в Twenty «Чат» + AI. Заказчик 2026-07-26: **WA чат работает идеально** — этот документ фиксирует эталон. Telegram/GramJS должны держаться того же UX-контракта, где код уже умеет; отличия помечены.

Связано: ADR-014 (агенты OFF по умолчанию), ADR-016 (knowledge/learn), INC-059…062, FLOWS §4 (UI CRM).

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
| CRM UI | Вкладка «Чат», presence/last-seen где канал умеет, AI вкл/пауза/выкл, threads multi-channel — FLOWS §4 |
| Не выдумывать телефон | Только явные PN/E.164 из webhook / vCard / Contact fields |

## 2. WhatsApp (`ai-whatsapp-worker` + Evolution) — эталон ✅

**Транспорт:** только Evolution (Baileys QR). Image `v2.3.7-lid`. Env: `EVOLUTION_*`, `AI_WHATSAPP_*`, worker `TWENTY_DATABASE_URL` (INC-062).

### Identity / CRM sync
1. PN из `remoteJidAlt` / `senderPn` / vCard / explicit Contact|Chat — **не** avatar/pushName (default). Opt-in: `WA_LID_AVATAR_PHONE_MATCH=1`.
2. **Не** трактовать Evolution Contact CUID как E.164 (INC-060).
3. Dedupe LID↔PN conversations / messageId — один диалог.
4. `syncLeadToCrm`: Person phone + whatsapp `+E.164`; имя без LID в lastName (INC-039).
5. Business profile (`fetchBusinessProfile`): **email**, **website** → Person; Instagram/Facebook **только** если URL есть в ответе Evolution или в website/description. Meta-linked IG в UI WA **не** в Baileys API — не выдумывать.
6. Email unique в Twenty включает soft-delete: при fail → `releaseSoftDeletedPersonEmail` (SQL через `TWENTY_DATABASE_URL`) → retry `updatePersonEmail` (INC-062). Create Person без email, потом attach.

### AI pacing / typing (эталон «идеально»)
1. Debounce **10s** + очередь пока идёт flush.
2. Перед ответом: mark read (best-effort).
3. Каждый bubble: `sendPresence(composing)` + `sendText({ delay })` — `typingDelayMs` ≈ **3.0–6.5s** (base 1400 + 40×chars). Evolution `delay` держит «печатает…» до отправки.
4. Между bubbles: `humanBubbleGapMs()` (~4–6s) + composing на gap.
5. CRM presence: worker/cache → saas-api `crm-chat` presence line.

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
| Media | ASR/vision через OpenRouter; degrade placeholder |
| Presence в CRM | Business: hide/limited (см. CAPABILITIES) |

Цель: тот же UX, что WA (короткие bubbles, нет параллельных flush, один lead). Не ослаблять debounce / assignment model.

## 4. GramJS личный Telegram (`gramjs-bridge` + worker path)

| Тема | Сейчас |
|---|---|
| Продукт | Отдельный SKU `ai_gramjs` (~500 ₽), UI `/dashboard/ai/gramjs` |
| CRM chat outbound | Bridge `POST /messages/send`; text-oriented |
| Presence | Live через GramJS → crm-chat |
| AI | Тот же AiAgent assign / OFF default |

При изменениях AI-ответов — тот же debounce + human pacing, что WA/TG Business.

## 5. AI-агенты (ортогональный слой)

- Portal: `/dashboard/ai/agents` + bind на аккаунт/чат.
- `systemPrompt` + `settings`; knowledge chunks + learn from **won** deals (ADR-016).
- Стоимость: OpenRouter `usage.cost` → wallet (ADR-015).
- CRM panel: оператор может вкл/пауза/выкл AI на треде без отключения канала.

## 6. Файлы (точки входа)

| Что | Где |
|---|---|
| WA inbound / sync / humanLike | `apps/ai-whatsapp-worker/src/index.ts` |
| TG Business inbound / typing | `apps/ai-telegram-worker/src/index.ts` |
| Debounce / bubbles / gap | `packages/ai-core/src/inbound-debounce.ts` |
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
