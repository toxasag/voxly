# AI Telegram Worker

> Telegram AI-бот: OpenRouter LLM, RAG-контекст, handoff pause/disable, human-like send.

## Исходные файлы

- `apps/ai-telegram-worker/src/index.ts` — единственный файл воркера (порт 3005)

## Архитектура

Вебхуки от Telegram приходят через **gift-bot-worker** (forward для `botType=ai_tg`, путь `/tg/{tenantId}/{botId}`).

### Обработка входящего сообщения

1. Дебаунс входящих сообщений (`createInboundDebouncer`, default 500ms).
2. Проверка AI-баланса (`hasAiBalance`).
3. Загрузка agent-контекста (`retrieveAgentContext`).
4. Сбор истории диалога (последние 20 сообщений, `CONTEXT_WINDOW`).
5. RAG-дополнение промпта (`formatRagPromptBlock`).
6. Вызов OpenRouter/OpenAI API.
7. Нормализация AI-ответа (`normalizeAiBubbles`, `humanBubbleGapMs`).
8. Списание AI-usage (`chargeAiUsage`, `buildUsageChargeKey`).

### Ключевые зависимости (imports)

| Package | Что используется |
|---------|-----------------|
| `@voxly/db` | `prisma`, `upsertCrmRecordLink` |
| `@voxly/crypto` | `decrypt` (дешифрация API-ключей) |
| `@voxly/ai-core` | `chargeAiUsage`, `hasAiBalance`, `retrieveAgentContext`, `formatRagPromptBlock`, `buildUsageChargeKey`, `enqueueAiUsageCharge`, и др. |
| `@voxly/analytics-dispatchers` | `fireGoal` |
| `@voxly/twenty-client` | `TwentyClient`, `normalizePhoneToE164`, `phoneFingerprint` |
| `@voxly/shared` | `verifyServiceToken`, `AI_MODEL_DEFAULTS`, `PRICING`, и др. |
| `openai` | LLM-клиент (OpenRouter-совместимый) |
| `ioredis` | Redis (таймлайны, кэш) |

### Медиа-обработка

- `extractAudioFromVideo` — извлечение аудио для Whisper STT
- `detectDocumentKind` / `extractDocumentText` — обработка документов
- Лимит: `DOC_MEDIA_MAX_BYTES`, `ASR_MEDIA_MAX_BYTES` (20MB), `ASR_VIDEO_MAX_DURATION_SEC` (180s)

### Timeline Sync

`enqueueTimelineSync(buildTimelineSyncKey(...))` — BullMQ job для синхронизации таймлайна с CRM.

## Инварианты безопасности

- Сервисный токен через `verifyServiceToken` / `resolveServiceToken`.
- Все данные scoped по `tenantId`.
- Дешифрация ключей через `@voxly/crypto` (ключи в БД зашифрованы).

## Риски

- **OpenRouter rate limits** — нет явного circuit breaker (depend on retries).
- **Контекст 20 сообщений** — для длинных диалогов может не хватать.
- **Debounce 500ms** — при быстрых сообщениях возможна потеря контекста.

## ensureConversation: username-fallback (2026-08-16)

Если диалог не найден по `platformUserId` (числовой id) — fallback-поиск по `platformUsername` (case-insensitive) для того же бота + backfill: `platformUserId = <числовой id>`. Покрывает write-first диалоги, созданные до внедрения adoption числового id. См. [`../03-saas-api-internal/crm-chat-write-first.md`](../03-saas-api-internal/crm-chat-write-first.md).
