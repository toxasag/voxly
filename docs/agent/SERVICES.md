# Сервисы

## Apps

| App | Путь | Порт | Роль | Deps |
|---|---|---|---|---|
| **saas-api** | `apps/saas-api` | 3002 | Control plane: auth, billing, tenant, bots, admin, analytics, BullMQ | PG-control, Redis, Twenty GQL, TG Manager token |
| **saas-portal** | `apps/saas-portal` | 3001 | Лендинг, login/register, dashboard, bots UI, `/admin` | saas-api (`/api` rewrite) |
| **manager-bot-service** | `apps/manager-bot-service` | 3003 | Managed Bots: provision link, `getManagedBotToken`, encrypt token | PG-control, Redis, TG Manager Bot |
| **platform-bot-service** | `apps/platform-bot-service` | 3009 | `@GetVoxlybot`: OTP deep-link webhook + support inbox → saas-api | saas-api service token, PLATFORM_BOT_TOKEN |
| **gift-bot-worker** | `apps/gift-bot-worker` | 3004 | Воронка, подписка, gift, promo clicks, broadcasts, CRM sync, fireGoal | PG-control, Redis, Twenty, bot tokens |
| **ai-telegram-worker** | `apps/ai-telegram-worker` | 3005 | AI Telegram Business + OpenRouter + ASR/vision + `/internal/inbound` | PG-control, OpenRouter, Twenty |
| **gramjs-bridge** | `apps/gramjs-bridge` | 3008 | Personal TG QR session (profile `gramjs`) → AI worker | PG-control, Telegram api_id/hash, ai-telegram-worker |
| **max-bridge** | `apps/max-bridge` | 3010 | Personal MAX QR session (profile `max`, PyMax) → saas-api `/internal/max` | saas-api service token, session volume |
| **ai-whatsapp-worker** | `apps/ai-whatsapp-worker` | 3006 | AI WhatsApp Cloud API | PG-control, Redis, OpenAI, Twenty |

## Инфра (docker/)

| Service | Роль |
|---|---|
| `postgres-control` / `postgres-twenty` | БД control / CRM |
| `redis` | BullMQ + Twenty |
| `twenty-server` / `twenty-worker` | CRM UI+API / jobs (`voxly-twenty:2.22.0`) |
| `traefik` | Prod routing / SSL |

## Packages

| Package | Роль |
|---|---|
| `@voxly/db` | Prisma schema + client |
| `@voxly/shared` | pricing, defaults funnel/promo, `buildVoxlyBotUsername`, telegram-md, media helpers |
| `@voxly/billing` | Robokassa |
| `@voxly/twenty-client` | GraphQL Twenty |
| `@voxly/crypto` | AES-256-GCM |
| `@voxly/ai-core` | wallet / markup / usage |
| `@voxly/analytics-dispatchers` | Metrika/GA4/FB/VK S2S |

## Twenty App

`twenty-app/voxly-platform` — **stub** (старый manifest). Живой deal-card chat → заменить на `create-twenty-app` / twenty-sdk (`DECISIONS.md`). Не ставить custom ChatMessage как SoT.
