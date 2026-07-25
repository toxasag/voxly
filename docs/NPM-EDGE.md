# NPM → Voxly Traefik

NPM (`automation-npm-1`) terminates TLS on :443 and forwards HTTP to Traefik on the shared Docker network `automation_automation_net`.

## Live Proxy Host (2026-07-22)

| Field | Value |
|---|---|
| NPM host id | **5** |
| Domains | `getvoxly.ru`, `www.getvoxly.ru`, `api.getvoxly.ru`, `app.getvoxly.ru` |
| Forward | `http://docker-traefik-1:80` (container port; **not** host 8880) |
| Websockets | ON |
| Force SSL | ON |
| HTTP/2 | ON |
| Certificate | Let's Encrypt id **8** (HTTP-01), expires ~2026-10-20 |

## Wildcard Proxy Host (2026-07-22)

| Field | Value |
|---|---|
| NPM host id | **6** |
| Domains | `*.getvoxly.ru` |
| Forward | `http://docker-traefik-1:80` |
| Websockets | ON |
| Force SSL | ON |
| Certificate | custom **npm-9** = Let’s Encrypt `*.getvoxly.ru` (DNS-01 via reg.ru API + certbot), expires ~2026-10-20 |

Issued on VPS with `certbot` + `/root/letsencrypt-regru/` hooks (`zone/add_txt` / `zone/remove_record`). Renew: certbot timer + deploy hook copies into `/opt/automation/npm_letsencrypt/archive/npm-9` and reloads NPM. Apex (`getvoxly.ru`) stays on host **5** / cert **8** (HTTP-01).

DNS NS: `ns1.reg.ru` / `ns2.reg.ru`. Wildcard A already points at this VPS.

## Smoke

```bash
curl -Ik https://getvoxly.ru/
curl -Ik https://api.getvoxly.ru/health
curl -Ik https://app.getvoxly.ru/healthz
curl -Ik https://demo.getvoxly.ru/
curl -Ik https://demo-crm.getvoxly.ru/healthz
# internal (bypass NPM):
curl -H "Host: api.getvoxly.ru" http://127.0.0.1:8880/health
```

Compose: `/opt/voxly/docker` with `docker-compose.yml` + `docker-compose.prod-npm.yml`.
Secrets: `/opt/voxly/.env` (chmod 600). Never `docker compose down -v`.
DB backup before NPM API work: `/opt/automation/npm_data/database.sqlite.bak.*`

**Code deploy:** use repo scripts only — see [`docs/agent/DEPLOY.md`](agent/DEPLOY.md):

```bash
./scripts/prod-diff.sh saas-portal
./scripts/prod-deploy.sh --dry-run saas-portal
./scripts/prod-deploy.sh saas-portal
```
