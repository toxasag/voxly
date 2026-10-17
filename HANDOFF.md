# GETVOXLY — Паспорт проекта и деплой

> ⚡ **Мгновенный контекст проекта (Память проекта):**
> - **Продукт:** B2B SaaS модульная платформа CRM (Core CRM, сервис-центр, финансы, AI-боты).
> - **Боевой прод:** https://getvoxly.ru/ и https://api.getvoxly.ru/
> - **Боевой сервер (VPS):** IP `150.241.98.135`, путь `/opt/getvoxly` (SSH `root@150.241.98.135`).
> - **Стек:** Fastify 5 (TypeScript, ESM, порт 3001), Next.js 15 App Router (порт 3000), PostgreSQL 16 + RLS, Redis 7 + BullMQ.
> - **Документация:** Вся документация по архитектуре, модулям и деплою лежит в папке `docs/` (`docs/05_OPERATIONS/05_01_SERVER_ACCESS.md`).
> - **СТРОЖАЙШАЯ ИЗОЛЯЦИЯ:** Запрещено выходить за пределы репозитория GETVOXLY или трогать другие проекты на сервере (vertex-siam, freelance-hunter).
