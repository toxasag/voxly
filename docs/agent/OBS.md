# Observability (light)

## Health

| Сервис | URL |
|---|---|
| saas-api | `http://localhost:3002/health` |
| manager-bot-service | `http://localhost:3003/health` |
| gift-bot-worker | `http://localhost:3004/health` |
| ai-telegram-worker | `http://localhost:3005/health` |
| ai-whatsapp-worker | `http://localhost:3006/health` |
| twenty-server | `http://localhost:3007/healthz` |
| saas-portal | `http://localhost:3001/` (страница) |

## Docker logs

Из каталога `docker/`:

```bash
docker compose logs -f saas-api
docker compose logs -f saas-portal
docker compose logs -f gift-bot-worker
docker compose logs -f manager-bot-service
docker compose logs -f twenty-server twenty-worker
docker compose logs -f redis postgres-control
```

Имя сервиса = ключ в `docker-compose.yml`.

## Конвенция логов (не переписывать всё сразу)

- Ошибки внешних вызовов (Telegram, Twenty, Robokassa, OpenAI): **уровень + контекст** (tenantId/botId/jobId где есть) + сообщение ошибки, без секретов/токенов.
- Fastify: встроенный logger на saas-api.
- Workers: сейчас в основном `console` / простой HTTP health — достаточно для local; при новых багах сначала `INCIDENTS.md`, потом точечно усилить лог в месте падения.
- Не коммитить дампы с токенами из `.env`.
