# Telegram Internal Contracts

> Внутренние эндпоинты saas-api для Telegram-интеграции.

## Исходные файлы

- `apps/saas-api/src/routes/gramjs.ts` — публичные эндпоинты Telegram (вебхуки, bot commands)
- `apps/saas-api/src/routes/gramjs-internal.ts` — внутренние эндпоинты (gramjs-bridge → saas-api)
- `apps/saas-api/src/services/gramjs-chat-sync.ts` — синхронизация чатов из GramJS
- `apps/saas-api/src/services/telegram-crm-enrich.ts` — обогащение контактов из Telegram
- `apps/saas-api/src/services/purge-tenant.ts` — удаление данных тенанта

## Ключевые эндпоинты (gramjs.ts — публичные)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/telegram/webhook/:tenantId/:botId` | Входящий webhook от Telegram (forwarded через gift-bot) |
| GET | `/telegram/bot-info/:botId` | Информация о боте |

## Ключевые эндпоинты (gramjs-internal.ts — внутренние)

Вызываются gramjs-bridge с сервисным токеном.

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/internal/gramjs/...` | Синхронизация чатов, участников, сообщений |

## Инварианты безопасности

- Внутренние эндпоинты защищены `verifyServiceToken(bearer, 'saas-api')`.
- Все операции scoped по `tenantId`.
