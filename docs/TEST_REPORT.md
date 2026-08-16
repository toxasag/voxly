# 🧪 Voxly — Тест-отчёт

> Дата: 2026-08-16
> Branch: `feature/cross-channel-enrich-opp-activity`
> Среда: macOS (локальная, без Docker-сервисов)

---

## 1. Typecheck (`pnpm typecheck`)

| Пакет | Результат |
|-------|-----------|
| `@voxly/saas-api` | ✅ |
| `@voxly/saas-portal` | ✅ |
| `@voxly/ai-telegram-worker` | ✅ |
| `@voxly/ai-whatsapp-worker` | ✅ |
| `@voxly/gift-bot-worker` | ✅ |
| `@voxly/manager-bot-service` | ✅ |
| `@voxly/platform-bot-service` | ✅ |
| `@voxly/shared` | ✅ |
| `@voxly/crypto` | ✅ |
| `@voxly/billing` | ✅ |
| `@voxly/db` | ✅ |
| `@voxly/ai-core` | ✅ |
| `@voxly/twenty-client` | ✅ |
| `@voxly/analytics-dispatchers` | ✅ |
| **Итого** | **23/23 successful** |

---

## 2. Unit + Integration Tests (`pnpm test`)

| Метрика | Значение |
|---------|----------|
| Test Files | 17 passed · 5 skipped (22 total) |
| Tests | 163 passed · 15 skipped (178 total) |
| Duration | ~32s |

### Файлы тестов и покрытие

| Файл | Тесты | Статус | Что покрывает |
|------|-------|--------|---------------|
| `apps/saas-api/tests/status-transitions.test.ts` | 4 | ✅ passed | Переходы статусов |
| `apps/saas-api/tests/max-phone-guard.test.ts` | 3 | ✅ passed | Защита от мусорных телефонов через MAX |
| `apps/saas-api/tests/configurability.test.ts` | 1 | ✅ passed | Конфигурируемость параметров |
| `apps/saas-api/tests/findmany-guards.test.ts` | 2 | ✅ passed | Tenant-изоляция FindMany-запросов |
| `apps/saas-api/tests/scheduler-lock.test.ts` | 1 | ✅ passed | Redis-блокировка cron-задач |
| `apps/saas-api/tests/agent-capacity.test.ts` | 2 | ⏭ skipped | Лимиты агентов (требует Redis) |
| `packages/ai-core/tests/ai-usage-queue.test.ts` | 3 | ✅ passed | Очередь списания AI-баланса, idempotency key |
| `packages/ai-core/tests/no-debt.test.ts` | 3 | ✅ passed | Запрет ухода в минус |
| `packages/ai-core/tests/unit-economics.test.ts` | 3 | ✅ passed | Юнит-экономика (стоимость, маржа) |
| `packages/ai-core/tests/markup.test.ts` | 5 | ✅ passed | Наценка AI_MARKUP_PERCENT |
| `packages/ai-core/tests/rag.test.ts` | 8 | ✅ passed | RAG-пайплайн |

---

## 3. CI Pipeline (`.github/workflows/ci.yml`)

CI-пайплайн выполняет:
1. `pnpm install --frozen-lockfile`
2. `prisma generate`
3. `scripts/test-db.sh` (миграция + сид тестовой БД)
4. `pnpm --filter ... build` (7 пакетов)
5. `pnpm typecheck` (полный)
6. `pnpm test` (unit + integration)
7. `pnpm --filter @voxly/saas-portal lint`
8. `pnpm --filter @voxly/saas-api --filter @voxly/saas-portal build`

**Сервисы CI**: PostgreSQL 16 (test DB `voxly_test`), Redis 7.

---

## 4. Слепые зоны (рекомендации)

| Зона | Риск | Рекомендация |
|------|------|-------------|
| Идемпотентность вебхуков WhatsApp | Дублированная обработка при ретраях | Добавить тест с повторной отправкой одинакового webhook-id |
| Параллельное списание баланса | Race condition на `balanceRub` при двух одновременных запросах | Интеграционный тест с `Promise.all` на одном tenantId |
| Изоляция тенантов (cross-tenant) | FindMany без `tenantId` фильтра | Негативный тест: запрос данных tenant A под токеном tenant B |
| Быстрый ACK WhatsApp (<100ms) | Race между 200 OK и обработкой | E2E тест с замером времени до ответа |
| Robokassa `/result` подпись | Неправильная подпись → платёж молча принят | Тест с некорректным хешем |
| Evolution API reconnect | Долгий даун стриминга → рассинхронизация QRCodes | Мок-тест reconnet-логики |

---

## 5. Вывод

**Текущее покрытие — адекватное для core-логики** (биллинг, изоляция, cron-локи, RAG, economics). Слепые зоны сосредоточены в интеграционных сценариях (webhook idempotency, параллельные списания, cross-tenant негативные тесты). Приоритет — покрыть таблицу выше перед релизом multi-tenant масштабирования.
