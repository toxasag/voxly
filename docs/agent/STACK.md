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
| MAX | Personal: PyMax sidecar `max-bridge` (profile `max`); Gift: official Bot API in `gift-bot-worker` (`/max/…`, `GIFT_MAX_USE_POLLING`) |
| AI | OpenAI + `@voxly/ai-core` wallet/markup |
| Proxy (prod) | Traefik v3.6+ behind **Nginx Proxy Manager** (TLS) |
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
| gramjs-bridge (profile) | `:3008` | `GET /health` |
| platform-bot-service | `:3009` | `GET /health` |
| max-bridge (profile) | `:3010` | `GET /health` |
| postgres-control | `:5433` | `pg_isready` |
| postgres-twenty | `:5434` | `pg_isready` |
| redis | `:6379` | `redis-cli ping` |
| traefik (prod-like) | `:80`/`:443`, dashboard `:8080` | — |

Локально: Colima + Docker. TG: `GIFT_BOT_USE_POLLING` / `MANAGER_USE_POLLING` = true.
MAX personal: `docker compose --profile max up -d max-bridge`.


## Prod (VPS + NPM) — 2026-07-22

Host: `150.241.98.135` · code: `/opt/voxly` · secrets: `/opt/voxly/.env` (600) · **never** `docker compose … -v`.

```bash
cd /opt/voxly/docker
# Do NOT use docker-compose.override.yml on prod
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env up -d --build
# After first boot (empty control DB):
docker run --rm --network docker_voxly-net -e DATABASE_URL=… docker-saas-api:latest \
  sh -c 'cd /voxly && corepack enable && pnpm --filter @voxly/db exec prisma db push --schema=prisma/schema.prisma'
# then seed with SUPERADMIN_* from .env
```

| Edge | Binding |
|---|---|
| NPM | host `:80`/`:443` (existing) |
| Traefik | host `:8880`→80; dashboard `127.0.0.1:8088`; image **traefik:v3.6.6** (Docker 29 API) |
| Postgres/Redis | `127.0.0.1:5433/5434/6379` only |

**NPM Proxy Host (live id 5):** `getvoxly.ru`, `www`, `api`, `app` → `http://docker-traefik-1:80` on `automation_automation_net`, Websockets On, Force SSL, LE cert id **8** (HTTP-01). Traefik Host / HostRegexp (`*-crm` → Twenty, else portal).

**Wildcard gap:** `*.getvoxly.ru` needs LE **DNS-01** in NPM (no DNS API token on server). Tenant `{slug}` / `{slug}-crm` HTTPS not public until then. Host smoke still: `curl -H 'Host: …' http://127.0.0.1:8880/…`.

Smoke: `curl -Ik https://api.getvoxly.ru/health` · runbook `docs/NPM-EDGE.md` · **deploy** `docs/agent/DEPLOY.md` (`./scripts/prod-deploy.sh`, `./scripts/prod-diff.sh`).

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
