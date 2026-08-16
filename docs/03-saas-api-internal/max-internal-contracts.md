# MAX Internal Contracts

> Контракты шлюза MAX (Personal MAX API).

## Исходные файлы

- `apps/saas-api/src/routes/max.ts` — публичные MAX эндпоинты
- `apps/saas-api/src/routes/max-internal.ts` — внутренние эндпоинты (max-bridge → saas-api)
- `apps/max-bridge/src/main.py` — Python FastAPI sidecar

## MAX Bridge (Python/FastAPI)

`apps/max-bridge/` — **Python 3.12 / FastAPI** сервис.
Зависимости: `fastapi`, `uvicorn`, `httpx`, `qrcode`, `maxapi-python`.

### Ключевые эндпоинты max-bridge

| Порт | Описание |
|------|----------|
| 3010 | FastAPI сервер (MAX_BRIDGE_PORT env) |

Основная функция — проксирование MAX API запросов с авторизацией через SAAS_API_URL.

## Ключевые эндпоинты max-internal.ts

Вызываются max-bridge с сервисным токеном.

```typescript
function requireMaxService(request: { headers: Record<string, unknown> }, reply: ...): void
```

**Callers / Inbound:** max-bridge → saas-api

**Dependencies / Outbound:** `@voxly/shared` (verifyServiceToken)

## Инварианты безопасности

- Защита через per-service токен (`requireMaxService`).
- MAX sessions хранятся в `/data/max-sessions` (volume).
