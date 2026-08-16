# 05 — Media Storage Pipeline

> Доменный модуль: медиа-пайплайн, S3-стриминг, оптимизация изображений/аудио, presigned URL.

> **Внимание:** часть возможностей описана как **планируемые/гэпы** — конкретные реализации в коде на момент аудита (2026-08-16) отсутствуют.

## Содержание

| Файл | Описание |
|------|-----------|
| [`s3-streaming-architecture.md`](s3-streaming-architecture.md) | S3/MinIO/R2 стриминг, статус реализации |
| [`image-and-audio-optimization.md`](image-and-audio-optimization.md) | Сжатие WebP, конвертация аудио для Whisper STT |
| [`presigned-urls-and-security.md`](presigned-urls-and-security.md) | Presigned URL, изоляция по tenantId, запрет Base64 в PG |

---

## Протокол синхронизации

При создании, переименовании или удалении файла — **ОБЯЗАТЕЛЬНО** обновить данный `INDEX.md`.
