# MAX bridge (`apps/max-bridge`)

Personal MAX account sessions for Voxly (`channel = 'max'`).

## Role

- QR login (`/auth/qr/start|status|png|password`) via **PyMax** `WebClient` + `AutoRefreshQrAuthFlow`
- Persist SQLite session files under `MAX_SESSION_DIR` (volume) with `relogin=False`
- Encrypted session backup in `channel_accounts.credentials` via backend internal API
- Bidirectional status sync with Postgres (`/api/internal/max/bots/active|upsert|status|delete`)
- Inbound DM → `POST /api/internal/max/inbound` → Conversation + ChatMessage + CRM
- Outbound CRM reply → `POST /messages/send`

## Build & Deploy

`max-bridge` is built directly from this repo (`docker-compose.yml` uses `apps/max-bridge/Dockerfile` with root build context `.`).
Note: `/usr/local/bin/vf-deploy` syncs only `backend/` and `frontend/`. When `apps/max-bridge/` changes, deploy via:

```bash
sh scripts/deploy.sh max-bridge
# or directly to VPS:
rsync -az --delete --exclude '__pycache__' --exclude '*.pyc' -e ssh apps/max-bridge/ root@150.241.98.135:/opt/getvoxly/apps/max-bridge/
rsync -az -e ssh docker-compose.yml root@150.241.98.135:/opt/getvoxly/docker-compose.yml
ssh root@150.241.98.135 "cd /opt/getvoxly && docker-compose build max-bridge && docker-compose up -d --no-deps --force-recreate max-bridge"
```

## Auth

All routes except `/health` require `Authorization: Bearer {VOXLY_SERVICE_TOKEN}`.

## Env

| Var | Required |
|---|---|
| `VOXLY_SERVICE_TOKEN` | yes |
| `SAAS_API_URL` | default `http://backend:4000` |
| `MAX_BRIDGE_PORT` | default `3010` |
| `MAX_SESSION_DIR` | default `/data/max-sessions` |

