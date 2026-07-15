# Voxly — Архитектура

## Обзор

Voxly — SaaS платформа на базе Twenty CRM для управления чат-ботами, AI-ассистентами и воронками продаж.

```
                    ┌─────────────────────────────────────────┐
                    │           Traefik (wildcard SSL)         │
                    │   *.getvoxly.ru → соответствующие сервисы │
                    └──────┬───────┬───────┬───────┬───────────┘
                           │       │       │       │
            ┌──────────────┘       │       │       └──────────────┐
            ▼                      ▼       ▼                      ▼
    getvoxly.ru            {slug}.getvoxly.ru  api.getvoxly.ru   {slug}-crm.getvoxly.ru
    (Landing + Admin)      (Client Portal)     (Control Plane)   (Twenty CRM workspace)
            │                      │              │
            ▼                      ▼              ▼
    ┌─────────────────┐    ┌──────────────────────────────────┐
    │  saas-portal     │    │          saas-api                │
    │  (Next.js)       │───▶│  (Fastify + Prisma + BullMQ)     │
    └─────────────────┘    │  - Auth (JWT)                    │
                           │  - Billing (Robokassa)            │
                           │  - Tenant management              │
                           │  - Referral program               │
                           │  - Analytics integration          │
                           │  - Bot provisioning               │
                           └───┬───────┬───────┬───────────────┘
                               │       │       │
                    ┌──────────┘       │       └──────────┐
                    ▼                  ▼                  ▼
          ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
          │ manager-bot-    │  │ gift-bot-    │  │ ai-telegram-     │
          │ service         │  │ worker       │  │ worker           │
          │ (Telegram       │  │ (воронки,    │  │ (AI Telegram)    │
          │  Managed Bots)  │  │  рассылки)   │  │                  │
          └─────────────────┘  └──────────────┘  └──────────────────┘
                                                              │
                                                    ┌──────────────────┐
                                                    │ ai-whatsapp-     │
                                                    │ worker           │
                                                    │ (AI WhatsApp)    │
                                                    └──────────────────┘
```

## Компоненты

### Control Plane (`apps/saas-api`)
- **Fastify** HTTP API + **Prisma** ORM + **BullMQ** jobs
- Аутентификация (JWT), биллинг (Robokassa), управление воркспейсами
- Маршруты: `/auth`, `/billing`, `/tenant`, `/admin`, `/referral`, `/bots`, `/analytics`

### Client Portal (`apps/saas-portal`)
- **Next.js** с middleware для определения тенанта по поддомену
- `getvoxly.ru` — лендинг + супер-админка
- `{slug}.getvoxly.ru` — клиентский портал (дашборд, настройки, биллинг)

### Twenty CRM (`twenty-server`)
- Self-hosted, multi-workspace mode
- `{slug}-crm.getvoxly.ru` — воркспейс конкретного клиента
- Расширяется через Twenty App `voxly-platform`

### Manager Bot Service (`apps/manager-bot-service`)
- Управляет Telegram Managed Bots (Bot Management Mode)
- Получает `ManagedBotUpdated` апдейты от Telegram
- Создаёт дочерние боты через `getManagedBotToken`

### Gift Bot Worker (`apps/gift-bot-worker`)
- Обрабатывает все gift-боты клиентов
- Воронки, проверка подписки на канал, рассылки, отложенные сообщения
- Создаёт сделки/контакты в Twenty CRM

### AI Telegram Worker (`apps/ai-telegram-worker`)
- AI-ассистент для Telegram
- OpenAI интеграция, per-tenant AI wallet, handoff оператору

### AI WhatsApp Worker (`apps/ai-whatsapp-worker`)
- AI-ассистент для WhatsApp Cloud API
- Переиспользует `@voxly/ai-core` для биллинга

## Пакеты

| Пакет | Назначение |
|-------|-----------|
| `@voxly/shared` | Константы, типы, product codes |
| `@voxly/db` | Prisma schema + клиент |
| `@voxly/billing` | Robokassa клиент (checkout, webhook, 54-ФЗ) |
| `@voxly/twenty-client` | GraphQL клиент для Twenty CRM |
| `@voxly/ai-core` | AI billing: chargeAiUsage, markup, wallet |
| `@voxly/analytics-dispatchers` | Offline conversions: Метрика, GA4, FB, VK |

## База данных

Control Plane использует PostgreSQL с Prisma. Схема включает:
- `Tenant`, `User`, `TenantMember` — мультитенантность
- `Subscription`, `Payment`, `Addon` — биллинг
- `AiWallet`, `AiUsageLog` — AI биллинг с наценкой
- `BotInstance`, `BotProvisionRequest` — управление ботами
- `ReferralCode`, `Referral`, `ReferralRule`, `ReferralEarning` — рефералы
- `AnalyticsIntegration`, `ConversionEvent`, `AttributionSession` — аналитика
- `PlatformSetting` — глобальные настройки
- `PricingOverride` — кастомное ценообразование

## Прайсинг

| Продукт | Цена |
|---------|------|
| CRM Base | 500 ₽/мес (10 польз. включено) |
| Доп. пользователь | 300 ₽/мес |
| Gift Bot | 500 ₽/мес за канал |
| AI Telegram | 1000 ₽/мес (до 10 аккаунтов) |
| AI WhatsApp | 1000 ₽/мес за номер |
| Аналитика | 500 ₽/мес за платформу |
| AI токены | По расходу + наценка (50% по умолч.) |

## Развёртывание

```bash
# 1. Заполнить .env
cp .env.example .env

# 2. Запустить инфраструктуру
cd docker
docker compose up -d

# 3. Применить миграции
docker compose exec saas-api npx prisma migrate deploy

# 4. Заполнить начальные данные
docker compose exec saas-api npx prisma db seed
```

## Домены

| Домен | Назначение |
|-------|-----------|
| `getvoxly.ru` | Лендинг + супер-админка |
| `api.getvoxly.ru` | Control Plane API |
| `app.getvoxly.ru` | Twenty CRM (default workspace) |
| `{slug}.getvoxly.ru` | Клиентский портал |
| `{slug}-crm.getvoxly.ru` | Twenty CRM workspace клиента |
