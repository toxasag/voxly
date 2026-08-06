# GramJS bridge (`@voxly/gramjs-bridge`)

Personal Telegram account sessions for Voxly AI Agents (SKU `ai_gramjs`, 500₽/mo + AI wallet).

## Role

- QR login (`/auth/qr/start|status|png|password`) — platform `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`
- Persist `StringSession` encrypted (`ENCRYPTION_KEY`) on `BotInstance` (`botType=ai_gramjs`)
- Inbound **text** → `POST {AI_TELEGRAM_WORKER_URL}/internal/inbound` → send bubbles via MTProto

## Auth

All routes except `/health` require `Authorization: Bearer {VOXLY_SERVICE_TOKEN}`.

## Compose

Optional profile — not started by default:

```bash
docker compose -f docker/docker-compose.yml --profile gramjs up -d gramjs-bridge
```

## Remaining (not in this scaffold)

- Portal UI for QR connect / inbox SKU checkout (Robokassa `ai_gramjs`)
- Hard billing gate (today: soft warn only)
- GramJS media → Whisper/vision (Bot API path already has ASR/vision)
- Human outbound → auto-pause 1h (wire `pauseOnHumanOutbound` via worker)
- Phone+code login (QR only for MVP)

## Env

| Var | Required |
|---|---|
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | yes for QR |
| `ENCRYPTION_KEY` | yes |
| `VOXLY_SERVICE_TOKEN` | yes |
| `DATABASE_URL` | yes |
| `AI_TELEGRAM_WORKER_URL` | default `http://ai-telegram-worker:3005` |
| `GRAMJS_BRIDGE_PORT` | default `3008` |
