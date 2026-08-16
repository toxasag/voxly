# Presigned URLs & Security

> Генерация временных URL, изоляция по tenantId, запрет Base64 в Postgres.

## Статус реализации: ⚠️ GAP

На момент аудита (2026-08-16) presigned URL генерация **не реализована** — нет S3-клиента в коде.

### Существующие механизмы доступа к медиа

| Источник | Доступ | TTL |
|----------|--------|-----|
| Telegram Bot API | `getFile()` → временный URL | ~1 час |
| Evolution API (WhatsApp) | Медиа-URL через API | Variable |
| Twenty CRM | Patch: `patch-twenty-file-base64.cjs` — **запрещает** Base64 | N/A |

### Дизайн presigned URL (план)

При переходе на S3/MinIO/R2:

```
Генерация (saas-api):
  1. Загрузить медиа → s3://{bucket}/{tenantId}/{uuid}.{ext}
  2. Вернуть presigned GET URL с TTL (15-60 мин)

Чтение:
  - Клиент запрашивает presigned URL
  - S3 отдаёт файл напрямую (не через saas-api)
  - URL истекает по TTL
```

## Инварианты безопасности

- ❌ **Zero-Tolerance: нет Base64 медиа в Postgres** — только S3/R2 URL.
- Presigned URL scoped по `tenantId` (path prefix).
- TTL ограничивает время доступа.
- **Нет** прямого S3 access key на клиенте — только presigned URL.

## Риски

- **Текущий gap**: медиа URL от Telegram/Evolution могут истечь → broken images.
- **Presigned URL leak** — при передаче в логи/переменные окружения.
- **TTL too long** → риск несанкционированного доступа.
