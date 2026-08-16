# 04 — Воркеры и мосты

> Доменный модуль: AI-воркеры, MTProto-мост, MAX-шлюз, боты онбординга и вовлечения.

## Содержание

| Файл | Описание |
|------|-----------|
| [`ai-telegram-worker.md`](ai-telegram-worker.md) | AI-бот Telegram: LLM, RAG, handoff |
| [`ai-whatsapp-worker.md`](ai-whatsapp-worker.md) | AI-бот WhatsApp: fast ACK, Evolution API |
| [`whatsapp-from-me-outbound.md`](whatsapp-from-me-outbound.md) | Исходящие WhatsApp `fromMe`, LID/PN merge, no-AI invariant |
| [`gramjs-mtproto-bridge.md`](gramjs-mtproto-bridge.md) | MTProto-мост для сессий Telegram |
| [`max-fastapi-bridge.md`](max-fastapi-bridge.md) | Python/FastAPI шлюз MAX API |
| [`platform-and-gift-bots.md`](platform-and-gift-bots.md) | Боты онбординга и вовлечения |

---

## Протокол синхронизации

При создании, переименовании или удалении файла — **ОБЯЗАТЕЛЬНО** обновить данный `INDEX.md`.
