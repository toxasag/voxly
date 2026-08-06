# MAX — smoke runbook (Phase 1 personal + Phase 2 gift)

## Personal (`ai_max`)

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml --profile max up -d --build max-bridge saas-api saas-portal
curl -s http://localhost:3010/health
```

1. `/dashboard/ai/max` → trial → QR → authorized  
2. DM → CRM «MAX · личный» → reply  
3. Restart `max-bridge` → session restore  

## Gift (`gift_max`, SKU `gift_bot_max` — отдельный продукт)

```bash
# local poll (no HTTPS webhook)
# GIFT_MAX_USE_POLLING=true already in docker-compose.override for gift-bot-worker
docker compose … up -d --build gift-bot-worker saas-api saas-portal
```

1. `/dashboard/bots/max` → trial/оплата `gift_bot_max` → token → connect  
2. Открыть бота в MAX → `bot_started` → welcome + «Продолжить»  
3. Кнопка → подарок (link/caption) + lead в CRM  
4. Inbound text → CRM «MAX · бот подарков» → reply из CRM  

Telegram gift: `/dashboard/bots` + SKU `gift_bot` (не смешивать).  

**Gap:** проверка подписки на канал MAX не как TG `getChatMember` — кнопка soft-pass.  
**Prod webhook:** `GIFT_BOT_WEBHOOK_BASE_URL=https://api.getvoxly.ru` → `/max/{tenantId}/{botId}` (HTTPS only).
