# Перепроверка CRM-PLUS → GETVOXLY: код, production, Twenty UX

Дата: 2026-09-19, около 00:29–00:45 MSK. Это снимок состояния, не утверждение о будущих деплоях.

## Границы проверки

- SSH на `getvoxly-vps`, read-only команды Docker, HTTP GET и SQL в `BEGIN READ ONLY`.
- Не выполнялись деплой, перезапуск, миграции, создание аккаунтов/сделок, платежи, вызовы LLM и сообщения клиентам.
- Секреты окружения проверялись только на наличие. Значения ключей не выводились.
- Изучены исходники обоих проектов, регистрация маршрутов, worker entry points, модели данных и целевые тесты.
- Реальные сделки/оплаты/переписку сквозным сценарием не проверяли: это изменило бы production.
- Встроенный Browser не поддерживает URL preview в этой установке; авторизованный визуальный обход и попиксельное сравнение с Twenty НЕ выполнены. Временная launch-конфигурация удалена.

## 1. Фактическое состояние VPS

| Проверка | Результат |
|---|---|
| `https://getvoxly.ru/login` | HTTP 200, проверка TLS успешна |
| `https://api.getvoxly.ru/health` | HTTP 200, `status=ok`, `database=up` |
| `https://voxly.getvoxly.ru/dashboard` без сессии | 307 на `/login?redirect=%2Fdashboard` |
| GET contacts / agents / MAX accounts без JWT | Все три — 401 |
| Контейнеры frontend / backend / db | Все healthy; restart count 0 |
| Начало работы backend / frontend | 2026-09-04 13:55 UTC |
| Load average | 0.15 / 0.17 / 0.18 |
| Диск | 48% занято; примерно 50 GiB доступно |
| Память | 9940 MiB всего, 5923 MiB available |
| Миграции | 28, последняя `0028_stage_is_system` |
| PostgreSQL pgvector | 0.8.0 |
| Роль приложения | `app_user`, не superuser, не BYPASSRLS |
| RLS | 30 таблиц с RLS, все 30 с FORCE |
| LLM_API_BASE_URL / LLM_API_KEY | Оба заданы |
| Telegram API, auth bot, MAX auth bot, encryption key, SMTP host | Соответствующие проверенные параметры заданы |
| Robokassa env / Redis URL у GETVOXLY backend | Не заданы |

Nginx Proxy Manager действительно направляет `api.getvoxly.ru` → `backend:4000`, основной и wildcard tenant-домены → `frontend:3000`. Это не старый Twenty.

### Исходники против запущенного кода

- 387 файлов в `frontend/src` + `backend/src` локально и в `/opt/getvoxly` совпали по SHA-256; разных и отсутствующих нет.
- Одного совпадения source недостаточно: контейнеры не монтируют исходники с хоста.
- Локальный старый `backend/dist` оказался устаревшим: 40 совпадений, 26 отличий, 42 файла отсутствовали. Он НЕ использовался как доказательство версии прода.
- Свежая компиляция текущего backend в отдельный `/tmp/getvoxly-audit-compiled-20260919` прошла; все **108 JS-файлов** совпали по SHA-256 с `/app/dist` работающего backend-контейнера.
- У frontend прочитан manifest маршрутов работающего контейнера: CRM, финансы, ремонты, агенты, интеграции, маркетплейс, настройки, admin присутствуют. Полное сравнение воспроизводимой frontend-сборки не выполнялось.

### Данные в production (только агрегаты)

- 3 tenant, 2 пользователя без soft-delete.
- 1 контакт и 1 сделка без soft-delete, 1 сообщение.
- `channel_accounts`: 0 строк, включая удалённые.
- `ai_agents`: 0 строк, включая удалённые.
- Привязки агентов, документы базы знаний, векторы, AI usage: по 0 строк.
- Установленные модули есть, включая AI, Telegram и MAX. **Установленный модуль ≠ подключённый аккаунт ≠ действующий агент.**

Вывод: AI-код и конфигурация есть, но текущий production не даёт доказательства работающего клиентского AI-сценария: для него сейчас не заведены агенты/каналы. Наличие ключа не доказывает, что шлюз ответит успешно.

### Логи и эксплуатационные ограничения

- Ограниченная выборка backend за 24 часа (до 7000 строк): 3190 HTTP 200, 207 HTTP 404, WARN/ERROR JSON-записей в выборке нет. Это не полный аудит всех запросов.
- Frontend: 14 ошибок Server Reference ID с входами `x`/`y`. Вероятны некорректные внешние запросы; причина и безопасность зависимостей отдельно не проверены. Это не подтверждение взлома.
- Порты 3000/4000 опубликованы Docker на `0.0.0.0` и IPv6; доступность снаружи и все firewall-правила не проверены. `ufw` отсутствует, `fail2ban` активен; отсутствие UFW не означает отсутствие firewall.
- 7 tenant_id-таблиц без RLS: `users`, `refresh_tokens`, `password_reset_tokens`, `pipelines`, `repair_counters`, `tenant_audit_log`, `contacts_company_backfill_0020`. Auth-исключения ожидаемы; для остальных необходимо проверять явные SQL-фильтры, нельзя писать «все таблицы под RLS».
- В документации доступа обнаружен открытый пароль консоли VPS. Его значение в отчёте не приводится. Рекомендуется отдельно согласовать ротацию и убрать секрет из документации; автоматически ничего не менялось.

### Старый production и данные

- Контейнеров Twenty / старых workers на этом VPS сейчас нет в `docker ps -a`.
- `/opt/voxly` с кодом и `/opt/voxly/backups` сохранены.
- Найдены старые `twenty.dump` и `voxly_control.dump`, последние среди просмотренных — 2026-08-16, каталог `20260816-204134`.
- В `/opt/getvoxly` найдены два SQL backup-файла от 2026-08-23/24. Наличие свежих off-host/provider backup не подтверждено и не опровергнуто.
- Дампы не восстановлены, содержимое клиентских данных не выводилось, восстанавливаемость не проверена. До переноса данных нужен пробный restore в изолированную БД.

## 2. Исправления предыдущего обзора

1. **Неверно: «LLM не реализован / нет ключей».** Есть `GatewayChatProvider`, `AgentPipelineService`, embeddings provider, configured runtime. Отдельный пробный чат UI остаётся демонстрационным (`frontend/src/lib/api/use-bot-chat.ts`).
2. **Неверно считать companies/deals/tasks только локальными моками.** Есть реальные `use-companies.ts`, `use-deals.ts`, `use-tasks.ts`. Roadmap здесь отстаёт от кода.
3. **Не все маршруты старого MAX используют AI.** `max-internal.ts` сохраняет live personal inbound и синхронизирует CRM, но эта ветка прямо обозначена `no sales LLM`; вызова AI в ней нет.
4. **MAX Bot и MAX personal — разные реализации.** Bot: `gift-bot-worker/max-handler.ts` + `max-api.ts`; personal: Python/PyMax `max-bridge`. Обе должны присутствовать в матрице переноса отдельно.
5. **«Обучение на успешных сделках» — retrieval примеров, не fine-tuning весов модели.** Извлекаются пары клиент→оператор, векторизуются и добавляются в prompt по близости.
6. **Redis не обязателен перед первой интеграцией платежей.** Платёж можно сделать транзакционным в PostgreSQL, затем вынести retry/notifications/expiry в очереди. Создать сразу все предлагаемые таблицы — преждевременное расширение.
7. **Не следует отбрасывать весь старый frontend.** Twenty SDK binding переписывается, но сценарии чата, uploader, formatting, previews, роли и тесты — полезные доноры. Robokassa-клиент независим от Prisma и переносится существенно проще, чем старый billing route.

## 3. Полная матрица повторного использования

| Область | CRM-PLUS — источник | GETVOXLY / действие |
|---|---|---|
| Robokassa checkout, receipt, signatures | `packages/billing/src/index.ts`, `tests/billing.test.ts` | Брать клиент+тесты; новые SQL repositories и разрешения |
| Subscription fulfillment, renewal, seats, trials, grace | `apps/saas-api/src/routes/billing.ts`, `jobs/scheduler.ts` | Адаптировать к marketplace/installed_modules; не подменять счета клиентам оплатой самой SaaS |
| Рефералы, индивидуальные ставки, вывод, holds | `services/referral-program.ts`, `routes/referrals.ts`, `routes/admin-referrals.ts`, Prisma models | В новом referral UI моки; перенос отдельным финансовым срезом |
| AI wallet, себестоимость, наценка, retries и idempotency | `packages/ai-core/src/index.ts`, `ai-usage-queue.ts`, `openrouter-cost.ts` | В новом есть basic charge/log; добавить надёжность, точность и сверку, не новый кошелёк параллельно |
| Контакт по identity/телефону/email, ambiguity | `form-lead-process.ts`, worker `syncLeadToCrm`, `twenty-client` | Расширить текущий `CrmPipelineService`; не делать второй независимый intake |
| Soft merge и перенос связей | `services/crm-deal-dedupe.ts` | Переписать storage под native contacts/deals/tasks/messages; предусмотреть preview/audit |
| Cross-channel enrichment | `services/enrich-person-by-phone.ts`, `max-phone-guard.ts` | Переиспользовать правила и transport lookups; собственный repository + tenant scope |
| Tilda / WordPress / generic forms | `routes/forms.ts`, `form-lead-parse.ts`, `form-lead-process.ts` | Парсер+тесты готовые; intake/store/idempotency/queue адаптировать |
| Telegram personal | `apps/gramjs-bridge`, `services/gramjs-chat-sync.ts` | Не заменять работающий новый MTProto; добавить history sync, QR при необходимости, медиа и identity rules |
| Telegram Bot / Business | `apps/ai-telegram-worker`, `routes/bots.ts` | Новые transport adapters; различать бот, Business connection и personal session |
| MAX personal | `apps/max-bridge/src/main.py`, `routes/max*.ts`, `max-chat-sync.ts` | Sidecar — разумный кандидат; заменить control-plane contract, проверить PyMax и tenant ownership |
| MAX Bot / gift flows | `apps/gift-bot-worker/src/max-handler.ts`, `max-api.ts` | Отдельно от OTP MAX и personal; исправить webhook guard до переноса |
| Telegram gift flows | `apps/gift-bot-worker/src/index.ts`, portal bots forms | Кампании, выдача подарка, контакт, follow-up, preview; не смешивать с обычным AI transport |
| WhatsApp | `apps/ai-whatsapp-worker`, Evolution bridge, `routes/whatsapp.ts` | Уже есть donor; LID↔PN merge, native outbound, media/history — не разрабатывать с нуля |
| Омниканальный чат | `routes/crm-chat.ts`, `twenty-app/.../chat-panel.tsx` | threads, sender selection, unread, read receipts, write-first, suppressDeal, pause/disable; адаптировать без Twenty SDK |
| AI context и управление | `ai-telegram-worker`, `packages/ai-core/inbound-debounce.ts` | В новом есть debounce/JSON bubbles/RAG; взять conversation history, per-thread agent override, abort stale replies, handoff |
| Успешные сделки → примеры | `services/ai-sales-learn.ts`, `packages/ai-core/rag.ts`, AiSalesExample | Добавить pgvector sales examples и retrieval; не переносить JSON similarity/scan limit 800 |
| AI media | `document-text.ts`, `extract-audio.ts`, workers ASR/vision | Вложения, голос, фото, видео, документы; затраты/лимиты/ошибки отдельно от text chat |
| Аналитика источников | `packages/analytics-dispatchers`, `routes/analytics.ts`, AttributionSession/CustomerActivity | Metrika/GA4/FB/VK, UTM/click IDs, conversions; новый analytics экран сейчас на моках |
| Рассылки и stage rules | `routes/bots.ts`, mailing components, workers, shared flood guards | Существующая функциональность-донор; отдельный продуктовый срез, с лимитами провайдеров и согласиями получателей |
| Platform/support bots | `platform-bot-service`, `manager-bot-service`, platform routes | Поддержка, напоминания окончания тарифа, операционные уведомления — не только OTP |
| Admin / pricing / grants | `admin-pricing`, `admin-services`, `comp-access`, pricing services | Per-tenant цены, бесплатный период, audit — согласовать с новой моделью прав |
| Юридические страницы | portal `/terms`, `/privacy`, `/consent`, `/refund` | Структура полезна; реквизиты/тексты проверить, не копировать без сверки |
| CI / тесты / smoke | `.github/workflows/ci.yml`, `tests`, `e2e`, module freeze cards | Перенести сценарии и negative cases; старые зелёные доки не доказательство нового runtime |
| Объектное хранение медиа | `docs/05-media-storage-pipeline/s3-streaming-architecture.md` | В старом репо прямой S3 pipeline обозначен GAP: не выдавать его за готовый модуль |

### Обязательные правила, сохраняемые при переносе

- Идентичность клиента: `(tenant, platform, external_user_id)`, беседы: отдельно `(channel_account, external_chat_id)`. Не смешивать MAX chat ID с user ID или Telegram peer.
- Идемпотентность сообщения: provider message ID + аккаунт/канал + tenant, ограничение в БД; дедуп по номеру контакта не заменяет message dedup.
- Native outbound — сообщение оператора, не повод вызвать AI. Личный исходящий не должен заводить случайную продажу.
- Один клиент может иметь много бесед и несколько бизнес-сделок. `reuse_open` — политика автоматического intake, не глобальный UNIQUE, запрещающий реальные параллельные сделки.
- Удалённая/подавленная автосделка не должна возрождаться после следующего сообщения: нужен explicit `suppressDealCreation`.
- Не затирать имя/телефон менеджера данными слабого качества; не подставлять телефон владельца подключённого аккаунта.
- Сначала надёжно сохранить событие, затем enrichment/AI; отказ модели не должен терять лид.
- Тестировать два tenant и два аккаунта одного канала, а не только один happy path.

## 4. Старый код — донор, но не гарантия качества

Подтверждено чтением, без эксплуатации production:

1. MAX gift webhook (`gift-bot-worker/src/index.ts:164`): условие требует непустой входной secret, поэтому отсутствующий заголовок не отклоняется. До переиспользования — fail-closed + regression test.
2. Robokassa invoice allocation (`billing.ts:1120`): advisory lock внутри `getNextInvId()` освобождается до INSERT платежа в другой транзакции. Два checkout могут получить один InvId, UNIQUE затем отклонит один. Использовать sequence/атомарное выделение вместе с записью.
3. Идемпотентность checkout (`billing.ts:259`) содержит `Date.now()`: это не устойчивый client retry key. Идемпотентный ResultURL не означает идемпотентность всего payment flow.
4. Form fingerprint: Redis ограничен 10 минутами, DB UNIQUE fingerprint — без времени. Повторная одинаковая заявка без externalId может блокироваться навсегда, а не только в окне. Согласовать семантику и написать тест вне окна.
5. Обучение сделок (`ai-sales-learn.ts:140–171`): ошибки отдельных upsert проглатываются, но conversation всё равно помечается изученной. Нужен повтор неполного ingestion и пагинация (текущие `take:80` / `take:200`).
6. Старый MAX live personal handler не вызывает LLM. Название `ai_max` и UI toggle не доказывают наличие AI-ответа по этой ветке.
7. GETVOXLY `POST /api/v1/ai/balance/topup` разрешён `billing:manage`, а это право есть у tenant-owner; `AiService.topupBalance()` напрямую начисляет manual balance без платежа. Перед коммерческим AI нельзя оставлять самостоятельное бесплатное начисление клиентом. Разделить платный checkout и платформенное admin-credit.

## 5. Twenty — эталон именно рабочего интерфейса

Пожелание пользователя: сохранить привычное поведение, вёрстку и оформление Twenty в новом портале. Это не требование вернуть Twenty backend и не копирование marketing-кабинета CRM-PLUS.

### Уже есть в GETVOXLY — сохранить

- `RecordTable.tsx`, `RecordCell.tsx`: компактная таблица, строка 32px, sticky identifier, resize через CSS variables, управление клавиатурой.
- `SyncedRecordTable.tsx`: персональная серверная раскладка. Комментарий в старой части RecordTable про «только localStorage» уже устарел.
- `RecordDetailShell.tsx`: общая боковая карточка, вкладки, резайз, мобильный fullscreen.
- `PinnedPageTabs`, `TabsRenderer`, `page_layout_tabs`: закреплённая главная вкладка и состав вкладок из БД.
- Настраиваемый Kanban, сохранение вида, системные этапы, параметры URL для открытых записей.
- Единый stack overlays, мобильная навигация и поиск по API.

### Что включить в отдельную проверяемую UI-спецификацию

1. Оболочка: workspace/user menu, sidebar, header, breadcrumbs, global search, плотность и размеры.
2. Семантические tokens: background/surface/border/text/hover/focus/status, typography, spacing, radii; light/dark. Сейчас `globals.css` инвертирует slate и переопределяет amber в orange — это не полноценная система Twenty tokens.
3. Таблицы: меню представлений, фильтры/сортировка, порядок/видимость колонок, сохранение, inline-edit, focus, multi-select, bulk actions, большие списки.
4. Kanban: геометрия, содержимое карточек, группировка, счетчики, DnD, создание и открытие записи.
5. Карточка: sidebar vs full page, pinned Home, связи contact/company/deal, timeline, tasks, notes, files, сохранение/отмена.
6. Чат: закреплённый composer, выбор отправителя/беседы, unread, медиа, управляющие AI-кнопки, статусы доставки.
7. Русский контент, переполнение, мобильные границы 360/767/768/1280, клавиатура, hover/focus, пустые/ошибочные/loading состояния.

Критерий приёмки — side-by-side screenshots и одинаковые действия на согласованном эталонном workspace, а не оценка «похоже». Текущий аудит подтвердил структуру исходниками, но не полное визуальное совпадение.

Локальная CRM-PLUS содержит custom Twenty app и Docker-патчи, а не полный upstream Twenty frontend. Docker image закреплён `twentycrm/twenty:v2.22.0`. Попытка достать соответствующий исходный tag через GitHub: API rate limit / raw 404. Context7 вернул общие правила theme-first Twenty UI, но они НЕ доказательство точных размеров этой версии. До буквального копирования upstream компонентов проверить доступную версию и лицензию.

## 6. Проверки и границы уверенности

- Legacy: **50/50 тестов** в 5 выбранных unit suites (Robokassa, debounce, form parser, RAG helpers, MAX owner-phone guard) прошли.
- GETVOXLY backend: отдельная компиляция успешна, **108/108** JS-файлов совпали с работающим контейнером.
- GETVOXLY UI: первый запуск из корня проекта дал 252 pass / 4 fail: `crm-filter-rows.test.ts` читает `process.cwd()`, поэтому не нашёл файлы `src/app/...`. После запуска из правильного каталога через `npm --prefix frontend test -- --maxWorkers=2` прошли **256/256 тестов, 36/36 файлов**, exit 0. Это локальные jsdom-тесты, не live browser E2E.
- Рендер-тесты показали warning о вложенном `<button>` в карточке контакта (поле компании); даже при зелёных assertion это отдельный HTML/a11y-дефект, требующий исправления перед UI-паритетом.
- Backend integration suites и full legacy DB/E2E здесь не запускались: не подключать их случайно к production.
- Платежи, webhook retries с записью, живой AI-ответ, history import и авторизованный визуальный обход остаются отдельной staging-приёмкой.

## 7. Рекомендуемый порядок без переизобретения

1. Зафиксировать этот baseline и матрицу сценариев: существующее / donor / gap / риск. Не менять работающую архитектуру ради полного копирования old stack.
2. Первый самостоятельный срез — Robokassa checkout→verified result→payment ledger→entitlement/topup, с локальными/стендовыми тестами и безопасной нумерацией. Не ждать переноса всех очередей и каналов.
3. Параллельный по планированию, но отдельный по реализации срез — UI-contract Twenty на общей оболочке, RecordTable и RecordDetailShell, без перестройки CRM данных.
4. Расширить текущий CRM pipeline: identities, threads, message idempotency, suppress/review/merge. Только после этого подключать personal+bot adapters MAX/TG/WA.
5. Добавить в существующий AI pipeline history/handoff и successful-sales retrieval на pgvector; переносить tests и правила старых инцидентов.
6. Далее — forms/attribution, referrals, campaigns, notifications по продуктовым приоритетам. Redis/workers добавлять там, где нужна гарантированная доставка и повтор, без требования заранее создать все возможные таблицы.
7. Перенос исторических данных — отдельная задача после изолированного restore обоих старых дампов, с mapping CUID/UUID, денежных единиц, account/session keys и связей Twenty→native CRM.
