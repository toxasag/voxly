# Данные

## Хранилища

| Store | Host port | DB / роль | Кто ходит |
|---|---|---|---|
| **postgres-control** | `5433` | `voxly_control` — tenants, billing, bots, chat, analytics | saas-api, manager-bot, gift-bot-worker, ai-* workers (Prisma) |
| **postgres-twenty** | `5434` | `twenty` — CRM workspaces (People, Opportunities, …) | twenty-server/worker; Voxly пишет через GraphQL `@voxly/twenty-client` |
| **Redis** | `6379` | BullMQ queues, Twenty cache/sessions | saas-api, workers, twenty-* |

Схема control: `packages/db/prisma/schema.prisma`. Локально часто `db push` (не migrate). Seed: `packages/db/prisma/seed.ts` (superadmin).

## Ключевые Prisma-модели (control)

| Модель | Назначение | R/W |
|---|---|---|
| `Tenant`, `User`, `TenantMember` | мультитенант + auth | saas-api |
| `Subscription`, `Payment`, `Addon` | биллинг / trial CRM 14д | saas-api (Robokassa) |
| `AiWallet`, `AiUsageLog`, `TenantBalance` | AI billing + markup | saas-api, ai-core, AI workers |
| `BotInstance`, `BotProvisionRequest` | Managed Bots tokens (AES); `defaultAiAgentId` | saas-api, manager-bot R/W token |
| `AiAgent` | Tenant AI agents (prompt/settings); assign via bot/conversation | saas-api + ai-telegram-worker |
| `Conversation`, `ChatMessage` | **SoT чата** (+ `aiAgentId` override; null+null default = AI off) | gift/AI workers + saas-api reply |
| `GiftCampaignConfig` | funnelJson, promoPost, channel | saas-api R/W; gift-worker R |
| `GiftSubscriber` | фаза воронки, phone, twenty ids | gift-worker R/W; saas-api R (+ reply) |
| `Broadcast` | рассылки | saas-api create; gift-worker send |
| `ReferralCode/Referral/…` | рефералка | saas-api |
| `AnalyticsIntegration`, `AttributionSession`, `ConversionEvent`, `TrackingLink` | S2S аналитика; у ConversionEvent есть `campaignId`/`botInstanceId` | saas-api, gift-worker `fireGoal`, analytics-dispatchers |
| `PlatformSetting`, `PricingOverride`, `AuditLog` | супер-админ | saas-api |

## Twenty CRM (не Prisma control)

- Workspace per tenant; locale `ru-RU`, opportunity → «Сделки».
- Gift `/start` → Person + Opportunity; сообщения в Prisma `ChatMessage`; UI чата = портал + deal-card inject.
- Связка: `GiftSubscriber.twentyPersonId` / `twentyOpportunityId`.
- API чата CRM: `GET/POST /api/crm/chat/:opportunityId`.
- App stub: `twenty-app/voxly-platform` (legacy); SDK deal-chat — PENDING (`DECISIONS.md`).

## Redis / очереди

- `apps/saas-api/src/jobs/queues.ts` — provisioning, email (stub), др.
- gift-bot-worker — delayed funnel / broadcast jobs (`jobId` без `:`).
- Redis AOF включён; битый AOF → см. `INCIDENTS.md`.
