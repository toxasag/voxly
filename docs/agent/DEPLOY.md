# Prod deploy (safe)

Local Voxly and production are **separate**. Clients live only in **prod DB volumes**. Deploys update **code/images only**.

See also: [`ENVIRONMENTS.md`](ENVIRONMENTS.md) (local vs prod, last verified drift).

## Non-negotiables

- Never `docker compose down -v` (or any volume wipe) on prod.
- Never copy local `.env` over `/opt/voxly/.env`.
- Never use `docker-compose.override.yml` on prod.
- Never ad-hoc `rsync` of multiple files into one parent dir (that already wiped the landing `page.tsx`).
- Prefer **migrations** on control plane when schema changes — not blind `db push` on prod.
- `prod-deploy.sh` runs `prisma migrate deploy` automatically before container rebuild (for prisma-using services). Manual migration is no longer needed.

## Happy path

1. Develop + verify locally (`pnpm` / Colima).
2. Commit on a branch (so you can roll back locally).
3. Check drift: `./scripts/prod-diff.sh saas-portal` (or the services you will ship).
4. Dry-run: `./scripts/prod-deploy.sh --dry-run saas-portal`.
5. Deploy: `./scripts/prod-deploy.sh saas-portal`  
   (set `SSHPASS` if using password SSH; prefer SSH key).
6. Script does: **DB backup** → whitelist **rsync** → **`prisma migrate deploy`** (if prisma-using services) → `docker-compose … up -d --build` → HTTPS smoke (retries up to 60s per endpoint).
7. Append `docs/agent/WORKLOG.md` (services + verify). Update drift note in `ENVIRONMENTS.md` if you closed known gaps.

## Commands

```bash
# Compare hot files local ↔ /opt/voxly
./scripts/prod-diff.sh
./scripts/prod-diff.sh saas-api,saas-portal

# Deploy one or more services
./scripts/prod-deploy.sh --dry-run saas-portal
./scripts/prod-deploy.sh saas-portal
./scripts/prod-deploy.sh saas-api,saas-portal
./scripts/prod-deploy.sh twenty
./scripts/prod-deploy.sh compose   # sync compose files only, no rebuild

# Env overrides
VOXLY_PROD_HOST=150.241.98.135
VOXLY_PROD_USER=root
VOXLY_PROD_DIR=/opt/voxly
SSHPASS=…   # optional
```

On VPS compose is always:

```bash
cd /opt/voxly/docker
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env up -d --build <service>
```

Prisma migrations run inside the saas-api container (built before restart):

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env \
  run --rm saas-api sh -c "cd /voxly/packages/db && ./node_modules/.bin/prisma migrate deploy"
```

This is automated by `prod-deploy.sh` when deploying any prisma-using service (saas-api, gift-bot-worker, manager-bot-service, ai-telegram-worker, ai-whatsapp-worker, gramjs-bridge). If migration fails, deploy halts — prod stays on old code + old schema (safe).

## Service map (what gets synced)

| Service | Paths (high level) | Compose rebuild |
|---|---|---|
| `saas-portal` | root manifests, `packages/`, `apps/saas-portal/` | `saas-portal` |
| `saas-api` | root manifests, `packages/`, `apps/saas-api/`, `twenty-app/voxly-crm-chat/` | `saas-api` |
| `gift-bot-worker` | manifests, `packages/`, `apps/gift-bot-worker/` | `gift-bot-worker` |
| `manager-bot-service` | manifests, `packages/`, `apps/manager-bot-service/` | `manager-bot-service` |
| `ai-telegram-worker` | manifests, `packages/`, `apps/ai-telegram-worker/` | `ai-telegram-worker` |
| `gramjs-bridge` | manifests, `packages/`, `apps/gramjs-bridge/` | `gramjs-bridge` (needs compose `--profile gramjs` + `TELEGRAM_API_ID/HASH` on server; do not force if missing) |
| `twenty` | `docker/twenty.Dockerfile`, patch `*.cjs` | `twenty-server` `twenty-worker` |
| `compose` | `docker-compose.yml` + `prod-npm.yml` | — |
| `all-apps` | union of above (incl. ai-telegram-worker; not gramjs by default) | all app containers |

Rsync keeps **relative paths** (`apps/saas-portal/...` → `/opt/voxly/apps/saas-portal/...`). It never flattens several `page.tsx` into one folder.

## Smoke (script + manual)

The script's smoke test **retries each endpoint** every 3 seconds up to 60 seconds total, waiting for HTTP 200 after a cold start.  If an endpoint does not respond 200 within the timeout, the deploy exits non-zero.

Manual verification (if needed):

```bash
curl -Ik https://getvoxly.ru/
curl -Ik https://api.getvoxly.ru/health
curl -Ik https://app.getvoxly.ru/healthz   # if twenty rebuilt
```

Backups land in `/opt/voxly/backups/YYYYMMDD-HHMMSS/` (`voxly_control.dump`, `twenty.dump`).

## Agent rule

Use [`scripts/prod-deploy.sh`](../../scripts/prod-deploy.sh) only. See `.cursor/rules/prod-deploy-updates.mdc`.
Before claiming “local == prod”, run `./scripts/prod-diff.sh` and read [`ENVIRONMENTS.md`](ENVIRONMENTS.md).
