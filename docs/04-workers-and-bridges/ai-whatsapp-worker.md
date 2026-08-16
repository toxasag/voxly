# AI WhatsApp Worker

> WhatsApp AI-бот через Evolution API: быстрый ACK (<100ms), Baileys QR, LLM, CRM.

## Исходные файлы

- `apps/ai-whatsapp-worker/src/index.ts` — единственный файл воркера (порт 3006)

## Архитектура (ADR-014)

### Fast ACK Pattern

При получении webhook от Evolution API воркер **немедленно** возвращает HTTP 200 OK (без ожидания обработки). Это критично для Evolution API — если ответ >100ms, webhook считается неудачным и пересылается повторно.

### Каналы

Channel connect → Conversation + CRM lead **всегда**; AI reply **только если AiAgent** назначен на канал.

### Обработка сообщения

1. Быстрый ACK (200 OK).
2. Определение режима (`isAiConversationMode`).
3. Дебаунс (`createInboundDebouncer`).
4. Проверка баланса (`hasAiBalance`).
5. Загрузка контекста (`retrieveAgentContext`, `formatRagPromptBlock`).
6. Проверка near-duplicate (`isNearDuplicateReply`).
7. Media capability checks (`filterMediaCapabilityRefusals`).
8. Вызов LLM.
9. Нормализация ответа (`normalizeAiBubbles`).
10. Списание usage (`chargeAiUsage`).

### LID/PN Compatibility

- `ALLOW_AVATAR_PHONE_MATCH` — опция для Contact-book avatar twin.
- `WA_PROFILE_INDEX_PN_CAP` — лимит PN профилей (default 800, max 3000).
- `WA_PROFILE_FETCH_CAP` — бюджет на fetchProfile (default 150).

### Ключевые зависимости

| Package | Что используется |
|---------|-----------------|
| `@voxly/db` | `prisma`, `upsertCrmRecordLink` |
| `@voxly/crypto` | `decrypt`, `encrypt` |
| `@voxly/ai-core` | полный набор AI-функций |
| `@voxly/analytics-dispatchers` | `fireGoal` |
| `@voxly/twenty-client` | CRM интеграция |
| `@voxly/shared` | токены, конфиг, утилиты |
| `openai` | LLM-клиент |
| `pg` | Прямое подключение к Postgres |
| `ioredis` | Redis |

## Инварианты безопасности

- Сервисный токен (`verifyServiceToken`).
- Evolution API key проверяется перед запросами.
- Все операции scoped по `tenantId`.

## Риски

- **Idempotency**: нет явной проверки webhook-id — при ретраях Evolution может отправить дубликат. Fast ACK + `isNearDuplicateReply` как mitigation.
- **LID-контакт без телефона** — невозможно обогатить CRM-контакт.
- **pg direct connect** — обходит pgbouncer (todo: оценить необходимость).

## `fromMe` outbound webhook

Evolution `key.fromMe=true` направляется в `mirrorWaPhoneOutbound`, а не в `handleInboundMessage`. Mirror сохраняет `role=operator`, `fromMe=true`, `externalMessageId`, переиспользует LID/PN conversation, восстанавливает CRM Person/Opportunity link и пишет timeline `chat_outbound`. AI-ответ и inbound lead creation запрещены для этого пути.

## Native outbound guard

Evolution `key.fromMe` must enter `mirrorWaPhoneOutbound`, not `handleInboundMessage`. The mirror reconciles an existing Person/Opportunity and `CrmRecordLink`, stores `fromMe=true`, and emits `chat_outbound`; it must not create a new deal when no CRM match exists and must not trigger AI.
