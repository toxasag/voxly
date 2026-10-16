# Журнал выполнения

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
