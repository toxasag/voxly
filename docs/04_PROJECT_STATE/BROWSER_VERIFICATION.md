# Проверка Browser и локального baseline

Обновлено 2026-09-21. Полная production/visual-приёмка не завершена; результаты ниже не подменяют её.

## Подтверждённые результаты

- Command-based встроенный Browser запускается конфигурациями `audit-backend`, `audit-frontend`.
- Backend 4100 и frontend 3100 работают только с audit DB; импорт `buildApp`, без запуска transport и регистрации webhooks.
- Локальный password-login с синтетическим владельцем: 200. Это не проверка production OTP. Токены не выводились.
- Контакты на 768px: ширина документа 768px, sidebar flex, переполнения нет.
- Открытие контакта и связанной компании: два dialog, параметры record/company сохранены, `button button` отсутствует.
- Enter от вложенной relation-кнопки не открывает редактор родителя. Полное browser-default keyboard activation дополнительно закреплено unit tests (Enter/Space).
- Billing: tenant-owner не видит кнопку ручного начисления, вместо неё сообщение об обращении к администратору. На 768px scrollWidth=innerWidth.
- Встроенный screenshot просмотрен, синтетические данные. Запрошенный mobile preset впоследствии оказался 450px в eval; не записываем это как проверку 375px.
- API smoke: 37 проверок login, CRUD, стадий сделки, ролей, platform credit и прямой SQL RLS; внешние провайдеры не вызываются.
- Повтор seed/fixtures не изменил количества записей (counts до/после совпали).
- Frontend: 38 файлов / 265 тестов; backend: 16 файлов / 225 тестов. Audit runtime: 9 тестов. Mock deploy: 5 тестов, SSH/rsync/curl подменены, на VPS не запускался.
- Typecheck frontend/backend и отдельный `tsconfig.audit.json` прошли. JavaScript audit scripts проходят Node syntax checks.

Машиночитаемые результаты: [evidence/2026-09-21-checks.json](evidence/2026-09-21-checks.json).

## Ограничения

- Synthetic Escape dispatch в Browser не закрыл вложенный стек. Не делаем вывод о дефекте UI по одному синтетическому событию; нужен настоящий keyboard interaction. Существующие overlay unit tests проходят.
- CRUD выполнялся через настоящие Fastify handlers/SQL (`app.inject`), не через все UI-формы. Это integration smoke, не полный пользовательский E2E.
- Dark mode и границы 360/767/1280 не закрыты этим прогоном.
- Production: внешний переход встроенной панели ранее не закрепился; обычный вход и tenant ещё не предоставлены. Не использовать ключи сервера для подделки сессии.
- Twenty workspace/версия для визуальной приёмки не предоставлены. Старые source comments не доказательство актуального pixel parity.
- GET вкладок может писать defaults; production обход не обещает отсутствие DB writes без анализа маршрутов.
- Предыдущие Server Reference ID ошибки на VPS не воспроизводились здесь, исправление не заявляется.

## Матрица Twenty-паритета

| Область | Существующая основа | Проверено сейчас | Что осталось |
|---|---|---|---|
| Оболочка | DashboardShell/Sidebar/Header | Sidebar на 768px | Эталон, tokens, dark, 360/767/1280 |
| Таблица | RecordTable/SyncedRecordTable | Реальный список, unit suite | UI resize/reorder/persistence, inline save/cancel |
| Канбан | DealsKanban + API стадий | API переход и повторное чтение | Browser DnD, мобильное перемещение, Twenty reference |
| Карточки | RecordDetailShell/TabsRenderer | Контакт+компания, relation click | Browser back/Escape, все вкладки, full-page |
| Поля | RecordField | 7 новых regression tests | Accessibility screen-reader review |
| Чат | Deal tabs + timeline API | Существующие unit tests | Sender/thread/media/unread/AI handoff parity |
| Биллинг | AiBalanceCard + guards | Owner 403, platform 200, UI owner gate | Robokassa sandbox и paid entitlements |
| Изоляция | JWT/permissions/RLS | Viewer 403, cross-tenant 404, SQL 0/42501 | Полная матрица всех сущностей и экспортов |

## Повторный запуск

1. Существующий `backend/.audit/runtime.json` не печатать и не копировать. Audit DB сохраняется, автоматического DROP нет.
2. `node backend/scripts/audit-seed.mjs`, затем `node backend/node_modules/tsx/dist/cli.mjs backend/scripts/audit-fixtures.ts`.
3. HTTP серверы запускаются через preview_start с именами из `.claude/launch.json`.
4. Синтетические пользователи: `owner@audit-alpha.test`, `manager@audit-alpha.test`, `viewer@audit-alpha.test`, `owner@audit-beta.test`, `platform@audit-alpha.test`; локальный пароль `AuditLocal12345`. Никогда не использовать эти credentials в production.
5. API smoke: `node backend/node_modules/tsx/dist/cli.mjs backend/scripts/audit-smoke.mjs`. Он создаёт синтетические операции и increment ручного платформенного кредита в audit DB; не считать его read-only.
6. Backend suite запускать с другой уникальной DB/ролью и очищенным provider окружением. Harness пересоздаёт test DB, не направлять его на визуальный стенд.
