# План функционального паритета

Статус: локальные safety-патчи и проверки выполнены 2026-09-21; функциональный перенос и авторизованная production-приёмка ещё не завершены. Журнал — `IMPLEMENTATION_LOG.md`, доказательства — `BROWSER_VERIFICATION.md`.

## Обязательные условия допуска

1. Production не изменять без отдельного согласования релиза. Наличие зелёных тестов не является разрешением на deploy.
2. Перед изменениями сохранять backup исходников и SHA-256 manifest вне deploy-tree. Текущий snapshot: `~/.claude/backups/getvoxly/20260921-130930`.
3. Audit credentials/fixtures исключать из rsync и Docker context, а не только из Git. Проверять это тестами deploy orchestration без SSH.
4. Только выбранные сервисы пересоздаются. До rsync сохранить код, immutable image IDs/rollback tags и свежий DB dump. `pg_restore --list` проверяет читаемость архива, но НЕ заменяет успешный isolated restore.
5. Миграции expand-first: прежний образ должен работать с новой схемой. После новых платежей/сообщений нельзя автоматически восстанавливать старую БД — будет потеря записей. Откат кода отдельно от сверки и компенсации финансовых операций.
6. Health gates требуют healthy контейнеры и HTTP 200 изнутри/снаружи, плюс функциональный smoke. После ошибки не продолжать релиз и не перезапускать всё подряд.
7. GET не всегда read-only: page-layouts/deals могут вызвать `ensureTenantDefaults`. Production UI обход требует проверки побочных эффектов и обычного входа пользователя. Не подменять JWT и не извлекать токены из БД.
8. Локальный smoke использует только `getvoxly_audit_*`, отдельные роли без BYPASSRLS и окружение без provider credentials. Backend suites используют другую одноразовую test DB.

## Порядок и приёмка baseline

- Safety scripts и точечные regression fixes первыми; далее payments sandbox и согласованный Twenty эталон, затем channels/AI.
- Audit seed не должен дублировать CRM при повторе; нужны два tenants с различимыми записями и owner/manager/viewer.
- CRUD API: create/read/update/delete contact/company/task/note, stage transition сделки, повторное чтение после изменений; чужой tenant получает 404, viewer получает 403 при записи; прямой SQL под app role не видит чужие строки и отклоняет запись.
- UI: реальный login-поток отдельно от synthetic password shortcut, CRUD через формы отдельно от API smoke, focus/Enter/Space/Back/Escape и вложенные карточки. Успех API не считать завершённым browser E2E.
- Evidence: точный viewport, тема, endpoint, результат и ограничения; нулевую ширину скрытой Browser-панели не принимать за корректный замер. Скриншоты только с синтетикой.
- Backend `tsconfig.json` не покрывает audit scripts: отдельно `tsconfig.audit.json`, Node syntax checks, audit-runtime tests.


## Правило работы

Каждый срез имеет: donor CRM-PLUS → native target GETVOXLY → schema/permissions → UI Twenty-shaped → tests → staging smoke → rollback. Production не меняется до отдельного approval после staging evidence.

## Приоритет 0 — безопасность и наблюдаемость

- Закрыть подтверждённый nested-button DOM/a11y дефект и добавить regression test.
- Разделить `manual admin credit` и клиентское платное AI-пополнение.
- Добавить sanitized production smoke и журнал container/migration/source evidence.
- Объяснить/исправить frontend Server Reference ID errors на staging, не скрывая их в логах.

## Приоритет 1 — платежи

Donor: `CRM-PLUS/packages/billing/src/index.ts`, billing tests, fulfilment logic.

Native target:
- provider interface + Robokassa implementation;
- PostgreSQL payment ledger, event/idempotency record, subscription entitlement;
- safe atomic invoice number allocation (sequence/transactional allocation, не старый race);
- signed receipt/result amount checks;
- AI wallet topup только после paid event;
- explicit admin credit path.

До production: sandbox payment tests, duplicate/late webhook, wrong amount/signature, concurrent checkout, DB backup/restore rehearsal.

Дополнительные условия платежного среза:
- До нового checkout исследовать старый merchant/InvId namespace, незавершённые платежи и поздние callbacks. Составить mapping SKU/quantity/price/paidUntil и оплаченных остатков; не менять их автоматически.
- Сервер считает цену; клиент не задаёт оплачиваемую сумму модуля. Stable idempotency key на создание checkout, условный claim callback и выдача доступа в одной транзакции.
- Различать SaaS subscription, счета клиентам CRM, AI wallet и referral balance. Денежная точность и округление фиксируются отдельно, включая sub-kopeck расходы модели.
- Проверки: покупка, повтор, продление, истечение, недостаток баланса, возврат/отмена, сверка provider ledger; отрицательные signature/amount/tenant cases. Success redirect не является оплатой.
- Entitlements имеют один источник истины. Provider sandbox проверять тестовым магазином после предоставления настроек; production keys не переносить в local fixtures.
- Refunds, отключение оплаченного доступа и referral reversal требуют записей-компенсаций, не удаления финансового журнала.


## Приоритет 2 — Twenty UX parity

Сохранить и расширять `RecordTable`, `SyncedRecordTable`, `RecordDetailShell`, tabs, overlay stack и mobile shell.

Сначала зафиксировать эталонные сценарии и токены:
- оболочка и navigation;
- плотность/typography/surfaces/borders/focus;
- table view/filter/columns/keyboard;
- kanban;
- side panel/full page/card relations;
- chat composer and unread state;
- mobile 360/767/768/1280.

Не менять всю тему одним PR. Один экран → screenshots/DOM/keyboard tests → следующий.

Эталон должен иметь указанную версию Twenty, одинаковые синтетические данные, viewport и theme. Для каждого отличия принять решение: повторить Twenty или оставить документированную специфику (отчество, реквизиты РФ, ремонт/финансы). Личные представления не смешивать с общими workspace views. Матрица приёмки — `BROWSER_VERIFICATION.md`; пока эталона нет, полный visual parity заблокирован, не «готов».

## Приоритет 3 — universal lead/chat pipeline

Donor: `form-lead-process.ts`, `crm-deal-dedupe.ts`, `enrich-person-by-phone.ts`, MAX/TG/WA sync rules.

Native target:
- contact identity resolver;
- conversation/thread identity separate from provider peer identity;
- message idempotency;
- `reuse_open`, `always_new`, `suppressDealCreation`, `needsReview`;
- soft merge with audit and preview;
- phone cross-channel enrichment with never-invent URL rules;
- transport adapters for Telegram personal/bot/business, MAX personal/bot, WhatsApp.

Приёмка каналов: один активный consumer на аккаунт при cutover; restore/reconnect без дублей; порядок и replay событий; edits/deletes; native outbound не запускает AI; history sync только явно. Проверять два аккаунта одного канала и два tenant. Ошибка между provider send и DB commit требует reconciliation по external ID, не слепого retry. Старый consumer отключать только при подтверждённой работоспособности нового; хранить cursor и план возврата. Media TTL, MIME/size limits, доступ по tenant и signed links — отдельные тесты.


## Приоритет 4 — AI parity

- conversation history/handoff/pause/disable;
- per-thread agent override, AI-off default;
- successful-sales examples in pgvector and idempotent ingestion;
- document/media/ASR/vision limits and usage accounting;
- no LLM call on native outbound.

Приёмка AI: отменять устаревший ответ после сообщения оператора/выключения агента; ограничивать параллельный расход, таймауты и размер контекста; retry не должен повторно списывать деньги. База знаний и sales examples изолированы по tenant/agent. «Обучение» означает retrieval примеров, не fine-tuning. Исключать секреты/неподходящие пары, сохранять provenance, поддерживать удаление/реиндексацию и повтор частично неудачного ingestion. Статус won и изменение исходной сделки учитываются, cursor/pagination не должны навсегда пропускать записи за пределом batch.


## Приоритет 5 — forms, referrals, analytics, campaigns

Reuse old parsers/tests and event contracts. Add retries/queues only where delivery semantics require them. Map old SKU/tenant/referral concepts to new marketplace before schema changes.

## Исторические данные и восстановление

Изолированно восстановить оба legacy dump (Twenty + control), проверить полноту/свежесть, mapping CUID/UUID, связи contacts/deals/conversations, денежные остатки и историю оплат. Отдельно мигрировать embeddings с проверкой размерности и версии модели; sessions/keys не считать переносимыми без явной схемы шифрования и разрешения. Dry-run должен выдавать counts, conflicts и финансовую сверку до записи. Повтор импорта идемпотентен; cutover фиксирует watermark и только одного писателя. Наличие файла dump не доказывает восстановимость. Данные клиентов не помещать в исходники/evidence.

## Оставшиеся внешние блокеры

- Обычный пользовательский вход и выбранный tenant для production UI.
- Доступный эталон Twenty (workspace либо согласованные экраны/версия).
- Sandbox Robokassa и разрешённые тестовые аккаунты каналов для интеграционных acceptance tests.
- Проверенный isolated restore и явное согласование каждого production-релиза.

Эти пункты нельзя объявлять закрытыми локальными unit tests. Работу над независимыми локальными проверками продолжать.

## Не переносить автоматически

Twenty backend/Prisma schema, separate control-plane databases, hardcoded UUIDs, old provider credentials, unsafe webhook checks, old payment InvId race, JSON cosine scan for vector retrieval, or mocks presented as real data.
