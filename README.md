# Voxly

SaaS CRM platform built on [Twenty CRM](https://github.com/twentyhq/twenty) with Telegram bots, AI agents, referral program, and cross-platform analytics.

## Quick Start

```bash
# 1. Copy env
cp .env.example .env
# Edit .env with your credentials

# 2. Install dependencies
pnpm install

# 3. Generate Prisma client
pnpm db:generate

# 4. Run database migrations
pnpm db:migrate

# 5. Start infrastructure (Docker)
cd docker && docker compose up -d

# 6. Start dev servers
pnpm dev
```

## Architecture

```
getvoxly.ru              → Landing + super-admin
{slug}.getvoxly.ru       → Client portal (billing, bots, referrals)
{slug}-crm.getvoxly.ru   → Twenty CRM workspace
api.getvoxly.ru          → Control plane API
```

See [Plan](docs/ARCHITECTURE.md) for full architecture.

## Stack

- **CRM**: Twenty CRM (self-hosted, multi-workspace)
- **Control Plane**: Node.js + Fastify + Prisma + PostgreSQL
- **Portal**: Next.js (multi-host)
- **Bots**: Node.js workers + BullMQ + Redis
- **Payments**: Robokassa
- **Telegram**: Managed Bots API (Bot API 9.6+)
- **AI**: OpenAI with per-tenant wallet + 50% markup

## License

UNLICENSED — proprietary
