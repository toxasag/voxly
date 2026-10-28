## 2026-10-27 — безопасный срез после сбоя провайдера

- Не повторялся внешний AI-вызов: прошлый запуск остановился на HTTP 429 `provider_account_unavailable` (нет capacity у OpenAI), что не является дефектом кода. Работа продолжена локальной детерминированной проверкой.
- verified: `/uploads/:filename` больше не публичен: нужен access JWT, файл доступен только при tenant-префиксе, кэширование отключено.
- verified: Evolution webhook оставлен на одном canonical `/api/internal/whatsapp/webhook`, секрет проверяется fail-closed; обработка payload переведена с `any` на `unknown`-narrowing.
- verified: `npm run typecheck` прошёл. Полный Vitest запущен; 146 тестов прошли, 2 уже существующих теста упали в `chat-write-first` и `stories-service`, не связанных с этим срезом.


## 2026-10-19 / 2026-10-20 — реализация дорожной карты Twenty CRM Gap Audit и боевой деплой

- verified: миграция `0035_junction_targets_and_timeline.sql` создала junction-таблицы `note_targets` и `task_targets` со строгой RLS-политикой `tenant_isolation`, перенесла существующие связи и засеяла вкладку `timeline` («Активность», position 20) для всех тенантов в `page_layout_tabs`. Применена в базе данных `getvoxly-db-1`.
- verified: бэкенд-сервис `TimelineService` (`timeline.service.ts`) и эндпоинт `GET /api/v1/crm/records/:type/:id/timeline` агрегируют в единый хронологический поток сообщения из мессенджеров (`deal_messages`), заметки (`notes`), задачи (`crm_tasks`) и смену стадий (`deal_stage_history`) с пагинацией и правами доступа.
- verified: компонент `RecordTimelineTab.tsx` отображает единый поток активности в стиле Twenty CRM Light Canvas с фильтрами по типам событий, поддержкой `NoteFormattedBody` для заметок (чеклисты, заголовки, списки) и выводом названия сделки при аудите смены стадий.
- verified: календарный вид задач `TasksCalendarView.tsx` на странице `/crm/tasks` со срезами задач, быстрыми чекбоксами и дедлайнами. Сервис `task-reminders.service.ts` выполняет автоматическую проверку приближающихся дедлайнов.
- verified: структурированный Markdown-редактор заметок `StructuredNoteEditor.tsx` с интерактивными чекбоксами в режиме чтения `NoteFormattedBody`.
- verified: модуль слияния дубликатов контактов `ContactMergeModal.tsx` на базе `Sheet`, кнопка слияния в `ContactCard.tsx`.
- verified: приём оплаты по счетам `InvoicePaymentModal.tsx` (`POST /api/v1/invoices/:id/pay`) и печатный заказ-наряд `RepairWorkOrderModal.tsx` с суммами прописью и вёрсткой А4.
- verified: авто-обогащение фавиконок сайтов через Google Favicon API и отображение аватаров контактов из мессенджеров через `customFields.avatar_url` в `RecordDetailShell.tsx` и `EntityChip.tsx`.
- verified: типизация `npm run typecheck` чиста в `backend` и `frontend`. Написан юнит-тест `use-timeline.test.tsx`.
- verified production: деплой на VPS 150.241.98.135 с пересборкой образов `getvoxly-backend:latest` и `getvoxly-frontend:latest` (Next.js 15, 34 маршрута). Все контейнеры `healthy`, внешние проверки `https://api.getvoxly.ru/health` и `https://getvoxly.ru/login` отдают HTTP 200, статические JS-файлы отдаются корректно.

## 2026-09-21 — устранение пробелов плана

- verified: перед изменениями сохранены 15+ исходных файлов и SHA-256 manifest в `~/.claude/backups/getvoxly/20260921-130930`; это локальный rollback, не backup production DB.
- verified: RecordField regression сначала дал 3 падения (Enter/Space дочерней кнопки, Enter ссылки), после проверки event.target/currentTarget — 7/7 passed. Возвращена директива `use client`. Исправление узкое, без нового переписывания компонента.
- verified: tenant-owner мог напрямую начислить себе 500 ₽ в audit DB; negative smoke воспроизвёл 200 вместо ожидаемого 403. Добавлен platform-owner guard. Теперь owner 403 без изменения баланса, platform-owner 200; UI скрывает ручное начисление от клиента. Production ещё содержит прежнее поведение — deploy не выполнялся.
- verified: audit runtime строго проверяет host/port/database/role/query; 9 тестов включают отказ remote/query override и очистку provider окружения.
- verified: viewer/platform fixtures, оба tenant с контрольными контактами, ремонт и invoice добавлены; tenant defaults переиспользуются. Повторное наполнение не меняет counts. Сидирование выполняется администратором только audit DB; RLS доказана отдельно приложением без BYPASSRLS.
- verified: 37 API/SQL smoke assertions, frontend 38 файлов / 265 tests, backend 16 файлов / 225 tests, обе типизации и отдельная audit typecheck прошли. Backend suite запускался в отдельной уникальной local test DB с чистым окружением.
- verified locally: deploy валидирует target, требует approval/restore reference, исключает audit/secret artifacts из rsync; .dockerignore исключает audit и скрипты. Добавлено сохранение source/DB archive/image IDs до выкладки и health gates. Пересоздаётся только target. 5 mock orchestration tests без SSH прошли. Сам deploy и восстановление на VPS не выполнялись.
- verified: VPS backend/frontend StartedAt остались 2026-09-04, restart 0, healthy; миграций 28, health ok. Только чтение.
- documented: план дополнен cutover/refund/ledger/reconciliation, миграцией исторических данных, get-side-effects, Twenty reference и доказательствами. Подробности и ограничения: `BROWSER_VERIFICATION.md`, `evidence/2026-09-21-checks.json`.
- blocked: production login, эталон Twenty, payment sandbox/live channels и restore rehearsal не предоставлены/не выполнены. Не объявлять полный перенос завершённым.
- pending: полные UI CRUD и viewports/dark; synthetic Escape в браузере не дал закрытия стека, статус не скрыт за зелёными unit tests.

## 2026-09-19 — Browser и безопасный стенд

- План согласован; production остаётся без изменений.
- verified: command-based Browser started via `.claude/launch.json`; docs listing rendered and production navigation attempt did not leave localhost (no proxy/auth rewrite used).
- verified: isolated audit DB `getvoxly_audit_<timestamp>` created with separate role; existing `getvoxly` and `getvoxly_local` were not touched.
- verified: isolated API `127.0.0.1:4100` health 200, unauthenticated CRM API 401; synthetic owner login 200; no provider credentials/transport entry points were passed to audit server.
- verified: isolated frontend `127.0.0.1:3100` rendered dashboard and contacts using real audit API; synthetic records appeared in Browser.
- verified: mobile viewport 375px dashboard had `scrollWidth === innerWidth` (375), no horizontal overflow.
- verified: frontend tests 36 files / 256 tests passed; frontend and backend typecheck passed.
- fixed locally: `RecordField` display wrapper changed from nested `<button>` to keyboard-accessible `div[role=button]`; this removed invalid nested button markup for relation chips. No production deploy.
- warning: local Browser login page correctly returned 503 for code request because audit server has no Telegram/MAX provider; password login was used only against synthetic local DB via in-page fetch, not production.
- blocked: authorized production UI and visual Twenty side-by-side comparison require user login/tenant choice and an available authenticated/reference workspace. Do not bypass OTP or extract production tokens.
- verified: audit Browser covered public landing/login, synthetic password login via local-only audit API, dashboard, contacts table, contact card, mobile 375px dashboard overflow, and no nested buttons after the fix.
- verified: preview processes stopped at end of audit; audit database is retained under an exact generated name for follow-up and was not auto-deleted.
- planned: UI Twenty parity matrix, targeted audit CRUD/tenant-isolation flows, then separate product slices.

- blocked до входа пользователя: авторизованный production UI. Никаких самостоятельных JWT и обхода OTP.
- Полный продуктовый перенос (платежи, каналы, AI) — отдельные срезы после baseline; не один большой deploy.

Секреты и персональные данные в журнал не записываются. Каждый verified пункт требует наблюдения/теста; запуск сервера сам по себе не означает успешный пользовательский сценарий.
