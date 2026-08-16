# AI AGENT WORKFLOW & SAFETY REGULATION (UNIVERSAL HIGHLOAD STANDARD)

Этот документ обязателен для исполнения любым AI-агентом (Cursor, Kilo Code, Windsurf, Claude Dev, Roo Code, Aider, ZCode и др.) при работе с репозиторием Voxly.

---

## 1. АДРЕСНЫЙ ПРОТОКОЛ НАВИГАЦИИ (SEARCH BEFORE EDIT)

Перед чтением и модификацией любого кода агент ОБЯЗАН:
1. Открыть `docs/INDEX.md` и определить целевой домен.
2. Открыть `docs/<домен>/INDEX.md` и найти точный файл спецификации.
3. Изучить спецификацию (`Callers`, `Dependencies`, `Invariants`, `Rollback Plan`).
4. Только после этого открывать исходный код и вносить изменения.

### 1.1. Порядок чтения при онбординге
1. `docs/01-system-core/system-overview.md` — общая топология.
2. `docs/01-system-core/tenancy-and-isolation.md` — мультитенантность.
3. `docs/01-system-core/billing-and-ai-balance.md` — биллинг и AI-баланс.
4. Доменный модуль по текущей задаче.

---

## 2. АВТОСОЗДАНИЕ ДОКУМЕНТАЦИИ И СИНХРОНИЗАЦИЯ ИНДЕКСОВ

- При создании **нового файла кода, эндпоинта, воркера или модуля**:
  1. Создать файл спецификации `.md` в соответствующей папке `docs/<домен>/`.
  2. Добавить запись о новом файле в локальный `docs/<домен>/INDEX.md`.
- При создании **нового архитектурного домена**:
  1. Создать директорию `docs/<новый-домен>/`.
  2. Создать локальный `docs/<новый-домен>/INDEX.md`.
  3. Добавить ссылку на новый домен в Главный Диспетчер `docs/INDEX.md`.

### 2.1. Формат спецификации
Каждый спецификационный файл ДОЛЖЕН содержать:
- **Исходные файлы кода** (пути относительно корня репозитория).
- **Экспортируемые функции** с точными сигнатурами TypeScript.
- **Callers / Inbound** — кто вызывает.
- **Dependencies / Outbound** — от кого зависит.
- **Инварианты безопасности** и риски поломки.

### 2.2. Mermaid-диаграммы
Все потоковые диаграммы — в формате Mermaid. Минимум: `docs/01-system-core/system-overview.md`.

### 2.3. Секреты
**ЗАПРЕЩЕНО** размещать реальные секреты — только плейсхолдеры `{{SECRET_NAME}}`.

---

## 3. КРИТИЧЕСКИЕ ИНВАРИАНТЫ (ZERO-TOLERANCE RULES)

- ❌ **Базы данных и миграции**: Запрещён `prisma db push` в проде. Только версионированные миграции `prisma migrate` без удаления колонок с живыми данными.
- ❌ **Балансы и биллинг**: Списание токенов `ai_balance` строго через атомарный SQL-декремент на уровне БД. Запрещена математика в памяти JS.
- ❌ **Изоляция тенантов**: Все запросы к БД обязаны содержать `{ where: { tenantId } }` (FindMany guards).
- ❌ **Вебхуки мессенджеров**: Обработчики входящих вебхуков ОБЯЗАНЫ отдавать HTTP `200 OK` за <100ms, перекладывая полезную нагрузку в BullMQ очереди.
- ❌ **Native outbound**: `message.out`/`key.fromMe` из MAX/WhatsApp нельзя пропускать через inbound/AI pipeline; сохранять как operator/fromMe с native external id и CRM-link.
- ❌ **Native outbound deal safety**: MAX/WhatsApp исходящие с устройства не создают новый Opportunity без уже найденного Person/Opportunity; только reconcile existing CRM match.
- ❌ **Kanban defaults**: поля Opportunity Kanban для новых порталов задаются только через ID-independent `OPPORTUNITY_KANBAN_CARD_FIELDS`; UUID конкретного tenant запрещено копировать.
- ❌ **Twenty CRM**: Любое изменение метаданных CRM требует вызова `twenty-redis-flush.ts`.
- ❌ **Контракты роутов**: Запрещено менять JSON-схему `*-internal.ts` без синхронного обновления всех вызывающих воркеров.
- ❌ **Хранение медиа**: Запрещено сохранять бинарники/Base64 в PostgreSQL — только стриминг в S3 (MinIO / Cloudflare R2).
- ❌ **Секреты**: Запрещено хардкодить токены, пароли и API-ключи в код или документацию (только ENV-переменные и плейсхолдеры).
- ❌ **PgBouncer**: Advisory locks через pgbouncer не работают — использовать `DIRECT_DATABASE_URL`.
- ❌ **TypeScript `any`**: Запрещён (кроме исключений с `// eslint-disable-next-line`).

---

## 4. ПРАВИЛО РАБОТЫ С МЁРТВЫМ КОДОМ И МУСОРОМ (CLEANUP REGULATION)

- ❌ **ЗАПРЕЩЕНО** удалять файлы без предварительной проверки AST-импортов, вызовов из Dockerfile, GitHub Actions и cron-скриптов.
- Перед удалением любого файла:
  1. Зафиксировать намерение в `docs/AUDIT_CLEANUP_CANDIDATES.md`.
  2. Проверить сборку `tsc --noEmit` и прогнать тесты.
  3. Отразить удаление и инструкцию по восстановлению в `docs/changelog/system-history.md`.

---

## 5. ТЕСТОВЫЙ ПРОТОКОЛ (TEST-DRIVEN VERIFICATION)

Любая задача считается завершённой ТОЛЬКО после:
1. Успешного прохождения `tsc --noEmit` во всех затронутых пакетах `apps/*`.
2. Успешного прогона тестов в `apps/saas-api/tests/`.
3. **Написания нового теста**, если добавился эндпоинт или изменилась бизнес-логика.

### 5.1. Обязательный прогон перед коммитом / PR

```bash
# 1. Typecheck
pnpm typecheck

# 2. Tests
pnpm test

# 3. Lint portal
pnpm --filter @voxly/saas-portal lint

# 4. Build
pnpm --filter @voxly/saas-api --filter @voxly/saas-portal build
```

Все шаги должны быть **зелёными** перед push.

---

## 6. ФИКСАЦИЯ ИЗМЕНЕНИЙ И ПЛАН ОТКАТА (POST-MODIFICATION PROTOCOL)

После успешного внесения правок и прохождения тестов агент ОБЯЗАН добавить запись в `docs/changelog/system-history.md` по шаблону:

```markdown
### [ГГГГ-ММ-ДД] <Краткое название изменения>
- **Причина (Why)**: Какая проблема решалась / задача реализовывалась.
- **Затронутые файлы**: Список изменённых/созданных файлов кода и документации.
- **Синхронизация индексов**: Какие `INDEX.md` были обновлены.
- **Влияние на систему (Impact)**: Затронуты ли воркеры, API-контракты, очереди или схемы БД.
- **Результаты тестов (Verification)**: Статус `tsc` и пройденные тесты.
- **План отката (Rollback Plan)**: Пошаговая инструкция для возврата к предыдущему состоянию.
```

### 6.1. Перед деплоем на прод
1. Зафиксировать контейнеры: `docker ps --format "{{.Names}}\t{{.Image}}"`.
2. Бэкап БД: `pg_dump -Fc voxly_control > /opt/voxly/backups/pre-deploy-$(date +%Y%m%d-%H%M).dump`.
3. **CRM Chat / Twenty front-компонент**: при изменении `twenty-app/voxly-crm-chat/`, `apps/saas-api/src/routes/crm-chat.ts`, `packages/twenty-client/` или logic-functions обязательно деплоить **вместе `saas-api,saas-worker`**. `saas-api` запекает tarball, `saas-worker` сравнивает sha1 с Redis-маркером и автоматически обновляет приложение во **всех существующих** воркспейсах; новые порталы получают тот же tarball при provisioning. Нельзя выкатывать только saas-api или править Twenty local-storage вручную.
4. Записать rollback-шаги в `docs/changelog/system-history.md`.
5. Выполнить деплой.
6. Проверить healthchecks (`docker ps` — все healthy) и логи `[crmchat-refresh]` при изменении CRM Chat.

---

## 7. СТРУКТУРА РЕПОЗИТОРИЯ

```
apps/
  saas-api/          — Express API (control plane)
  saas-portal/       — Next.js лендинг + админка
  ai-telegram-worker — Telegram AI-бот
  ai-whatsapp-worker — WhatsApp AI-бот (fast ACK)
  gramjs-bridge      — MTProto-мост (сессии Telegram)
  max-bridge         — MAX API шлюз (Python/FastAPI)
  platform-bot-service — Бот онбординга
  gift-bot-worker    — Бот вовлечения
  manager-bot-service — Менеджер-бот
packages/
  db/                — Prisma schema + миграции
  shared/            — Общие утилиты, service-auth
  crypto/            — Хеширование, подписи
  billing/           — Robokassa, AI-баланс
  ai-core/           — LLM-клиенты, RAG, usage-queue
  twenty-client/     — HTTP-клиент Twenty CRM
  analytics-dispatchers/ — Аналитика
docker/              — Dockerfiles, compose, patches
docs/                — Трёхуровневая адресная база знаний
```

---

## 8. PROD-ИНФРАСТРУКТУРА

| Компонент | Хост:Порт | Версия |
|-----------|-----------|--------|
| Traefik | `0.0.0.0:8880` | v3.6.6 |
| PostgreSQL (control) | `127.0.0.1:5433` | 16-alpine |
| PgBouncer | (internal) | v1.25.2-p0 |
| PostgreSQL (twenty) | `127.0.0.1:5434` | 16-alpine |
| Redis | `127.0.0.1:6379` | 7-alpine |
| Twenty CRM | (via Traefik) | 2.22.0 |
| Evolution API | (via Traefik) | v2.3.7-lid |
| SaaS API | (via Traefik) | latest |
| SaaS Portal | (via Traefik) | latest |

Prod-host: `150.241.98.135`, deploy-path: `/opt/voxly`.
