# MAX bridge (`apps/max-bridge`)

Personal MAX account sessions for Voxly (SKU `ai_max`, 500₽/mo).

## Role

- QR login (`/auth/qr/start|status|png|password`) via **PyMax** `WebClient` + custom `QrHandler`
- Persist SQLite session files under `MAX_SESSION_DIR` (volume)
- Mark connected bots via saas-api `POST /api/internal/max/bots/upsert`
- Inbound DM → `POST /api/internal/max/inbound` → Conversation + ChatMessage + CRM
- Outbound CRM reply → `POST /messages/send`

## Auth

All routes except `/health` require `Authorization: Bearer {VOXLY_SERVICE_TOKEN}`.

## Compose

Optional profile — not started by default:

```bash
docker compose -f docker/docker-compose.yml --profile max up -d max-bridge
```

## Disclaimer

PyMax uses the **unofficial** MAX user API. Ban risk / breaking changes — shown in portal UI.

## Env

| Var | Required |
|---|---|
| `VOXLY_SERVICE_TOKEN` | yes |
| `SAAS_API_URL` | default `http://saas-api:3002` |
| `MAX_BRIDGE_PORT` | default `3010` |
| `MAX_SESSION_DIR` | default `/data/max-sessions` |
