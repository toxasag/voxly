# ТЗ: Shared Telegram Audience / Overlap Graph (v1)

**Версия:** 1.0  
**Статус:** implement v1  
**Дата:** 2026-07-23  

**Связано:** `docs/specs/AI-AGENTS-TZ.md` (GramJS), `apps/gramjs-bridge`, control Postgres.

---

## Цель

Платформенная БД фактов членства/«встреч» Telegram-пользователей в каналах/группах — по данным **всех** GramJS-сессий тенантов Voxly. Используется для анализа входящих лидов: где клиент «светился», пересечения каналов → куда рекламировать / чем интересуется.

**Не цель v1:** полный список подписок чужого аккаунта через платные intercept API; WhatsApp; hard Robokassa checkout.

---

## Как собираем факты (легальные источники платформы)

1. **Dialog sync** — при connect / периодически: GramJS-аккаунт тенанта видит свои диалоги → upsert peer + sighting `member` для самого аккаунта; для user-диалогов — peer user.
2. **Inbound / common chat** — входящее в личку (или shared context): sighting `seen_in` для sender ↔ peer чата (если не private 1:1 — peer = group/channel).
3. **On-demand membership check** — `user ∈ peer` через любую платформенную сессию, которая имеет доступ к peer (rate-limit). Результат → sighting `member` / negative не храним в v1.

**Храним только минимальные факты. Текст сообщений не пишем в graph-таблицы.**

---

## Privacy / access (v1 defaults — биллинг не финализирован)

| Тема | Решение v1 |
|---|---|
| Storage | **Global** SoT в control Postgres; audit: `sourceTenantId`, `sourceBotInstanceId` |
| UI/API | Soft-gate: активный addon `ai_gramjs` (или trial) — как у других AI SKU; без addon — warning, данные всё равно видны в soft-режиме (как QR) |
| Что показываем | Агрегаты + title/username peer’ов; **не** чужие private chat contents (мы их и не храним) |
| Legal | **TODO:** ToS / privacy policy follow-up до широкого маркетинга фичи |

---

## Схема (control Postgres)

### `TelegramPeer`
- `id` cuid
- `peerId` String — Telegram id (channel/supergroup/user/bot as string)
- `peerType` `channel` \| `group` \| `bot` \| `user`
- `username` String?
- `title` String?
- `createdAt` / `updatedAt`
- `@@unique([peerId])`, indexes on `peerType`, `username`

### `TelegramSighting`
- `id` cuid
- `telegramUserId` String — TG user id
- `peerId` String — FK logical to `TelegramPeer.peerId`
- `relation` `member` \| `seen_in` \| `admin`
- `firstSeenAt` / `lastSeenAt`
- `sourceTenantId` String
- `sourceBotInstanceId` String? — GramJS `BotInstance.id`
- `confidence` Float? (0–1; default 1 for dialog sync, lower for weak signals)
- `@@unique([telegramUserId, peerId, relation])`
- indexes: `(telegramUserId)`, `(peerId)`, `(sourceTenantId)`

---

## Компоненты

### gramjs-bridge
- После connect + restore + periodic (~15–30 min): `getDialogs` → upsert peers + sightings.
- Опционально: recent participants в небольших группах **без** spam (лимит/throttle).
- Inbound: upsert peer user + `seen_in` для chat peer если group/channel.
- `POST /audience/check-membership` `{ userId, peerId }` — rate-limit; service token.
- Пишет в Prisma напрямую (как sessions) — без лишнего hop в saas-api.

### saas-api
- `GET /api/audience/peers` — топ каналов/групп по числу уникальных user sightings (+ global counts).
- `GET /api/audience/overlap?telegramUserId=` \| `?conversationId=` \| `?username=` — список peers для лида.
- Soft-gate addon `ai_gramjs` (warning в ответе).

### Portal
- `/dashboard/ai/audience` — «Пересечения аудитории»: топ peers; поиск по TG id / @username / conversation.
- Ссылки из `/dashboard/ai` и `/dashboard/ai/gramjs`.
- Опционально: badge overlap count на диалогах GramJS — nice-to-have.

### CRM
- Не ломать INC-032 Conversation lookup. Overlap в CRM chat — не в v1.

---

## Out of scope v1

- External paid «all subscriptions» APIs  
- WhatsApp graph  
- Hard Robokassa gate  
- Message text / media in graph tables  
- Cross-tenant billing for data access  

---

## Success criteria

1. Spec + migration applied (local + prod if deploy).  
2. GramJS sync наполняет peers/sightings.  
3. Portal показывает данные (даже sparse).  
4. Lead с telegram id → overlap query.  
5. Docs: WORKLOG / CAPABILITIES / steps.md.
