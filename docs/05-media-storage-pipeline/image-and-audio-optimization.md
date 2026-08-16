# Image & Audio Optimization

> Сжатие изображений, конвертация аудио для Whisper STT.

## Статус реализации: ⚠️ PARTIAL

### Аудио (реализовано)

| Функция | Файл | Описание |
|---------|------|----------|
| `extractAudioFromVideo` | `packages/ai-core/src/extract-audio.ts` | Извлечение аудио-дорожки из видео (ffmpeg) |
| Whisper STT | AI workers | Распознавание речи через Whisper API |

**Лимиты:**
- `ASR_MEDIA_MAX_BYTES` = 20MB (Telegram Bot API getFile limit)
- `ASR_VIDEO_MAX_DURATION_SEC` = 180s (пропуск длинных видео)

### Изображения (частично)

| Функция | Файл | Описание |
|---------|------|----------|
| `to-jpeg` | `apps/saas-portal/src/lib/to-jpeg.ts` | Frontend: конвертация в JPEG |

### Планируемое (GAP)

- **WebP сжатие** через `sharp` — не обнаружено в коде.
- **Image resizing** — нет серверной обработки.
- **Audio transcoding** для WhatsApp voice messages — нет явной конвертации.

### Рекомендации

1. Добавить `sharp` для серверного WebP/AVIF сжатия при загрузке.
2. Стандартизировать audio format (opus/ogg для WhatsApp, mp3 для Telegram).
3. Thumbnail generation для больших изображений.

## Инварианты

- Аудио лимитируется по размеру и длительности (защита от DoS через большие файлы).
- `DOC_MEDIA_MAX_BYTES` — лимит документов для AI-обработки.

## Риски

- **ffmpeg dependency** — требуется в Docker-образе воркера.
- **Whisper API cost** — отсутствие кэширования повторных транскрипций.
