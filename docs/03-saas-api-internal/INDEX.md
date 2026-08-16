# 03 — SaaS API (Внутренние контракты)

> Доменный модуль с внутренними контрактами saas-api: Telegram, MAX, CRM-enrich, auth-токены.

## Содержание

| Файл | Описание |
|------|-----------|
| [`telegram-internal-contracts.md`](telegram-internal-contracts.md) | Внутренние эндпоинты Telegram-интеграции |
| [`max-internal-contracts.md`](max-internal-contracts.md) | Контракты шлюза MAX |
| [`crm-enrich-contracts.md`](crm-enrich-contracts.md) | Обогащение контактов, телефонов и лидов |
| [`auth-and-token-contracts.md`](auth-and-token-contracts.md) | Сервисные токены, per-service fallback, верификация |
| [`crm-chat-write-first.md`](crm-chat-write-first.md) | Write-first «Пишем от:» (WA/MAX/TG), нормализация Telegram-линков, анти-дубли |

---

## Протокол синхронизации

При создании, переименовании или удалении файла — **ОБЯЗАТЕЛЬНО** обновить данный `INDEX.md`.
