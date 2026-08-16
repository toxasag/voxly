# 📋 Voxly — Диспетчер документации

> Главный навигационный хаб по всей платформе Voxly CRM+AI.
> Все доменные модули содержат локальный `INDEX.md` со ссылками на спецификации.

---

## 🗺 Карта подсистем

| Модуль | Путь | Описание | Статус |
|--------|------|-----------|--------|
| **01 — Ядро системы** | [`01-system-core/`](01-system-core/INDEX.md) | Топология, мультитенантность, биллинг, cron-локи, БД и миграции | ✅ |
| **02 — Twenty CRM Engine** | [`02-twenty-crm-engine/`](02-twenty-crm-engine/INDEX.md) | Воркспейсы, участники, воронки, RU-дефолты, кэш, дедупликация | ✅ |
| **03 — SaaS API (внутренние контракты)** | [`03-saas-api-internal/`](03-saas-api-internal/INDEX.md) | Telegram, MAX, CRM-enrich, auth-токены | ✅ |
| **04 — Воркеры и мосты** | [`04-workers-and-bridges/`](04-workers-and-bridges/INDEX.md) | AI-Telegram, AI-WhatsApp, GramJS, MAX-bridge, Platform/Gift боты | ✅ |
| **05 — Медиа-пайплайн** | [`05-media-storage-pipeline/`](05-media-storage-pipeline/INDEX.md) | S3-стриминг, оптимизация, presigned URL | ✅ |
| **Changelog & ADR** | [`changelog/`](changelog/INDEX.md) | Журнал изменений, rollback-планы, архитектурные решения | ✅ |
| **Аудит мусора** | [`AUDIT_CLEANUP_CANDIDATES.md`](AUDIT_CLEANUP_CANDIDATES.md) | Реестр кандидатов на удаление | ✅ |
| **Тест-отчёт** | [`TEST_REPORT.md`](TEST_REPORT.md) | Покрытие, результаты прогонов, слепые зоны | ✅ |

---

## 🏗 Топология платформы (кратко)

```
                    Internet
                       │
                   Traefik (SSL/TLS)
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   saas-portal     saas-api      app.getvoxly.ru
   (Next.js)       (Express)    (Twenty CRM)
        │              │              │
        └──────┬───────┘              │
               │                  postgres-twenty
          pgbouncer-control            redis
               │
          postgres-control
               │
             redis (BullMQ, locks, cache)
               │
    ┌──────────┼──────────┐─────────────┐
    │          │          │             │
 ai-telegram  ai-whatsapp gramjs-bridge  max-bridge
    │          │          │             │
 platform-bot gift-bot  manager-bot   evolution-api
```

---

## 📐 Протокол навигации

1. **Каждый модуль содержит `INDEX.md`** — входная точка с оглавлением и ссылками.
2. **Каждый спецификационный файл** содержит: исходные файлы кода, экспортируемые функции с сигнатурами, Callers/Inbound, Dependencies/Outbound, инварианты безопасности, риски поломки.
3. **При добавлении файла** — обновить `INDEX.md` родительского модуля и (если нужно) этот главный `INDEX.md`.
4. **При изменении архитектуры** — зафиксировать ADR в `changelog/adr/` и запись в `changelog/system-history.md`.

---

## 🔐 Безопасность

- **Запрещено** размещать реальные секреты, токены, пароли в документации. Используются плейсхолдеры: `{{SECRET_NAME}}`.
- Prod-хост: `150.241.98.135` (только для инфраструктурных ссылок).

---

## 📊 Текущий статус (2026-08-16)

- **Branch**: `feature/cross-channel-enrich-opp-activity`
- **Typecheck**: 23/23 ✅
- **Tests**: 163 passed, 15 skipped (17 files) ✅
- **Prod uptime**: 38 дней
- **Twenty**: v2.22.0 | **PgBouncer**: v1.25.2-p0 | **Traefik**: v3.6.6 | **Evolution API**: v2.3.7-lid
