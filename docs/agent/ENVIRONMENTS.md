# Environments: local vs prod

**SoT for how deploys work:** [`DEPLOY.md`](DEPLOY.md) + `./scripts/prod-deploy.sh`.  
**SoT for product surface:** [`CAPABILITIES.md`](CAPABILITIES.md).

## Two environments (never merge casually)

| | Local (dev laptop) | Prod (VPS `150.241.98.135`) |
|---|---|---|
| Code root | this git repo | `/opt/voxly` |
| DB | Colima Docker volumes | named volumes on VPS — **client data** |
| Secrets | root `.env` (local) | `/opt/voxly/.env` (600) — **never rsync** |
| Portal | `:3001` | `https://getvoxly.ru` |
| API | `:3002` | `https://api.getvoxly.ru` |
| Twenty | `:3007` / `{slug}.localhost:3007` | `https://app.getvoxly.ru` / `{slug}-crm.getvoxly.ru` |
| Compose | `docker-compose.yml` + **override** OK | `docker-compose.yml` + **`prod-npm.yml` only** (no override) |
| Edge | none / local Traefik | NPM → Traefik `:8880` ([`docs/NPM-EDGE.md`](../NPM-EDGE.md)) |

Rule: developing locally must **not** assume prod DB/content. Shipping is always **code → rebuild image**, never DB dump local→prod.

## What “match” means

1. **Process match** — agents/humans always use `prod-diff` → `prod-deploy` (documented, scripted).
2. **Code match** — hot files checksum-equal local ↔ `/opt/voxly` for the services you care about.
3. **Runtime match** — containers rebuilt from that code; smoke 200.

Process (1) is in place. Code (2) is **not fully equal** (see drift below). That is OK while working locally; before each prod ship, run `prod-diff` and deploy only the services you intend.

## Verified snapshot (2026-07-23, Business AI ship)

### Match (OK) — after `prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,gift-bot-worker,manager-bot-service,compose`

- API hot files: `queues.ts`, `crm-chat.ts`, `auth.ts`, `twenty-custom-domain.ts`, `Dockerfile`, `twenty-client`, `chat-panel.tsx`
- Portal: `globals.css`, landing, login, `dashboard/page.tsx`, `package.json` (+ AI/GramJS pages rsynced with tree)
- `ai-telegram-worker` `index.ts` + `package.json`
- Manager bot `index.ts`, gift-bot `package.json`
- `docker-compose.yml` + `docker-compose.prod-npm.yml`

### Drift / gaps still open

| Item | Notes |
|---|---|
| Twenty app re-apply | If CRM chat front already installed on workspaces, re-apply after `chat-panel` bake |
| Root SSH | Password auth via `SSHPASS` only (no laptop key) — rotate to key |
| Hard Robokassa `ai_gramjs` | Soft trial only; SKU payment later |

### Match update — GramJS (2026-07-23 ~16:10 MSK)

- `gramjs-bridge` running (`docker-gramjs-bridge-1`, `:3008`); `/health` ok.
- Prod `.env`: `TELEGRAM_API_*`, `ENCRYPTION_KEY`, `VOXLY_SERVICE_TOKEN`, `GRAMJS_BRIDGE_URL=http://gramjs-bridge:3008` (fixed from `:3010`), `OPENROUTER_API_KEY` present.
- Backup: `/opt/voxly/backups/20260723-130943/`.

### Deploy 2026-07-23 (success)

- Backup `/opt/voxly/backups/20260723-122938/`; Conversation AI columns migrated on control DB.
- Smoke: portal + API health **200**.

### Deploy 2026-07-24 (INC-043 WA Contact-book phone + composer placeholder)

- Services: `ai-whatsapp-worker`, `saas-api` (crm-chat **0.1.2**).
- Backup `/opt/voxly/backups/20260724-121355/`.
- Smoke: portal + API health **200**; john Persons backfilled `+79150946944`.

### Deploy 2026-07-26 (CRM presence 0.1.8)

- Services: `saas-api`, `gramjs-bridge`, `ai-whatsapp-worker` (not `evolution-api`).
- Backup `/opt/voxly/backups/20260726-000817/`.
- Smoke: portal + API health **200**; john crm-chat **0.1.8+**.

### Deploy 2026-07-26 (Evolution v2.3.7-lid + WA worker)

- Services: `evolution-api`, `ai-whatsapp-worker`.
- Backup `/opt/voxly/backups/20260726-002454/`.
- Image: `voxly-evolution-api:v2.3.7-lid` (LID patch 150 files). Session restored without QR; webhook includes `PRESENCE_UPDATE`.
- Smoke: portal + API health **200**.

### Deploy 2026-07-24 (INC-039 WA media/typing/LID + INC-040 error map)

- Services: `saas-api`, `ai-whatsapp-worker` (crm-chat tarball via saas-api).
- Backup `/opt/voxly/backups/20260724-103450/`.
- Smoke: portal + API health + app healthz **200**.

## Continue local work without breaking deploy

1. Feature only in git working tree / branch.
2. Verify on Colima (`localhost:3001/3002/3007`).
3. Do **not** ad-hoc rsync to VPS.
4. When ready: `prod-diff` → see what would change → `prod-deploy.sh --dry-run <svc>` → `prod-deploy.sh <svc>`.
5. Script backs up DBs, syncs whitelist, rebuilds, smokes HTTPS.
6. WORKLOG entry.

## What was checked in-repo (no VPS required)

- `scripts/prod-deploy.sh --dry-run` for `saas-portal`, `saas-api`, `twenty`, `compose` — exit 0
- Every path those dry-runs list **exists** locally
- Docs linked from `README.md`, `STACK.md`, `NPM-EDGE.md`, `steps.md` §4, cursor rule `prod-deploy-updates.mdc`

## What was **not** done

- Did **not** run a full live `prod-deploy.sh` of the new scripts themselves (scripts live on laptop; they push code to VPS).
- Did **not** auto-align the 3 drift files to prod (intentional — ship when you choose).
- Prod DB content ≠ local DB (by design).
