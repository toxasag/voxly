# MAX FastAPI Bridge

> Python/FastAPI sidecar для Personal MAX (PyMax).

## Исходные файлы

- `apps/max-bridge/src/main.py` — FastAPI приложение
- `apps/max-bridge/src/__init__.py`
- `apps/max-bridge/requirements.txt` — Python-зависимости
- `apps/max-bridge/Dockerfile`

## Технологии

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Runtime | Python | 3.12 (Docker) |
| Framework | FastAPI | 0.115.12 |
| HTTP client | httpx | 0.28.1 |
| QR | qrcode[pil] | ≥8.2 |
| MAX SDK | maxapi-python | ≥2.3.0 |
| ASGI | uvicorn[standard] | 0.34.2 |

## Конфигурация

| ENV | Default | Описание |
|-----|---------|----------|
| `MAX_BRIDGE_PORT` | 3010 | Порт FastAPI сервера |
| `SAAS_API_URL` | `http://saas-api:3002` | URL saas-api |
| `MAX_SESSION_DIR` | `/data/max-sessions` | Директория MAX-сессий |

## Функциональность

- Проксирование MAX API запросов к saas-api.
- Управление QR-кодами авторизации MAX.
- Хранение MAX-сессий в volume.

**Callers / Inbound:**
- `apps/saas-api/src/routes/max-internal.ts`
- MAX-клиенты (браузер/мобильный)

## Инварианты безопасности

- Авторизация через SAAS_API_URL сервисный токен.
- Сессии изолированы в `/data/max-sessions`.

## Риски

- **Python runtime** — отдельный от основного Node.js стека, нужен отдельный Docker image.
- **maxapi-python** — unofficial SDK, может сломаться при обновлении MAX API.

## Write-first отправка (2026-08-16)

`POST /messages/send` c `resolvePhone`: телефон → `_resolve_user_by_phone` → **`_resolve_dialog_chat_id(me_id, user_id)`** (`pymax.get_chat_id` — СИНХРОННЫЙ локальный XOR `me ^ user`, sync/coroutine-safe вызов; `add_contact` best-effort; INC-122) → `send_message(chat_id=…)`. Инвариант: MAX `send_message` принимает **id диалога**, не user_id (иначе `common.finder User not.found`). Возвращает `{ok, chatId}` — saas-api сохраняет его как platformUserId диалога.

Подробности: [`../03-saas-api-internal/crm-chat-write-first.md`](../03-saas-api-internal/crm-chat-write-first.md)
