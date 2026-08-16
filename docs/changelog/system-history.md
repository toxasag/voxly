# System History — Хронология изменений Voxly

## Базовый снимок (2026-08-16)

| Поле | Значение |
|------|----------|
| Branch | `feature/cross-channel-enrich-opp-activity` |
| Prod host | `150.241.98.135`, deploy-path `/opt/voxly` |
| Prod uptime | 38 дней |
| Traefik | v3.6.6 (port 8880→80, dashboard 8088 internal) |
| PgBouncer | edoburu/v1.25.2-p0 (transaction mode) |
| PostgreSQL control | 16-alpine, 127.0.0.1:5433 |
| PostgreSQL twenty | 16-alpine, 127.0.0.1:5434 |
| Redis | 7-alpine, 127.0.0.1:6379 (appendonly, 1gb allkeys-lru) |
| Twenty CRM | voxly-twenty:2.22.0 |
| Evolution API | voxly-evolution-api:v2.3.7-lid |
| saas-api | latest (port 3002) |
| saas-portal | latest (port 3000) |
| ai-telegram-worker | latest (port 3005) |
| ai-whatsapp-worker | latest (port 3006) |
| gift-bot-worker | latest (port 3004) |
| manager-bot-service | latest (port 3003) |
| gramjs-bridge | latest (port 3008) |
| max-bridge | latest (port 3010) |
| platform-bot-service | latest (port 3009) |

## Недавние коммиты

| Дата | Commit | Суть |
|------|--------|------|
| 2026-08-XX | `3dc82cb` | feat(portal): redesign landing to light latitude/accelerate style |
| 2026-08-XX | `7283ea8` | docs: WORKLOG — 6.2 pgBouncer control-plane deploy |
| 2026-08-XX | `78c3841` | feat(infra): 6.2 pgBouncer (transaction mode) |
| 2026-08-XX | `62e4177` | docs: WORKLOG — 9.2 per-service tokens deploy |
| 2026-08-XX | `d60b7cb` | feat(security): 9.2 per-service auth tokens |

## Незакоммиченные изменения

| Файл | Суть |
|------|------|
| `apps/ai-whatsapp-worker/src/index.ts` | Cross-channel enrich + opportunity activity |
| `apps/saas-api/src/routes/crm-chat.ts` | CRM chat route changes |
| `apps/saas-portal/src/app/admin/ai-balance/page.tsx` | AI balance admin page |
| `packages/db/prisma/schema.prisma` | Schema changes + migration `20260816000000_chat_message_from_me` |

## Хронология изменений

| Дата | Branch | Commit | Суть | Rollback |
|------|--------|--------|------|----------|
| 2026-08-16 | feature/cross-channel-enrich-opp-activity | — | Total audit: docs/, AGENTS.md, typecheck, tests | `git checkout docs/ AGENTS.md .cursorrules .windsurfrules .kilocode/` |

### [2026-08-16] Авто-обновление voxly-crm-chat при деплое + хотфикс прод-воркспейсов
- **Причина (Why)**: Twenty ставит private-registry приложение один раз при provisioning. После деплоя нового образа saas-api существующие воркспейсы (remtoua, efim1) продолжали отдавать старый бандл чата — у пользователей пропали селектор «Пишем от:» и write-first (не могли выбрать канал и написать первыми). Подтверждено хэшами: tarball в образе `aa1eb735…`, бандл в воркспейсе `ebdc05d4…`.
- **Затронутые файлы**: `apps/saas-api/src/services/crm-chat-app-auto-refresh.ts` (новый), `apps/saas-api/src/worker.ts`, `apps/saas-api/tests/crm-chat-app-refresh.test.ts` (новый), `docs/02-twenty-crm-engine/crm-chat-app-auto-refresh.md` (новый), `docs/02-twenty-crm-engine/INDEX.md`.
- **Синхронизация индексов**: `docs/02-twenty-crm-engine/INDEX.md`.
- **Влияние на систему (Impact)**: saas-worker при старте сравнивает sha1 запечённого tarball с Redis-маркером `voxly:crmchat-app:tarball-sha1` и форс-реинсталлит приложение во всех провижененных воркспейсах (через `refreshCrmChatAppForTenant`). API-контракты и схемы БД не изменены. Немедленный хотфикс прода выполнен 2026-08-16 напрямую в контейнере (force-refresh для 2 тенантов, хэши воркспейс-бандлов обновлены до `aa1eb735…`).
- **Результаты тестов (Verification)**: `pnpm --filter @voxly/saas-api typecheck` ✅; `pnpm test` — 170 passed / 15 skipped (включая 7 новых тестов).
- **План отката (Rollback Plan)**: `git revert` коммита с сервисом; удалить Redis-маркер `voxly:crmchat-app:tarball-sha1`; ручной канал обновления остаётся — `POST /api/admin/tenants/:id/refresh-crm-chat`.

### [2026-08-16] Write-first селектор «Пишем от:» — починены резолверы пира (мёртвые колонки person)
- **Причина (Why)**: У сделки с заполненными каналами контакта (Telegram t.me, WhatsApp wa.me, телефон, MAX) селектор «Пишем от:» показывал MAX/Telegram как недоступные («Нет MAX-контакта», «Нет Telegram ID контакта»). Причина: SQL-запросы к workspace-схеме Twenty выбирали несуществующие в 2.22 колонки `person.telegram` и `person.whatsapp` → весь запрос падал (column does not exist) → catch возвращал null → резолверы пира не находили данные. Дополнительно `loadPersonPhoneE164` не использовал `phonesPrimaryPhoneCallingCode` (нац. номер без кода страны).
- **Затронутые файлы**: `apps/saas-api/src/routes/crm-chat.ts` (3 запроса: resolvePersonWhatsappFromTwentyDb, resolvePersonTelegramPeerFromTwentyDb, loadPersonPhoneE164), `apps/saas-api/src/services/backfill-telegram-open-links.ts` (1 запрос), `apps/saas-api/tests/crm-chat-peer-parse.test.ts` (новый, 8 тестов).
- **Синхронизация индексов**: не требуется (новых файлов спецификаций нет).
- **Влияние на систему (Impact)**: только чтение person-полей; API-контракты `*-internal.ts` и схемы БД не менялись. Верифицировано на проде: sendFromOptions для сделки 47ecff36 → WhatsApp/MAX/Telegram все `available: true`.
- **Результаты тестов (Verification)**: `pnpm --filter @voxly/saas-api typecheck` ✅; `pnpm test` — 178 passed / 15 skipped. Деплой saas-api+saas-worker через `prod-deploy.sh`, smoke зелёный.
- **План отката (Rollback Plan)**: `git revert` коммита; селектор вернётся к WhatsApp-only (write-first через MAX/TG отключится), чат продолжит работать по существующим тредам.

### [2026-08-16] Cross-channel write-first: MAX chat_id, thread switch, TG-дубли, канонизация Telegram-линков
- **Причина (Why)**: (A) Отправка из CRM через личный MAX падала `common.finder User … not.found` — write-first передавал user_id как chat_id, а MAX `send_message` требует id ДИАЛОГА. (B) После отправки из TG панель оставалась на WhatsApp-треде — фронт игнорировал `conversationId` из ответа. (C) Входящий ответ контакта в TG создавал дубль Person+сделки: write-first диалог был ключён username'ом, inbound матчился только по числовому id; person-поиск не смотрел t.me-линки. (D) В карточке лейбл Telegram показывал полный URL вместо @username. (E) Ручной ввод `toxasagmsk` не нормализовался в `https://t.me/…`.
- **Затронутые файлы**: `apps/max-bridge/src/main.py` (+`_resolve_dialog_chat_id`: get_chat_id(me,user)+add_contact), `apps/gramjs-bridge/src/index.ts` (→`resolvedPeerUserId`), `apps/saas-api/src/routes/crm-chat.ts` (adoption числового id, POST `/normalize-telegram`), `apps/ai-telegram-worker/src/index.ts` (ensureConversation username-fallback+backfill), `packages/twenty-client/src/index.ts` (label `@handle`/id, findPersonByHint по t.me URL/label), `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` (переключение треда после send), `twenty-app/voxly-crm-chat/src/logic-functions/normalize-person-telegram.ts` (новый, person.updated→normalize), константы universal-identifiers.
- **Синхронизация индексов**: не требовалась.
- **Влияние на систему (Impact)**: API-контракты internal не менялись; новый эндпоинт `/api/crm/chat/normalize-telegram` (service-token/portal auth). Прод: контрольная БД — слиты TG-диалоги (cmsvmuksa→cmsvmxzpg, 4 сообщения), Twenty — soft-delete дубля person 83404cbc/opp 34e4f6fa, label оригинала → @toxasagmsk, metadataVersion++, flush flat-maps. Бэкапы: /tmp/pre-merge-full.dump (control), /tmp/pre-twenty-merge.dump (twenty) в контейнерах PG.
- **Результаты тестов (Verification)**: typecheck (twenty-client, saas-api, ai-telegram-worker, gramjs-bridge) ✅; py_compile max-bridge ✅; pnpm test 178 passed / 15 skipped; tarball 0.1.31 пересобран (32 файла), авто-рефреш установил в оба воркспейса (sha 3f987188…); деплой saas-api,saas-worker,ai-telegram-worker,gramjs-bridge,max-bridge — smoke зелёный; API-проверка: threads=[whatsapp, telegram_gramjs @toxasagmsk], 12 сообщений, sendFrom все available.
- **План отката (Rollback Plan)**: `git revert` коммита; развёртка сервисов той же командой деплоя; данные — восстановление из pg_dump-бэкапов выше; дубль-диалог вернуть `UPDATE Conversation SET status='open' … WHERE id='cmsvmuksa…'` + обратные UPDATE ссылок/сообщений; twenty — `UPDATE … SET "deletedAt"=NULL WHERE id IN ('83404cbc…','34e4f6fa…')`.

### [2026-08-16] MAX write-first: sync get_chat_id (XOR) + «Открытые чаты:» dropdown
- **Причина (Why)**: (1) Отправка MAX всё ещё падала `common.finder User not.found`: PyMax `get_chat_id` — СИНХРОННЫЙ локальный XOR (chat_id = me ^ user), прежний `await` давал TypeError `object int can't be used in 'await'` → dialog-resolve всегда возвращал None → отправка шла с user_id вместо chat_id. (2) UX: переключатель тредов был пилюлями — по запросу владельца сделан выпадающим списком «Открытые чаты:».
- **Затронутые файлы**: `apps/max-bridge/src/main.py` (`_resolve_dialog_chat_id`: iscoroutine-safe вызов, add_contact best-effort до вычисления), `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` (threads pills → select «Открытые чаты:», убран unused accent).
- **Влияние (Impact)**: контракты не менялись; inbound MAX ключует диалоги тем же chat id (`max-internal.ts`: «peerId remains chat id for send/read») — write-first XOR-id консистентен со входящими.
- **Результаты тестов (Verification)**: py_compile ✅; yarn lint 0 errors; tarball пересобран и установлен авто-рефрешем в оба воркспейса (sha 4a463e36…); деплой max-bridge,saas-api,saas-worker — smoke 200.
- **План отката (Rollback Plan)**: `git revert`; повторный деплой тех же сервисов.

### [2026-08-16] Верификация владельцем + фиксация инцидентов INC-120…123
- **Причина (Why)**: владелец подтвердил полную работоспособность (дублей нет, TG-чат работает, MAX-отправка живая, «Открытые чаты:» на месте). Зафиксировать причины/инварианты в реестре инцидентов, чтобы регрессии не повторялись.
- **Затронутые файлы**: `docs/agent/INCIDENTS.md` (+INC-120 stale workspace bundle / INC-121 мёртвые колонки person / INC-122 MAX XOR chat_id / INC-123 TG-дубль), `docs/03-saas-api-internal/crm-chat-write-first.md` (XOR-инвариант + «Открытые чаты:»), `docs/04-workers-and-bridges/max-fastapi-bridge.md` (sync-XOR), `docs/agent/WORKLOG.md`.
- **Влияние на систему (Impact)**: только документация; код/прод не менялись (прод уже на свежих версиях: api ok, max-bridge ok, pymax sessions=1, smoke 200).
- **Результаты тестов (Verification)**: прод-хелсчи всех затронутых сервисов ✅; user-confirmed (MAX/TG/WA write-first, переключение тредов, отсутствие дублей).
- **План отката (Rollback Plan)**: n/a (документация).

### [2026-08-16] Правило deploy coupling для CRM Chat
- **Причина (Why)**: закрепить гарантию, что новый portal получает весь текущий CRM Chat при provisioning, а существующие workspace обновляются без ручных действий при каждом изменении tarball.
- **Затронутые файлы**: `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `.kilocode/rules/agents.md`, `docs/INDEX.md`, `docs/02-twenty-crm-engine/crm-chat-app-auto-refresh.md`.
- **Синхронизация индексов**: главный `docs/INDEX.md` дополнен гарантией CRM Chat.
- **Влияние на систему (Impact)**: обязательный coupling: изменения CRM Chat → deploy `saas-api,saas-worker`; новый tarball устанавливается новым workspace при provisioning и всем существующим workspace авто-рефрешем по sha1.
- **Результаты тестов (Verification)**: документационный инвариант отражает работающий прод-механизм `crmchat-refresh`.
- **План отката (Rollback Plan)**: n/a (документация/правила).

### [2026-08-16] Native MAX/WhatsApp outbound ingest + Kanban `updatedAt` default
- **Причина (Why)**: сообщения, отправленные с телефона клиента через подключённые MAX/WhatsApp, не появлялись в CRM; MAX outbound отбрасывался, WA `fromMe` шёл через inbound/AI path. Настройка Kanban-карточки remtoua также требовала сделать `updatedAt` глобальным дефолтом новых порталов.
- **Затронутые файлы**: `apps/max-bridge/src/main.py`, `apps/saas-api/src/routes/max-internal.ts`, `apps/ai-whatsapp-worker/src/index.ts`, `apps/saas-api/src/routes/crm-chat.ts`, `packages/twenty-client/src/index.ts`, `apps/saas-api/tests/native-outbound-contracts.test.ts`, `apps/saas-api/tests/opportunity-kanban-defaults.test.ts`, outbound/WA/Kanban specs and rules.
- **Влияние на систему (Impact)**: MAX `message.out` → idempotent `/api/internal/max/outbound` with `max:<nativeId>`, operator/fromMe and CRM link; WA `key.fromMe` → mirror path with LID/PN reconciliation, no AI/no new Opportunity; manual CRM sends repair `CrmRecordLink(source:'outbound')`; `updatedAt` added to ID-independent `OPPORTUNITY_KANBAN_CARD_FIELDS` for all new provisioning.
- **Результаты тестов (Verification)**: `pnpm typecheck` 23/23 ✅; root `pnpm test` — 184 passed / 15 skipped (26 files) ✅; `@voxly/twenty-client` build ✅; `yarn lint` CRM Chat 0 errors (2 existing warnings) ✅; portal lint existing warnings only ✅; `py_compile` max-bridge ✅; `git diff --check` ✅.
- **План отката (Rollback Plan)**: revert commit and redeploy `saas-api,saas-worker,max-bridge,ai-whatsapp-worker`; restore DB only if an outbound ingest migration/data repair is introduced (this change has no schema migration); reapply prior Kanban template and flush metadata cache if required.
