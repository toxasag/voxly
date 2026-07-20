# Стек и локальный запуск

> Секреты только в `.env` (см. `.env.example`). Здесь — порты и команды.

## Стек

| Слой | Технология |
|---|---|
| Monorepo | pnpm 9 + Turborepo, Node ≥20 |
| Control API | Fastify + Prisma + BullMQ |
| Portal | Next.js (app router), Tailwind v4 + shadcn |
| CRM | Twenty self-hosted multi-workspace **v2.22.0** (`voxly-twenty:2.22.0`) |
| Очереди / кэш | Redis 7 (AOF), BullMQ |
| БД | PostgreSQL 16 ×2 (control + twenty) |
| Платежи | Robokassa |
| Telegram | Managed Bots (Bot API 9.6+), локально long-poll |
| AI | OpenAI + `@voxly/ai-core` wallet/markup |
| Proxy (prod) | Traefik v3 |
| Crypto | AES-256-GCM (`@voxly/crypto`, `ENCRYPTION_KEY`) |

## Локальные порты (docker-compose.override)

| Сервис | Host | Health |
|---|---|---|
| saas-portal | `:3001` → container `:3000` | страница `/` |
| saas-api | `:3002` | `GET /health` |
| manager-bot-service | `:3003` | `GET /health` |
| gift-bot-worker | `:3004` | `GET /health` |
| ai-telegram-worker | `:3005` | `GET /health` |
| ai-whatsapp-worker | `:3006` | `GET /health` |
| twenty-server | `:3007` → `:3000` | `/healthz` |
| postgres-control | `:5433` | `pg_isready` |
| postgres-twenty | `:5434` | `pg_isready` |
| redis | `:6379` | `redis-cli ping` |
| traefik (prod-like) | `:80`/`:443`, dashboard `:8080` | — |

Локально: Colima + Docker. TG: `GIFT_BOT_USE_POLLING` / `MANAGER_USE_POLLING` = true.

## Как поднять

```bash
# из docker/
docker compose --env-file ../.env up -d

# точечно
docker compose --env-file ../.env up -d --build saas-portal saas-api

# без Docker (dev)
pnpm install
pnpm --filter @voxly/saas-api dev
pnpm --filter @voxly/saas-portal dev   # нужен API + rewrite /api → saas-api
```

Проверки монорепо: `pnpm typecheck` · `pnpm build` · `pnpm test` · `pnpm db:generate` / `db:push`.

Портал проксирует `/api/*` → `SAAS_API_URL` (`apps/saas-portal/next.config.ts`).

Логи и health подробно: `OBS.md`.
