# CRM Chat Write-First Contracts («Пишем от:»)

> Отправка первым сообщением из CRM по любому каналу (WhatsApp/MAX/Telegram) и сопутствующие контракты.

## Исходные файлы

- `apps/saas-api/src/routes/crm-chat.ts` — GET `/:recordId` (sendFromOptions), POST `/:recordId/reply`, POST `/normalize-telegram`, `resolveOutboundPeer`, `loadPersonPhoneE164`, `resolvePersonTelegramPeerFromTwentyDb`
- `apps/max-bridge/src/main.py` — `/messages/send` (write-first: `_resolve_user_by_phone` → `_resolve_dialog_chat_id`)
- `apps/gramjs-bridge/src/index.ts` — `/messages/send` (возвращает `resolvedPeerUserId`)
- `apps/ai-telegram-worker/src/index.ts` — `ensureConversation` (username-fallback + backfill id)
- `packages/twenty-client/src/index.ts` — `telegramOpenLink`, `findPersonByHint`, `updatePersonTelegram`
- `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` — переключение треда после send
- `twenty-app/voxly-crm-chat/src/logic-functions/normalize-person-telegram.ts` — person.updated → normalize

## Ключевые функции и контракты

```typescript
// saas-api
GET  /api/crm/chat/:recordId           → { threads, sendFromOptions, messages, ... }
     CrmSendFromOption = { botId, botType, label, available, unavailableReason?, isDefault?, threadId? }
POST /api/crm/chat/:recordId/reply     → { ok, botId, conversationId, message }
     body: { text?, conversationId?, giftSubscriberId?, sendFromBotId?, fileBase64?, fileName?, mimeType? }
POST /api/crm/chat/normalize-telegram  → { ok, changed, url?, label? }   // идемпотентно
     body: { personId }

// max-bridge
POST /messages/send  body += { resolvePhone } → { ok, chatId, attachment? }
// write-first: phone → user → get_chat_id(me,user) → chat_id ДИАЛОГА.
// ⚠ PyMax get_chat_id — СИНХРОННЫЙ локальный XOR: chat_id = me ^ user (INC-122).
// Вызывать sync/coroutine-safe (asyncio.iscoroutine); add_contact — best-effort ДО вычисления.

// gramjs-bridge
POST /messages/send → { ok, botId, peerUserId, resolvedPeerUserId?, messageId, attachment? }
// resolvedPeerUserId = числовой TG user id (когда peer был @username)
```

## Алгоритм write-first

1. **Доступность канала** (`resolveOutboundPeer`): треды того же канала → gift-подписчик → **Person-линки** (t.me URL/label → username/userId; phone → E.164). Опция `available:false` с причиной, если пир не найден.
2. **Отправка**: MAX — телефон → user_id → **id диалога** (`get_chat_id`); TG — username/phone/ id через gramjs; ответ возвращает `conversationId`.
3. **Персистенция**: диалог создаётся с **числовым platformUserId** (adoption `resolvedPeerUserId`/`chatId`), `CrmRecordLink` → Person/Opportunity.
4. **Входящие**: `ensureConversation` ищет по id → по `platformUsername` (fallback) + backfill числового id → дублей Person/сделки нет.
5. **Фронт**: после send — переключение на `conversationId` из ответа.

## Канонизация Telegram-линков (карточка)

- `telegramOpenLink({username,userId})` → url `https://t.me/<handle>` + label **`@<handle>`**; без username — url `/open/tg/<id>` + label `<id>`.
- Ручной ввод: logic-function `normalize-person-telegram` (person.updated, updatedFields:['telegram']) → `POST /normalize-telegram` → rewrite при отличии от канонического вида.

## Callers / Inbound

- CRM Chat tab (front component) — GET/reply/normalize.
- Logic functions: `reply-crm-chat`, `normalize-person-telegram` (proxy).
- ai-telegram-worker — inbound (ensureConversation).

## Инварианты

- Twenty 2.22 person-схема: **нет** колонок `telegram`/`whatsapp` — только `*PrimaryLinkUrl/Label` (мёртвые колонки валят весь SQL → silent null).
- MAX `send_message` требует chat_id диалога, не user_id.
- Идемпотентность normalize (skip при каноническом виде — иначе цикл person.updated).

## Дополнение UI (2026-08-16)

Переключатель тредов записи — выпадающий список **«Открытые чаты:»** (стиль «Пишем от:»), опции `Канал · Аккаунт → Контакт`. После send фронт переключается на `conversationId` из ответа.

## Риски

- `findPersonByHint` link-фильтры зависят от GraphQL-шейпа Twenty (есть try/catch fallback).
- Backfill числового id происходит на первом входящем; до него диалог ключён username'ом (матчинг обрабатывает).

## Outbound ingest из подключённых приложений (2026-08-16)

### MAX

`max-bridge` не отбрасывает `message.out`/`is_out`: событие отправляется в `POST /api/internal/max/outbound`.
Контракт использует `peerId` как **dialog chat id**, `maxUserId` как профильный user id и `messageId` как native id. SaaS сохраняет `ChatMessage.role='operator'`, `fromMe=true`, `externalMessageId='max:<messageId>'`, затем выполняет CRM matching и `upsertCrmRecordLink(source:'outbound')`. AI/inbound pipeline не запускается.

### WhatsApp

Webhook `key.fromMe` направляется в отдельный mirror path: сообщение сохраняется как operator/fromMe, существующая LID↔PN conversation и CRM-связи переиспользуются, timeline имеет `chat_outbound`; AI reply и inbound lead creation для этого события не запускаются.

### Общий инвариант

Любое исходящее сообщение из подключённого приложения должно быть идемпотентно сохранено в CRM и связано с Person/Opportunity при наличии существующего match. Физические Conversation разных каналов не объединяются: один канал/бот = отдельный тред под тем же CRM record.

## Native outbound ingest (MAX / WhatsApp)

- MAX `message.out`/`is_out` → `POST /api/internal/max/outbound`; сохраняется `role=operator`, `fromMe=true`, `externalMessageId=max:<nativeId>`, dialog `peerId`, CRM matching and outbound `CrmRecordLink`; AI/inbound lead creation не запускается.
- WhatsApp `key.fromMe` → `mirrorWaPhoneOutbound`; LID/PN aliases merge before reconciliation, `fromMe=true`, `role=operator`, `chat_outbound`; no AI reply, no new Opportunity solely from native outbound.
- SaaS CRM reply path также repairs/creates `CrmRecordLink` with `source:'outbound'` after final Conversation resolution.
