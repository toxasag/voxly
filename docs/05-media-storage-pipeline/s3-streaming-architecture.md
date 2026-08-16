# S3 Streaming Architecture

> Стриминг медиа в S3-совместимое хранилище без буферизации в RAM.

## Статус реализации: ⚠️ GAP

На момент аудита (2026-08-16) прямого S3/MinIO/R2 клиент-кода в репозитории **не обнаружено**. Медиа обрабатывается через следующие механизмы:

### Существующие медиа-пути

| Компонент | Как обрабатывает медиа |
|-----------|----------------------|
| Telegram Bot API | `getFile()` — скачивание через Telegram CDN |
| Evolution API (WhatsApp) | Медиа-URL возвращаются через API, скачивание по HTTP |
| Twenty CRM | `patch-twenty-file-base64.cjs` — **запрещает** Base64 в Postgres |
| AI-Telegram Worker | Медиа скачивается для Whisper STT (ASR) |
| AI-WhatsApp Worker | Медиа скачивается для AI-обработки |

### Ключевые функции медиа-обработки

- `extractAudioFromVideo` (`packages/ai-core/src/extract-audio.ts`) — извлечение аудио из видео для STT
- `to-jpeg` (`apps/saas-portal/src/lib/to-jpeg.ts`) — конвертация изображений в JPEG (frontend)

### Что планируется (согласно AGENTS.md)

- **S3/MinIO/Cloudflare R2** — хранилище медиа с presigned URL
- **Streaming upload** — без буферизации в RAM (pipe → S3)
- **TenantId isolation** — каждый тенант в отдельном префиксе/бакете

### Рекомендации

1. Реализовать `@voxly/media-storage` package с абстракцией S3.
2. Использовать `@aws-sdk/client-s3` с `Upload` streaming.
3. Presigned URL для чтения (GET) с TTL.
4. TenantId prefix: `s3://bucket/{tenantId}/media/{uuid}.{ext}`.

## Инварианты безопасности

- ❌ **Нет Base64 в Postgres** (Zero-Tolerance, см. `patch-twenty-file-base64.cjs`).
- Медиа-URL должны быть tenant-scoped.

## Риски

- **Текущий gap**: медиа хранится в Telegram/Evolution CDN — нет контроля.
- **При переходе на S3** — необходима миграция существующих медиа-ссылок.
