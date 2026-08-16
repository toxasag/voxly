# GramJS MTProto Bridge

> MTProto-мост для сессий Telegram (GramJS).

## Исходные файлы

- `apps/gramjs-bridge/src/index.ts` — единственный файл моста

## Описание

GramJS-bridge предоставляет MTProto-доступ к Telegram API для:
- Синхронизации чатов и участников (→ saas-api `/internal/gramjs/*`)
- Получения истории сообщений
- Поиска контактов по username/телефону

**Callers / Inbound:**
- `apps/saas-api/src/services/gramjs-chat-sync.ts`
- `apps/saas-api/src/routes/gramjs-internal.ts`

**Dependencies / Outbound:**
- `@voxly/shared` — сервисные токены
- GramJS (Telegram MTProto client library)

## Инварианты безопасности

- Внутренние эндпоинты защищены сервисным токеном.
- MTProto-сессии хранятся локально (volume).

## Риски

- **Telegram bans** — при слишком частых запросах сессия может быть заблокирована.
- **Session memory** — долгоживущие соединения потребляют RAM → нужен reconnect.

## resolvedPeerUserId (2026-08-16)

`POST /messages/send` дополнительно возвращает `resolvedPeerUserId` — числовой TG user id, когда пир был передан как @username (write-first из CRM). saas-api использует его как `platformUserId` диалога, чтобы входящие ответы матчились по id, а не создавали дубль. См. [`../03-saas-api-internal/crm-chat-write-first.md`](../03-saas-api-internal/crm-chat-write-first.md).
