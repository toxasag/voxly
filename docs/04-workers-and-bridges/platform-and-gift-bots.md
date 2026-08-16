# Platform & Gift Bots

> Боты онбординга (platform-bot-service) и вовлечения (gift-bot-worker).

## Исходные файлы

### Platform Bot Service
- `apps/platform-bot-service/src/index.ts` — бот онбординга (порт 3009)

### Gift Bot Worker
- `apps/gift-bot-worker/src/index.ts` — бот вовлечения (порт 3004)
- `apps/gift-bot-worker/src/max-api.ts` — MAX API интеграция
- `apps/gift-bot-worker/src/max-handler.ts` — обработчик MAX событий

### Manager Bot Service
- `apps/manager-bot-service/src/index.ts` — менеджер-бот (порт 3003)

## Описание

### Platform Bot Service (порт 3009)
Бот онбординга новых пользователей. Управляется через:
- `PLATFORM_BOT_TOKEN` / `PLATFORM_BOT_USERNAME` — Telegram credentials
- `PLATFORM_WEBHOOK_URL` — webhook endpoint

Вызывается через `apps/saas-api/src/routes/platform-bot-internal.ts` (внутренние контракты).

### Gift Bot Worker (порт 3004)
Бот вовлечения. Обрабатывает:
- Telegram сообщения (forward к ai-telegram-worker для `botType=ai_tg`)
- MAX API события (через `max-handler.ts`, `max-api.ts`)

Режим: polling или webhook (`GIFT_BOT_USE_POLLING` env).

### Manager Bot Service (порт 3003)
Менеджер-бот для управления чатами, оповещений менеджеров.

## Инварианты безопасности

- Все боты используют `verifyServiceToken` для внутренних вызовов.
- Telegram bot tokens через ENV (не в коде).
- Operations scoped по `tenantId`.

## Риски

- **Bot token compromise** — полный доступ к Telegram-аккаунту бота.
- **Gift bot polling** — при высокой нагрузке возможны пропуски сообщений.
