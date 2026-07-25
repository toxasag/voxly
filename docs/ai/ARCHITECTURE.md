# Voxly — AI memory: Architecture

Краткая карта для агентов по протоколу `apps/.cursorrules`.  
Глубокий контекст: `docs/ARCHITECTURE.md`, `docs/agent/*` (не дублируй длинные ADR сюда).

## Слои продукта

| Слой | Что это | Примеры |
|---|---|---|
| **Каналы / аккаунты** | Откуда пишут клиенты и от чьего лица отвечаем | Gift-бот, TG Business-бот (≤10), GramJS (личный TG), WhatsApp (Evolution) |
| **AI-агенты** | Ортогональный слой: промпт/настройки; вешается на аккаунт или чат | `AiAgent` + assign; **по умолчанию AI OFF**, пока агент не назначен (ADR-014) |
| **CRM Chat** | Единый инбокс на Person/Opportunity в Twenty | Tab «Чат» → saas-api `/api/crm/chat` |

Каналы **не** смешивать в одну карточку «Автоматизация» с GramJS/WA. Portal: Business `/dashboard/ai`, аккаунты `/dashboard/ai/gramjs` + `/dashboard/ai/whatsapp`, агенты `/dashboard/ai/agents`.

## Control plane vs CRM

```
Twenty CRM ({slug}-crm.getvoxly.ru)
  tab «Чат» → /s/crm-chat/:recordId  (Twenty App logic)
       │
       ▼  VOXLY_SERVICE_TOKEN + X-Twenty-Workspace-Id
saas-api  /api/crm/chat/:recordId
       │
       ├─ GiftSubscriber + Bot API          (gift)
       ├─ Conversation + Bot API            (ai_tg Business)
       ├─ Conversation + gramjs-bridge      (ai_gramjs)
       └─ Conversation + ai-whatsapp-worker (ai_wa / Evolution)
```

- **SoT сообщений:** control Postgres `Conversation` + `ChatMessage` (`packages/db`).
- **Twenty:** Person / Opportunity + ids на `GiftSubscriber` / `Conversation`; UI — App `twenty-app/voxly-crm-chat`.
- Писать в Twenty только через `@voxly/twenty-client` (GraphQL), не напрямую в twenty Postgres.

## Переиспользуемые пакеты

| Пакет | Роль |
|---|---|
| `@voxly/db` | Prisma control (`Conversation`, `ChatMessage`, `BotInstance`, `AiAgent`, …) |
| `@voxly/crypto` | AES токены/сессии ботов |
| `@voxly/shared` | PRODUCT_CODES, pricing, MarkdownV2 helpers, handoff pause ms |
| `@voxly/twenty-client` | Workspace auth, Person/Opportunity, install crm-chat app |
| `@voxly/ai-core` | AI wallet / usage (workers) |

## Каналы → outbound из CRM Chat

| `BotInstance.botType` | Outbound из reply |
|---|---|
| `gift` | Telegram Bot API (+ media) |
| `ai_tg` | Bot API + `business_connection_id` |
| `ai_gramjs` | `gramjs-bridge` `POST /messages/send` |
| `ai_wa` | `ai-whatsapp-worker` → Evolution (`digits@lid` для Linked ID) |

Внутренние вызовы: `VOXLY_SERVICE_TOKEN` (Bearer). Browser **не** ходит в bridge/Evolution напрямую.

## Паттерн Twenty App (crm-chat)

1. **Front** `defineFrontComponent` → `RestApiClient` на `/s/crm-chat/...` (workspace origin).
2. **Logic** `get-crm-chat` / `reply-crm-chat` / `get-crm-chat-file` → proxy на saas-api.
3. Tarball печётся в образ `saas-api`, ставится при provision (`ensureCrmChatAppInstalled`).
4. Remote DOM ограничения: remount composer (INC-016), host `dataBase64` для файлов (INC-017), JPEG shrink (INC-014/020).

## Деплой и данные

- Prod: только `./scripts/prod-deploy.sh` / `prod-diff.sh` (`docs/agent/DEPLOY.md`).
- Никогда не `docker compose down -v` на prod; не затирать `/opt/voxly/.env`.
- Local ≠ prod DB. Миграции control: `packages/db/prisma/migrations/`.

## Известные сбои (сначала INCIDENTS)

CRM Chat / каналы: INC-032 (GramJS 404 Gift-only), INC-033 (reply 400), INC-037 (WA CRM sync crash), INC-038 (WA `@lid` send), INC-039 (WA LID name/phone), INC-042 (stale recreate), INC-043 (LID→Contact phone), INC-044 (TG↔WA Person merge by phone). Полный список: `docs/agent/INCIDENTS.md`.
