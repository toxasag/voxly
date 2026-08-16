# Incidents (runtime)

Известные сбои и как диагностировали. **При дебаге читай первым.**  
Новый failure mode → добавь запись сюда + строку в WORKLOG.

---

### INC-124 — MAX/WhatsApp native outbound не попадал в CRM
- **Симптом:** сообщения, отправленные с телефона из MAX/WhatsApp, отсутствовали в CRM, хотя Telegram подтягивался.
- **Причина:** MAX listener отбрасывал `message.out`; WhatsApp `fromMe` шёл через inbound/AI pipeline, а не через outbound mirror.
- **Фикс:** MAX `message.out` → `/api/internal/max/outbound` с native id; WA `fromMe` → operator mirror с `fromMe=true`, CRM link/cache/timeline outbound, без AI.
- **Инвариант:** native outbound никогда не считать inbound и не запускать AI; idempotency по external id.
- **Дата:** 2026-08-16.

### INC-126 — Нативные MAX/WA outbound не синхронизировались с CRM
- **Симптом:** ручное сообщение с телефона клиента через MAX/WhatsApp не появлялось в CRM, Telegram-поток работал.
- **Причина:** MAX listener отбрасывал `message.out`; WA `fromMe` проходил inbound/AI path. Дополнительный риск — отсутствие outbound `CrmRecordLink` при ручном CRM send.
- **Фикс:** MAX outbound endpoint с native id/идемпотентностью; WA mirror `role=operator/fromMe`, LID/PN reconciliation, no AI/no new deal; SaaS outbound всегда upsert link `source=outbound`.
- **Инвариант:** нативные исходящие события не отбрасывать, не считать inbound, не запускать AI и не создавать новый Opportunity без существующего CRM match.
- **Дата:** 2026-08-16.

### INC-125 — Kanban card defaults не включали updatedAt
- **Симптом:** новые порталы получали почти правильную карточку Opportunity, но без `updatedAt`.
- **Причина:** глобальный ID-independent template `OPPORTUNITY_KANBAN_CARD_FIELDS` не содержал поле.
- **Фикс:** добавлен `{ name:'updatedAt', position:1.5, size:100 }`; provisioning/reapply остаются источником истины.
- **Инвариант:** не копировать UUID конкретного workspace; metadata names + metadataVersion/Redis flush.
- **Дата:** 2026-08-16.

### INC-123 — TG write-first: входящий ответ создал дубль Person+сделки
- **Симптом (remtoua 2026-08-16):** оператор написал первым из CRM (Telegram · личный) → контакт ответил из приложения TG → создались НОВЫЕ Person + сделка вместо попадания в существующий чат.
- **Причина:** write-first диалог создан с `platformUserId='toxasagmsk'` (username — числовой id узнавался только в бридже и не возвращался), а inbound `ensureConversation` матчил ТОЛЬКО по числовому id (641470324) → новый диалог → новый Person (`findPersonByHint` не смотрел t.me-линки).
- **Фикс:** gramjs-bridge `/messages/send` возвращает `resolvedPeerUserId`; saas-api adoption числового id при создании диалога; `ensureConversation` username-fallback + backfill id; `findPersonByHint` ищет по `telegramPrimaryLinkUrl/Label` (t.me URL / @handle). Прод-данные слиты (backup pre-merge-full.dump / pre-twenty-merge.dump в /tmp PG-контейнеров).
- **Инвариант:** диалоги ключуются ЧИСЛОВЫМ platform id; username — только как `platformUsername`.
- **Дата:** 2026-08-16. ✅ user-confirmed.

### INC-122 — MAX write-first: `common.finder User … not.found` (двухступенчатый)
- **Симптом (remtoua 2026-08-16):** «Пишем от: MAX» → send → `Не найдено Key: common.finder, args: [User,346581106] [not.found]`. Воспроизводился после первого фикса.
- **Причина (ступень 1):** MAX `send_message` принимает **chat_id ДИАЛОГА**, не user_id. **(ступень 2):** PyMax `Client.get_chat_id(me, user)` — **СИНХРОННЫЙ локальный XOR** (`first ^ second`, без запроса к серверу); `await` на нём → `TypeError: object int can't be used in 'await'` → dialog-resolve молча возвращал None → отправка снова шла с user_id.
- **Фикс:** `_resolve_dialog_chat_id` — sync/coroutine-safe (`asyncio.iscoroutine`), `add_contact` best-effort до вычисления, отправка с XOR chat_id. Консистентно с inbound (`max-internal.ts`: peerId = chat id).
- **Инвариант:** НЕ await'ить pymax-методы без проверки `iscoroutinefunction`; MAX peer для send = `me ^ user`.
- **Дата:** 2026-08-16. ✅ user-confirmed (живая отправка).

### INC-121 — Селектор «Пишем от:»: MAX/TG `available:false` при заполненной карточке
- **Симптом (remtoua 2026-08-16):** у контакта заполнены телефон/TG/WA/MAX, но опции MAX и Telegram недоступны («Нет MAX-контакта», «Нет Telegram ID контакта»).
- **Причина:** SQL к workspace-схеме Twenty выбирали колонки `person.telegram` / `person.whatsapp`, которых **в Twenty 2.22 нет** → весь запрос падал (`column does not exist`) → catch → null → резолверы пира считали данные отсутствующими. Затронуто 4 запроса (crm-chat ×3 + backfill-telegram-open-links).
- **Фикс:** мёртвые колонки убраны (только `*PrimaryLinkUrl/Label`, `phonesPrimary*`); `loadPersonPhoneE164` собирает `callingCode + number` (не-РУ-безопасно). Тесты: `apps/saas-api/tests/crm-chat-peer-parse.test.ts` (8).
- **Инвариант:** при апгрейде Twenty сверять колонки person-схемы с `information_schema`; в новых запросах использовать паттерн интроспекции (как `crm-deal-dedupe.ts`).
- **Дата:** 2026-08-16. ✅ user-confirmed (3/3 available).

### INC-120 — После деплоя у тенантов оставался старый UI чата, затем «Нет данных»
- **Симптом (remtoua 2026-08-16):** (а) после выката нового saas-api чат-панель воркспейса отдавала СТАРЫЙ бандл (нет селектора каналов); (б) после force-реинсталла вкладка «Чат» → «Нет данных».
- **Причина:** (а) Twenty ставит private-registry приложение **один раз при provisioning** — переустановки при деплое не было; (б) комбинация INC-116 (`__typename`) + устаревшие Redis flat-maps после шторма переустановок.
- **Фикс (системный):** `crm-chat-app-auto-refresh.ts` — при старте saas-worker сравнивает sha1 запечённого tarball с Redis-маркером `voxly:crmchat-app:tarball-sha1` и force-reinstalls во все провижененные воркспейсы (scheduler-lock; при частичном сбое маркер не пишется → ретрай). Плюс ручной `POST /api/admin/tenants/:id/refresh-crm-chat`. Работает на 3 деплоях подряд (sha 80ef…→3f98…→4a46…).
- **Инвариант:** любое изменение voxly-crm-chat требует деплоя saas-api/worker — обновление воркспейсов автоматическое; НИКОГДА не править built-front-component в local-storage руками вместо реинсталла.
- **Дата:** 2026-08-16. ✅ user-confirmed.

### INC-119 — CRM «не открывается» — disk suspected (false alarm)
- **Симптом (voxly 2026-08-07 ~18:00 MSK):** пользователь: CRM не открывается; follow-up «может места мало».
- **Проверка:** `/` **не** full — **57G free (40%)** before ops; inodes 21%; logs max ~37MB; no OOM; twenty-server/worker/saas-api/traefik/NPM/PG/redis all **Up**; `https://voxly-crm.getvoxly.ru/` + `/healthz` + GraphQL + API health **200**. Twenty logs show live auth/metadata traffic minutes before report.
- **Причина outage:** **не диск** (не INC-052/092). Infra CRM healthy — likely client cache/session or transient; no container down.
- **Ops (профилактика, не restore):** `docker image prune -af` → reclaimed **14.54GB**; after **72G free (24%)**. Volumes / `down -v` **не** трогали. Twenty recreate не нужен.
- **User:** открыть `https://voxly-crm.getvoxly.ru/` + hard-refresh (Cmd/Ctrl+Shift+R). Если blank — прислать screenshot/код ошибки.
- **Дата:** 2026-08-07.

### INC-118 — GramJS CRM: «Код» всё ещё не виден в Telegram (после INC-117)
- **Симптом (voxly 2026-08-07 ~17:00 MSK):** после INC-117 spoiler OK; toolbar **Код** (`…`) в нативном Telegram выглядит как обычный текст (кириллица).
- **Причина:** entities уже уходили (`MessageEntityCode` на msg `апапап` / `ппп` к @Remont_toua). Inline Code на кириллице почти неотличим от body font; пользователь воспринимал как «не работает». Spoiler заметен сразу.
- **Фикс:** `clientMdToTelegramHtml` — inline `` `code` `` → `<pre>` → **MessageEntityPre** (серый code-block). Spoiler/bold/italic/strike без изменений. Bot API MarkdownV2 path не трогали. Лог bridge `send format … hasPre=`.
- **Deploy:** `./scripts/prod-deploy.sh gramjs-bridge` backup `20260807-141203`. **max-bridge / ai-whatsapp-worker / crm-chat не трогали.** Volumes untouched.
- **Verify:** send `` `monospace_visible` `` → msg **36903** entities=`MessageEntityPre`; `` `код_блок` `` → **36904**; health 200; log `hasPre=true`.
- **Smoke:** CRM GramJS → выделить слово → Код → отправить → в Telegram серый monospace block.
- **Дата:** 2026-08-07.

### INC-117 — GramJS CRM: spoiler/code не в Telegram + нет «Прикрепить»
- **Симптом (voxly 2026-08-07 ~16:22 MSK):** CRM Chat «Telegram · личный · @genadich_age» → текст OK; toolbar Жирный/Курсив/Зачёркнутый/Спойлер/Код — **спойлер и код не применяются в нативном Telegram**; кнопки **Прикрепить** нет (MAX/WA на том же виджете attach есть).
- **Причина:** (1) Bridge `POST /messages/send` слал plain text без entities/`parseMode`. Client MD (`||` spoiler, `` `code` ``) уходил литералами. Даже GramJS `md` delimiters **не включают spoiler** (`DEFAULT_DELIMITERS` = `**` `__` `~~` `` ` `` ```). Bot API path uses MarkdownV2 — GramJS не шёл туда. (2) INC-033 намеренно скрыл attach: `supportsAttachments: botType !== 'ai_gramjs'` + reply 400 «вложения… не поддерживаются»; UI onChange тоже исключал `ai_gramjs` (и ошибочно мог гасить MAX при переключении канала).
- **Фикс:** `clientMdToTelegramHtml` → bridge `parseMode: 'html'`; outbound `mediaBase64` через `CustomFile`/`sendFile`; saas-api `sendViaGramjsBridge` media + `supportsAttachments` для всех кроме `gift_max`; crm-chat **0.1.29** attach при GramJS. MAX/WA send paths / max-bridge / wa-worker **не трогали**.
- **Deploy:** `./scripts/prod-deploy.sh gramjs-bridge,saas-api` backup `20260807-132959`; `refresh-crm-chat` voxly/efim1/art-dekor. **max-bridge / wa-worker не трогали.** Volumes untouched. crm-chat **0.1.29**.
- **Verify:** dist markers OK; health 200; user smoke spoiler+code + attach GramJS; MAX/WA attach при выборе канала.
- **Дата:** 2026-08-07.

### INC-116 — CRM Chat tab «Нет данных» after refresh-crm-chat 0.1.28
- **Status:** ✅ **CLOSED** — user-confirmed WORKING 2026-08-07 ~16:14 MSK (MAX+WA CRM chat OK). Freeze: `modules/crm-chat-panel.md`.
- **Симптом (voxly 2026-08-07 ~15:50 MSK):** сделка «Ремонт Инструмент · MAX · личный» → вкладка «Чат» активна, красная таблетка **«Нет данных»**, пустой canvas. Сообщения в control DB живы (MAX 17 + WA 6); `GET /api/crm/chat/:oppId` **200** с threads/messages. Браузер **не** бил в `/api/crm/chat/:id` (front-component не монтировался).
- **Причина:** не saas-api / не потеря данных / не max-bridge. Twenty `FrontComponent` widget renderer: `Gt(configuration,"FrontComponentConfiguration")` ⇒ `configuration.__typename === "FrontComponentConfiguration"`. `refresh-crm-chat` / app install пишет в `pageLayoutWidget.configuration` только `{configurationType:"FRONT_COMPONENT", frontComponentId}` **без** `__typename`. После refresh + flat-map reload клиент видит incomplete config → empty state `B6C0XJ` = «Нет данных» (не текст chat-panel).
- **Фикс (prod ASAP):** SQL `jsonb_set(…,'{__typename}','"FrontComponentConfiguration"')` на все `FRONT_COMPONENT` widgets (voxly/efim1/art-dekor, 18 rows); flush redis `page-layout*` / `front-component*` flat-maps; bump `metadataVersion`. Harden: `refreshCrmChatAppForTenant` патчит `__typename` + bump metadata после install.
- **Deploy:** ops SQL+redis на prod (backup tip `20260807-124124` still valid for prior ship); saas-api harden via `./scripts/prod-deploy.sh saas-api` when shipping code. **max-bridge / volumes untouched.** crm-chat **0.1.28** (WA preview) оставлен — не откатывали.
- **Verify:** DB Chat widgets have `__typename`; API Remont opp/person msgs=17 threads=2; CRM/API health 200.
- **User:** hard-refresh (Cmd/Ctrl+Shift+R) voxly-crm → сделка Remont → «Чат» → история MAX+WA. Re-send не нужен. **Closed ~16:14 MSK** — both MAX and WA chat confirmed OK.
- **Дата:** 2026-08-07.

### INC-115 — CRM WA photo/video show paperclip only (no preview) on multi-channel Person
- **Status:** ✅ **CLOSED** — user-confirmed WORKING 2026-08-07 ~16:14 MSK. Freeze: `modules/wa-crm-sync.md` + `crm-chat-panel.md`.
- **Симптом (voxly 2026-08-07 ~15:32–15:34 MSK):** CRM WhatsApp chat → outbound jpg / Marketing.mp4 / docx delivered OK (после INC-114), но в UI: `📎 ….jpg`, `📎 Marketing.mp4 · скачать` (нет `<img>`/`<video>`). Inbound `[фото]:` + «Фото» paperclip тоже без превью. Документ/текст OK.
- **Причина:** не сломанный store (`type=photo|video`, mime верные) и не Evolution download (worker `getBase64` OK). Person имеет **MAX (17 msgs) + WA (6)**; `findCrmChatTarget` / media resolve брали **default = busiest thread = MAX**. WA Evolution `fileId` на MAX-боте → 400 «Превью файлов для личного MAX…»; signed-url тоже клал MAX `botId` в токен → `/media` 400. Дополнительно: `botId !== default target` → 403; CRM outbound без `externalMessageId`.
- **Фикс:** saas-api `findAttachmentContext` — bot/peer по сообщению с этим `fileId` across all channels; убран жёсткий bot-mismatch; WA mime coerce + `externalMessageId` на outbound; worker `fromMe` hint + retry + lookup по attachments.fileId. crm-chat **0.1.28** — photo/sticker via signed URL + `isImageType` by extension.
- **Deploy:** `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker` backup `20260807-124124`; `refresh-crm-chat` voxly. **max-bridge не трогали.** Volumes untouched.
- **Verify:** media tokens → photo `200 image/jpeg` (~93KB), video `200 video/mp4` (~1.1MB), inbound photo `200`; `/file` outbound jpg `200`. max-bridge uptime unchanged vs pre-deploy.
- **User:** hard-refresh CRM WA chat — **re-send не нужен**. MAX preview path не меняли (только общий resolve по fileId). **Closed ~16:14 MSK** with WA chat confirmation.
- **Дата:** 2026-08-07.

### INC-114 — CRM→WA outbound photo/video «Owned media must be a url or base64»
- **Status:** ✅ **CLOSED** — user-confirmed WORKING 2026-08-07 ~16:14 MSK. Freeze: `modules/wa-crm-sync.md`.
- **Симптом:** CRM chat WhatsApp → send photo/video → 400 **Owned media must be a url or base64**. Text OK. Suspected after MAX media work (shared crm-chat upload).
- **Причина:** не MAX. `ai-whatsapp-worker` `sendWhatsAppMedia` слал Evolution `media` как `data:{mime};base64,…`. Evolution `sendMedia` проверяет `class-validator` `isBase64` / `isURL` — data-URI **проваливает оба** → BadRequest. MAX path (`sendViaMaxBridge`) отдельный, не задет.
- **Фикс:** worker → pure base64 (strip `data:` + whitespace); force `image/jpeg` / `video/mp4` when browser sends `octet-stream` but kind is image/video.
- **Deploy:** `./scripts/prod-deploy.sh ai-whatsapp-worker` backup `20260807-122920`. **Не** трогали `max-bridge` / `saas-api`. Volumes untouched.
- **Verify:** worker dist comment `Pass pure base64`; max-bridge/saas-api uptime unchanged vs pre-deploy; HTTPS smoke 200.
- **User smoke:** CRM WA → фото + видео → delivered; MAX outbound text/file без регресса (код MAX не меняли). **Closed ~16:14 MSK** with WA chat confirmation.
- **Дата:** 2026-08-07.

### INC-113 — MAX channel→CRM lead + owner profile leaked onto peer Person
- **Симптом (voxly ~14:51 MSK 2026-08-07):** (A) контакт «Марина Горохова» с телефоном/TG/WA/about/birthday владельца `+79150946944` / `@toxasagmsk` / `t.me/genadich_com`; MAX link `open/max/25786044`. (B) сделка `-70340712641969 · MAX · личный` из канала «Несносный дед PRO…».
- **Evidence:** control Conversation `25786044` + Person `ffd4ef82-…`; chat `25786044` type=DIALOG participants=`[3361844(me), 28981896]` — **chat id ≠ user id**; real peer `get_user(28981896)` = Марина `+79150910874`. Owner me=`3361844`. Channel `-70340712641969` type=**CHANNEL**. CRM message `max:117054011124502204` sender=**me** stored as `role=user` at 11:34Z → Person.updatedAt same second → `applyMaxProfile` phone overwrite + `enrichPersonCrossChannelByPhone` → toxasagmsk TG fields. Root: inbound skip-me used `client.me.id` but PyMax `me` is wrapper — User on **`me.contact`** → outgoing/CALL not skipped; live inbound had **no** CHANNEL filter (history sync already DIALOG-only); `/open/max` used chat id.
- **Фикс:** max-bridge — unwrap `me.contact`; skip negative ids + non-DIALOG; resolve peer user from sender/participants (never chat_id as user); never forward me phone; pass `maxUserId`+`chatType` (+ later `selfPhone`). saas-api — reject channel/self before lead; `applyMaxProfile` userId=maxUserId; phone fill-empty only. max-chat-sync — skip negative; open/max via `userId`.
- **Harden (same day):** `max-phone-guard` (`stripOwnerPhone`); inbound+history `selfPhone`; enrich `forbidPhones`; history sync no direct `updatePersonPhone` overwrite. Freeze card WORKING/FROZEN. Vitest `apps/saas-api/tests/max-phone-guard.test.ts`.
- **Cleanup (voxly):** Marina phone→`9150910874`, clear owner TG/WA/site/about/birthday, max→`open/max/28981896`; soft-delete channel Person/Opp; suppress channel Conversation; `BotInstance.phoneNumberId=3361844`.
- **Deploy:** `saas-api,max-bridge` backup `20260807-120603`; harden `20260807-121730`. Volumes untouched.
- **Дата:** 2026-08-07.

### INC-112 — CRM→MAX outbound video → «📎 Reklama.mp4 · скачать» (no player)
- **Симптом:** Outbound CRM→MAX video delivers in MAX app, but CRM bubble shows paperclip + filename + «скачать» (no `<video>`). Example: voxly · 07.08.2026 14:34 Reklama.mp4 (peer «Ремонт Инструмент»). Inbound regular video already OK after INC-110.
- **Причина:** Outbound `fileId` was `max:{chat}:{mid}:{kind}:out`. Media download called `get_video_by_id(video_id=int("out"))` → fail → signed URL 502 → `video.onError` → paperclip fallback. UI already treated `.mp4` as video (`isVideoType`); classification/store was secondary. Browser `octet-stream` for `.mp4` could also upload as File instead of Video.
- **Фикс:** max-bridge — resolve `:out` via `get_message` + attaches (real video_id/file_id + CDN, Chrome UA); classify outbound by extension; prefer real native id from send result. saas-api — force `video/mp4` mime for `.mp4` uploads + store `type=video` when kind is video.
- **Deploy:** `max-bridge,saas-api` backup `20260807-114320`. Volumes untouched. crm-chat tarball unchanged (no refresh).
- **Verify:** prod media for that fileId → 200 `video/mp4` (~3.1MB) via message attach `video_id`.
- **User:** hard-refresh CRM — **re-send not needed**. New outbound videos get better fileIds when send result has attaches.
- **Дата:** 2026-08-07.

### INC-111 — CRM→MAX outbound «Token has expired» (PDF then all send)
- **Симптом:** CRM chat → MAX (аккаунт «915» `cmshlhdd60002q6g7f9vydlky`, peer `346581106` «Ремонт Инструмент») — send PDF → UI **Token has expired**; затем не уходят media/files/text.
- **Prod evidence (2026-08-07 ~13:47 MSK):** в текущем `max-bridge` (после INC-110 restart 13:17) **нет** строк `Token has expired` / `send failed` около 13:47; последние успешные outbound до инцидента — photo×2 в **13:25** (`POST /messages/send` 200). Media download/read/inbound OK. Live probe **до** фикса: text + tiny PDF → bridge **200**. Значит сессия PyMax **жила**; UI-текст — сырой `ApiError`/MAX message через `detail=str(exc)` без humanize; полный outage в логах saas-api как failed `/reply` после 13:25 **не подтверждён** (возможен stale toast / клиент не дошёл до bridge / краткий auth glitch).
- **Не причина:** INC-110 Chrome UA (только `_http_get_bytes` download); wipe session; gift MAX Bot API.
- **Фикс:** max-bridge — detect session-auth errors (`Token has expired` / `FAIL_LOGIN_TOKEN` / …) → drop live client → **one** restore+retry on `/messages/send`; если всё ещё auth → **401** + RU «Сессия MAX истекла… QR». saas-api `humanizeCrmChatSendError` — тот же RU для CRM toast.
- **Deploy:** `max-bridge,saas-api` backup `20260807-105343`. Volumes untouched. Post-deploy: session restore + text/PDF smoke **200**.
- **User:** hard-refresh CRM; retry text then PDF. **Re-QR не нужен**, пока снова не увидит RU про сессию / статус Ошибка на `/dashboard/ai/max`.
- **Дата:** 2026-08-07.

### INC-110 — MAX regular video file → CRM «📎 Видео · скачать» (no player)
- **Симптом:** Inbound MAX voice / circle / PDF / sticker preview OK; regular **video file** shows paperclip + «Видео» + «скачать» (no `<video>`). Example: peer `346581106` «Ремонт Инструмент» `2026-08-07 13:09:19` MSK, `max:…:video:16001767006040`.
- **Причина:** Classification OK (`type=video`, `mimeType=video/mp4`). Circle uses `v.oneme.ru/videoMsg` (200 with default httpx UA). Regular file → PyMax `get_video_by_id` → **okcdn.ru** URL signed `srcAg=CHROME`; default httpx User-Agent → CDN **400** → bridge `/messages/media` 502 → CRM chat `video.onError` → download fallback. Sending `Origin: https://web.max.ru` also → 400.
- **Фикс:** max-bridge `_http_get_bytes` uses Chrome UA (+ `Accept: */*`), no Origin.
- **Deploy:** `max-bridge` only, backup `20260807-101651`. Volumes untouched. crm-chat unchanged.
- **Verify:** `/messages/media` for that fileId → 200 `video/mp4`; hard-refresh CRM chat → inline player; circle/voice/sticker/PDF still 200.
- **Дата:** 2026-08-07.

### INC-109 — MAX CRM media `[сообщение]` + no attach/read; TG send used MAX user id
- **Симптом:** Live MAX inbound OK (Person/Opp), но photo/PDF/voice → CRM `[сообщение]` без attachments; нет 📎 в MAX-треде; native MAX не показывает read/«печатает»; «Пишем от» Telegram → `peer not found` despite phone `+79918829870` / `@Remont_toua`.
- **Причина:** (1) max-bridge inbound forwarded only `text` (empty for media) → saas-api default `[сообщение]`. (2) `supportsAttachments` excluded `ai_max`; send blocked fileBuffer. (3) No `read_message` wiring. (4) `resolveOutboundPeer` treated `platform in (telegram,max)` as interchangeable → GramJS got MAX `platformUserId` without phoneE164; ImportContacts never ran; username not passed to bridge. (5) MAX message snowflakes > JS `Number.MAX_SAFE_INTEGER` — JSON number `messageId` corrupted precision for read/media.
- **Фикс:** bridge extract `attaches` + `/messages/media` + `/messages/read` + outbound Photo/File/Voice/Video; inbound schema stores attachments; crm-chat channel-scoped peer resolve + phone/@username to GramJS; ImportContacts wins when CRM id mismatches phone map. **Typing:** PyMax exposes `MSG_TYPING` / `on_typing` only — no public send-typing API → unsupported (documented).
- **Deploy:** `max-bridge,saas-api,gramjs-bridge`. Backfill: optional MAX history sync for old `[сообщение]` rows.
- **Verify:** MAX photo/PDF/voice → preview; 📎 outbound; open chat → read in MAX app; TG send to Remont_toua via phone/@username.
- **Дата:** 2026-08-07.

### INC-108 — MAX live inbound never created Person/Opportunity (handler arity)
- **Симптом:** `/dashboard/ai/max` shows account **На связи** (label `915`, MAX id «появится после скана»), но сообщение с другого MAX → CRM без Person/Opportunity. History sync button не нажимали.
- **Причина:** PyMax 2.4 `Dispatcher._call` вызывает `callback(event, self.client)`, а max-bridge `_listen_inbound.on_msg` принимал **1** аргумент → `TypeError: takes 1 positional argument but 2 were given` на каждом opcode=128; `POST /api/internal/max/inbound` не вызывался. Auto-disable history sync **не** виноват (отдельный путь).
- **Prod evidence:** bot `cmshlhdd60002q6g7f9vydlky` tenant `cmseeil8m00073ji1pz62ry1z` — **0** Conversation / **0** ChatMessage; saas-api без `/internal/max/inbound`; max-bridge errors с 2026-08-06 16:59 через 2026-08-07 08:27 (~45 за 24h).
- **Фикс:** `on_msg(message, event_client=None)` + skip self (`sender == me.id`); log `inbound forwarded`. Deploy `max-bridge` only.
- **Backup:** `/opt/voxly/backups/20260807-083628/`. Volumes untouched.
- **Verify:** send DM to connected MAX → max-bridge `inbound forwarded` + Conversation/Person/Opp; UI «появится после скана» = empty `phoneNumberId` (cosmetic, restore sees `profile=3361844`).
- **Дата:** 2026-08-07.

### INC-107 — `reapply-crm-defaults` 200 but Person social fields stay in System (MAX under WhatsApp)
- **Симптом:** Admin `POST …/reapply-crm-defaults` returns `{ok:true}` (superadmin JWT required — `VOXLY_SERVICE_TOKEN` → 401). Prod `core.viewField` still has `telegram`/`whatsapp`/`max` in **System** (max at pos 14), not Social under LinkedIn.
- **Причина:** (1) Admin route is `requireSuperadmin` (JWT), not service token. (2) Twenty **in-memory flat-maps** can diverge from `core.viewField`: `getViewFields` / `updateViewField` report Social positions while Postgres still has System — mutation becomes a no-op; redis flush + `metadataVersion++` alone is not enough. (3) `movePersonFieldsToSocialGroup` catch was silent.
- **Фикс (ops):** SQL `UPDATE core.viewField` → Social group, positions Telegram=1 WhatsApp=2 MAX=3 …; redis keys `*workspaceId*`; `metadataVersion++`; **recreate `twenty-server` (+ worker)** without `-v`. Code: warn log in catch (INC-107 note).
- **Verify:** SQL + GraphQL both show LinkedIn→Telegram→WhatsApp→MAX in Social; hard-refresh Person card.
- **Дата:** 2026-08-06.

### INC-106 — WA Person stayed `nonameN` / empty Telegram despite TG account on phone
- **Симптом:** Person **noname98** (deal `350 · WA · 9150946944`, phone `+77784112019` / `wa.me/77784112019`) — Telegram empty, name still `noname98`. User’s Telegram contact for same phone: **Оксана Шамсутдинова**.
- **Причина:** (1) `enrichTelegramPresenceFromPhone` after GramJS `ImportContacts` found `userId` **without** `@username`, still scraped `t.me/+{phone}`; error-page HTML matched → **early `return`**, discarding `userId` before `updatePersonTelegram` / GetFullUser. (2) `ImportContacts` echoes probe names `Voxly`/`Check` — not real ФИО; real name only from `GetFullUser`. (3) No backfill for existing noname+phone rows.
- **Prod evidence:** live `/users/by-phone` → `userId=6392903179` (probe names); `/users/full` → `Оксана` / `Шамсутдинова`; Person telegram URL empty; **109** voxly Persons with phone + noname/empty TG.
- **Фикс:** skip scrape when GramJS already resolved user; bridge `/users/by-phone` **DeleteContacts then GetFullUser** (probe names otherwise stick); `applyTelegramProfile` replaces only placeholder names (`nonameN` / empty / probe); admin `POST …/enrich-persons-by-phone` rate-limited backfill (prefer `wa.me` E.164); GramJS sync applies dialog profile onto phone-matched Persons.
- **Deploy:** `gramjs-bridge,ai-whatsapp-worker,saas-api` backup `20260806-143720`. Never `t.me/+phone`. (MAX phone enrich wired later same day via PyMax `search_by_phone` — see WORKLOG / `modules/max-personal.md`.)
- **Verify:** hard-refresh noname98 → **Оксана Шамсутдинова** + Telegram `https://api.getvoxly.ru/open/tg/6392903179`; WhatsApp `wa.me` unchanged.
- **Дата:** 2026-08-06.

### INC-105 — MAX personal QR → status Ошибка `maxUserId` null
- **Симптом:** `/dashboard/ai/max` after QR (+2FA) shows badge **Ошибка**: `400: { fieldErrors: { maxUserId: ['Expected string, received null'] } }`. Account label e.g. `915`.
- **Причина:** After INC-104 `on_start` path, bridge calls `POST /internal/max/bots/upsert` with `"maxUserId": null` when PyMax `me`/profile id is not ready yet. Zod `z.string().optional()` rejects JSON `null` (only `undefined`).
- **Фикс:** saas-api `maxUserId: z.string().nullish()`; bridge `resolve_me` retry + always send string (`""` if unknown). Deploy `saas-api,max-bridge` only.
- **Backup:** `/opt/voxly/backups/20260806-140626/`. Volumes untouched. Frozen modules not rebuilt.
- **Verify:** hard-refresh → «Показать QR» → scan (+2FA) → **Подключено** (not Ошибка); §03 row; optional MAX id when profile resolves.
- **Дата:** 2026-08-06.

### INC-104 — MAX personal QR stuck on «Проверяем пароль…»
- **Симптом:** `/dashboard/ai/max` after QR + 2FA cloud password stays on badge **«Проверяем пароль…»**; section 03 empty; account label e.g. `9150946944` (метка, не спец. id MAX).
- **Причина:** PyMax `WebClient.start()` **не возвращается** до disconnect (event loop). Bridge `await start()` после успешного 2FA → никогда не делал `bots/upsert` / `status=authorized`. Wrong password silently re-asked; stale `pending-*` session → `FAIL_LOGIN_TOKEN` / 400 «No pending password challenge» без RU UX.
- **Фикс:** `on_start` + `wait_client_ready` (не ждать return `start`); wipe pending на новый QR; wrong-password → `waiting_password` + error; portal: `detail` errors, hint, 90s timeout tip. Deploy `max-bridge,saas-portal` only.
- **Backup:** `/opt/voxly/backups/20260806-135432/`. Volumes untouched. Frozen modules not rebuilt.
- **Verify:** hard-refresh → trial/sub → «Показать QR» → MAX Devices → 2FA (hint) → status **Подключено** + row in §03.
- **Дата:** 2026-08-06.

### INC-103 — GramJS «Пишем от» greyed despite Person Telegram link (Кувалдин)
- **Симптом:** Person «Кувалдин» has Telegram `tg://user?id=928954961` + WA; Chat «Пишем от» shows both GramJS accounts **(недоступно)**; only WA sendable.
- **Причина:** `resolveOutboundPeer` for `ai_gramjs` required GiftSubscriber / telegram Conversation / non-WA `baseTarget.telegramId`. WA-opened cards never read Person.telegram LINKS (`/open/tg/{id}`). Open-profile link ≠ send peer bind.
- **Фикс:** `parseTelegramPeerFromLink` + `resolvePersonTelegramPeerFromTwentyDb` → enable GramJS when Person has userId/@username; first send creates Conversation; bridge `/messages/send` ImportContacts(`phone`, keepContact) if `getEntity` fails. Gift gate unchanged.
- **Deploy:** `saas-api,gramjs-bridge` (this session).
- **Verify:** hard-refresh Кувалдин Chat → select GramJS → send text; Conversation appears for that bot.
- **Дата:** 2026-08-06.

### INC-102 — Open Telegram Person without public @username
- **Симптом:** GramJS chat peer `7083659060` / Кувалдин (`+79850868825`, userId `928954961`) — чат работает, но Person.telegram пустой (нет `@nickname`). User wants clickable open-in-Telegram.
- **Причина:** product forbade inventing `t.me/+phone` (INC-097/101); WA→TG / sync only wrote `@username`. Raw `tg://user?id=` stores via Zod `.url()`, but Twenty front `ensureAbsoluteUrl` mangles `tg://` → `https://tg://…` so LINKS pills are not clickable.
- **Фикс:** `telegramOpenLink({ username?, userId? })` → `https://t.me/{user}` or HTTPS bridge `GET /open/tg/:userId` (HTML → `tg://user?id=`); label = `tg://user?id=…`. Wired gramjs-chat-sync / ai-tg / ai-wa enrich / gift; admin `POST …/backfill-telegram-open-links`. Never `t.me/+phone`.

### INC-101 — Social LINKS showed button label "WhatsApp"/"Telegram" instead of URL
- **Симптом:** Person «Социальные сети» pills showed only **WhatsApp** / **Telegram** (field name), not `https://wa.me/…` / `https://t.me/Ann_fire`. Кувалдин Сергей (`+79850868825`) had WA filled, Telegram empty — user expected `https://t.me/+79850868825`.
- **Причина (UI):** `linksInput` / migrate set `primaryLinkLabel` to generic `"WhatsApp"`/`"Telegram"` (or empty → Twenty falls back to field label). URL was in `primaryLinkUrl` but not shown as text.
- **Причина (Кувалдин TG empty):** WA→TG path OK. Live GramJS `ImportContacts` + `GetFullUser` → userId `928954961`, name «Сергей», **no public `@username`**. Scrape `t.me/+79850868825` → Telegram error/"Join group chat" page, not a handle. Product **forbids** storing `t.me/+phone` (deep-link ≠ @username).
- **Фикс:** `linksInput` → `primaryLinkLabel = url`; migrate backfill label=url; admin reapply calls migrate. No invent `t.me/+`. Follow-up INC-102: open via `/open/tg/{userId}` when id known.
- **Prod:** backup `20260806-102034`; deploy saas-api + WA/TG workers; migrate voxly → **196** WA + **321** TG labels = URL (0 generic). Opp **399** vs **400**: different People (Ольга vs Кувалдин) — not a dupe.
- **Verify:** hard-refresh Анна → visible `https://t.me/Ann_fire`; noname122 → `https://wa.me/79995742245`; Кувалдин Telegram stays empty.
- **Дата:** 2026-08-06.

### INC-100 — WA sync left two Opportunities on one Person (noname100)
- **Симптом:** Person **noname100** (voxly) showed two open deals `171 · WA · 9150946944` and `352 · WA · 9150946944` after WA sync. Title `· WA · 9150946944` = our account display name (expected); bug = duplicate Opps on same Person.
- **Причина:** race — two Opps created ~223ms apart (LID/PN twin or parallel sync) before reuse; Conversation kept only Opp `352`; orphan `171` stayed on Person. Writers stored WhatsApp as plain TEXT → not clickable.
- **Фикс:** reuse `findOpenOpportunityByPerson` before create (WA+TG workers); soft-delete orphan Opps after twin merge; save-time collapse in `crm-deal-dedupe`; Person social → **LINKS** + `socialFieldToUrl` / migrate SQL (wa.me / t.me/@user only).
- **Prod repair:** soft-delete orphan `4eb97672-…`; bulk collapse **67** leftover WA dup Opps (keep Conversation-linked) → **0** remaining; migrate voxly social TEXT→LINKS; noname100 `https://wa.me/6281351989740`.
- **Deploy:** rebuild saas-api + ai-whatsapp-worker + ai-telegram-worker; restart twenty-server/worker. Volumes untouched.
- **Verify:** hard-refresh noname100 → one Opp; WhatsApp is a link; re-sync does not add a second open WA Opp.
- **Дата:** 2026-08-06.

### INC-099 — «Пишем от» offered gift bot for non-subscribed GramJS peers
- **Симптом:** CRM Chat on GramJS personal deal (e.g. `@varivan · AI · @genadich_agency`) shows gift bot in «Пишем от»; send would fail (peer not a GiftSubscriber).
- **Причина:** `resolveOutboundPeer` treated `gift`/`gift_max` like `ai_gramjs` — any Telegram peer / baseTarget telegramId marked gift **available**.
- **Фикс:** gift only if `GiftSubscriber` or Conversation on **that** gift bot; unavailable gift options omitted from `sendFromOptions`. Also: WA send allowed when Person.whatsapp filled (no prior WA dialog required; no invent from phones alone). Save-time dedupe: Twenty LFs → `POST /api/crm/chat/dedupe` (INC companion product ask).
- **Deploy:** saas-api rebuild + backup `20260806-093403` + crm-chat **0.1.27** refresh voxly.
- **Verify:** hard-refresh CRM → GramJS-only deal → no gift in dropdown; contact with WhatsApp field → WA option; save deal with shared phone → soft-merge notes / retarget.
- **Дата:** 2026-08-06.

### INC-098 — CRM Chat still shows `[media]` after GramJS attachment backfill
- **Симптом:** `@kahlenko` Aug 23 bubbles = literal `[media]` after sync + hard-refresh; DB already had `[файл: IMG_…]` + attachments.
- **Причина:** (1) ChatPanel soft-refresh `lastSig` = message **ids only** → content/attachment backfill ignored while panel open / soft «Обновить»; (2) `isMediaPlaceholder` did not match legacy `[media]`.
- **Не причина:** API/bridge media 401 — `GET …/signed-url` + `/media/*` for `gramjs:149487687:679` returned **200** `image/jpeg`.
- **Фикс:** crm-chat **0.1.26** — fingerprint content+fileIds; hide `[media]`/`[документ]` when attachments present; document+image mime → `<img>`.
- **Deploy:** saas-api backup `20260806-090344` + `refresh-crm-chat` voxly.
- **Verify:** hard-refresh CRM → open deal → Чат → photos, not `[media]`.
- **Дата:** 2026-08-06.

### INC-097 — WA history sync created empty Person/Opportunity shells
- **Симптом:** после «Синхронизировать» на `/dashboard/ai/whatsapp` — пачка сделок `WhatsApp · WA · {ownDisplayName}` (напр. `9855014040`); Person «WhatsApp» без Phones / WhatsApp social / ФИО; пользователь видит пустые поля («Нет данных»). Chat tab для этих карточек может казаться пустым/битым; API chat при живых links + messages **работает**.
- **Причина:** Evolution `findChats` отдаёт почти только `@lid` без `remoteJidAlt`/`senderPn`/имени; Contact book (PN + pushName) **не связан** с LID chats; history sync звал `syncLeadToCrm` без E.164 → Person `firstName=WhatsApp`, phone skipped (INC-037/039). `9855014040` в title = **bot displayName**, не телефон контакта. Доп. баг: `lastMessage.pushName=Você` (fromMe) принимался за имя контакта.
- **Фикс (v1):** history sync — resolve PN via message extractors + Contact/Chat + Redis Baileys `lid-mapping-*_reverse`; skip system/self/`0@`; skip CRM shell без E.164 и без реального имени; business profile как inbound; `repairEmptyWaHistoryLeads` soft-delete пустых shells + clear Conversation CRM ids (messages keep). `Você`/`You` → not a name.
- **Регрессия:** v1 skip → **0 deals** после sync (все LID без E.164/имени). `repairEmptyWaHistoryLeads` ещё и сносил LID-лиды с именем.
- **Фикс (v2, 2026-08-05):** preload Evolution Contact book; sync **PN `@s.whatsapp.net` contacts** as dialogs; LID→PN via book row + **unique pushName** (letter names only); PN `findMessages` fallback; repair только без phone **и** без real name; after phone → Telegram presence (`gramjs /users/by-phone` ImportContacts + `t.me/+` scrape) → Person.telegram; CRM Chat resolves Opportunity → `pointOfContact` Person when Conversation linked only by personId.
- **Регрессия v2:** Contact book как primary source → **100+ deals** из адресной книги (не open chats); Chat «Нет данных» на пустых shells.
- **Фикс (v3, 2026-08-05):** reverse — dialog source = **findChats + findMessages only**; Contact book **enrich only**; skip 0-message rows (no Conversation/CRM); repair soft-deletes CRM-linked WA Conversations with **zero** ChatMessages (+ legacy empty identity); crm-chat SQL fallback for Opportunity.pointOfContactId; prefer threads with messages. **TG presence:** write Person.telegram **only** on positive confirm (`ImportContacts` exists + `@username`, or scrape yielding real @handle); **never** invent `https://t.me/+{phone}` (deep-link ≠ account); repair clears false `t.me/+` fields.
- **Регрессия v3:** после wipe всех People/Opportunities в Twenty → sync `peopleSynced=0`. Open chats = 14× `@lid` без E.164/имени/Redis `lid-mapping`; v3 `emptyIdentity` skip не звал `syncLeadToCrm`; repair ещё и soft-delete'ил LID chats **с** messages. Contact book 1439 PN — msgs=0, не диалоги.
- **Фикс (v4, 2026-08-05):** open chats **with messages** always recreate Person+Opportunity (LID-only → `needsReview`); `clearStaleWaConversationCrmIds` before sync; repair **only** zero-message shells; reuse Conversation `platformUsername`/`platformFirstName` cache.
- **Регрессия v4:** 14 карточек `WhatsApp · WA · 9855014040`, Person «WhatsApp», **phones empty** (email/website с business profile ок). Пользователь отказался от безымянных shells.
- **Фикс (v5, 2026-08-05):** **никогда** не создавать Person `firstName=WhatsApp` без E.164; CRM только при phone **или** real name (pushName / business verifiedName / website host / description); LID без identity → **Conversation-only** (messages keep); `repairEmptyWaHistoryLeads` soft-delete live «WhatsApp»+empty-phone shells (не только zero-msg); business name → rename Person+Opportunity; skip punycode `xn--` hosts as names. **Prod truth for bot 79855014040:** Evolution Message keys = 0×`remoteJidAlt`/`senderPn`; Redis `lid-mapping` empty for peer LIDs; Contact book не связан с 14 LID chats → **0 phones resolvable** until Baileys mapping or inbound PN twin.
- **Verify (v5):** force sync → `peopleSynced=4` (Boomerservice, Polimeroom, АВТОСЕРВИС, Ремонт…), `skippedEmptyIdentity=10`, `repairedEmptyLeads=10`; live WhatsApp-named people/opps = **0**; phones still **0/14** (Evolution cannot map); 10 Conversation-only open chats.
- **Фикс (v6, 2026-08-05):** profile-index `buildWaProfilePnIndex` (PN `fetchProfile` → email/website/pic→E.164; match LID profile — Boomerservice `+79262625252` shares email/website/pic with PN but LID JSON has no E.164); `fetchAllEvoMessagesForJid` + LID/PN merge; always CRM Person+Opportunity (`nonameN`); Opportunity `{seq} · WA · {bot.displayName}`; default messageLimit **500**; stop renaming opps to `{contactName} · WA · {bot}`.
- **Честность:** если Evolution не сохранил PDF/outbound под LID или PN — CRM **не может** выдумать эти сообщения; телефон восстанавливается через profile-index когда совпадают email/website/pic.
- **Verify (v6):** force sync bot `cmsfsbnei00028n4dkn9cgwkq` → `peopleSynced=14`; Boomerservice Person phones/whatsapp `+79262625252`; Opp `28 · WA · 9855014040`; 14 live WA opps; CRM msgs for Boomerservice = **1** (Evolution LID-only history).
- **Фикс (v6.1, 2026-08-05):** LID↔PN **Conversation split** после v6 profile-index: один peer = **два LID** (stale outbound-only `75351208272113` без email/pic + rich `20774874288269` → `+79262625252`) → две Conversation + дубли CRM. `mergeWaLidPnTwinConversations` (history sync, `syncLeadToCrm`, `repairOnly`): siblings по LID/+E.164/Redis `lid-mapping`/CRM ids; stale outbound LID → rich `+phone` thread; move ChatMessages (dedupe `externalMessageId`); canonical LID `platformUserId` + `platformUsername` +E.164; twin `closed`.
- **Verify (v6.1):** backup `/opt/voxly/backups/20260805-153229/`; Boomerservice canonical `cmsfuzk8q004t9gwm4piiqywh` **4 msgs** (3 outbound stale LID + 1 inbound), `+79262625252`, LID `20774874288269`; closed twin `75351208272113` 0 msgs; one Person/Opp on canonical.
- **Фикс (v7, 2026-08-05):** wire **official** Evolution LID→PN paths worker skipped: `Message.key` `remoteJidAlt`/`senderPn` SQL; Redis `lid-mapping-*_reverse` (unchanged); `IsOnWhatsapp.jidOptions` (Evolution `saveOnWhatsappCache` on inbound with `addressingMode=lid`); `POST /chat/whatsappNumbers` (cache + Baileys). Consolidated `resolveLidPhoneFromEvolution()` — profile-index stays last fallback. **Evolution source refs:** `whatsapp.baileys.service.ts` `signalRepository.lidMapping.getPNForLID` (calls only, not REST); `onWhatsappCache.ts` `saveOnWhatsappCache`/`getOnWhatsappCache`; Message webhook `remoteJidAlt`/`senderPn` in `waInboundIdentityCandidates`. Chat/Contact Prisma **have no** `remoteJidAlt` columns — only runtime webhook + Message.key JSON.
- **Verify (v7):** deploy `ai-whatsapp-worker`; force sync — expect `is_on_whatsapp` / `message_key` / `whatsapp_numbers` logs when Evolution has stored twins; Boomerservice still resolvable via profile-index if DB twins absent.
- **Регрессия v7:** `repairOnly` + force sync OOM (exit **137**) — `buildWaProfilePnIndex` + `repairWaLidPnSplit` walked **~418** contact-book-era Conversations and bulk Contact-table PN candidates (1400+), not ~14 open `findChats`.
- **Фикс (v7.1, 2026-08-05):** profile-index candidates = open `findChats` PN + scoped Message/IsOnWhatsapp for those JIDs only (Contact table **not** primary fill); `repairWaLidPnSplitConversationsForBot` scoped to open peers + convs with messages; `repairOnly` loads open chats first; aggressive `fetchCap` tied to open-chat count.
- **Фикс (v8, 2026-08-05):** Evolution image patch `docker/patch-evolution-lid-pn.cjs` on `voxly-evolution-api:v2.3.7-lid`: `fetchProfile` + `findChats` enrich `@lid` with `remoteJidAlt`/`senderPn` via Baileys `signalRepository.lidMapping.getPNForLID`, then **Redis fallback** `this.cache.hGet(instanceId, lid-mapping-{lid}_reverse)` (Evolution instance hash DB 6 — **not** `baileysCache`). Worker **unchanged** — reuses existing `extractWaPhoneE164` / `resolveLidPhoneFromEvolution()` (no avatar twin, INC-059).
- **Регрессия v8 (first deploy):** `fetchChats` patch matched literal `dm(r)` in `FETCH_CHATS_FROM`, but **runtime** module `whatsapp.baileys.service.mjs` minifies guard as `yp(r)` — patch landed only in unused `main.mjs` chunk; controller `fetchChats` never enriched. Symptom: `fetchProfile(@lid)` OK for mapped LIDs, `findChats` **0/14** `remoteJidAlt`.
- **Фикс (v8.1, 2026-08-05):** `docker/patch-evolution-lid-pn.cjs` — regex `\w+\(r\)` for service `fetchChats` (75 files incl. `whatsapp.baileys.service.mjs`); `for…of` + `Array.isArray`; controller wrapper `voxly-lid-pn-ctrl` enriches after `waInstances[s].fetchChats` (150 files); `baileysCache` Redis fallback on `fetchProfile` too. Worker **unchanged**.
- **Честность (v8.1 prod):** Redis `evolution:instance:9cd3ff77-ca34-41ac-bba3-eb1270e52ed4` has **3** `lid-mapping-*_reverse` (2 peer PN + bot self). `getPNForLID` empty for most historical LIDs. `findChats` now **2/14** `remoteJidAlt` (`20774874288269`→`79262625252`, `159004152090810`→`79032692646`). Message.key still **0** `remoteJidAlt`/`senderPn`. **12/14** open chats: no Baileys/Redis mapping → CRM phone empty unless profile-index (email/website/pic) or future inbound with `senderPn`.
- **Фикс (v8.2, 2026-08-05):** worker — poisoned `fetchProfile` on unmapped `@lid` (returns **own** business `79855014040` / `anton@genadich.com`); `pnPhones` from `remoteJidAlt`; profile-index `fetched=0` bug; pic-only profile-index **disabled** (false 7× `79032692646` Redis maps, cleaned HDEL). `presenceSubscribe` poke before resolve — **no new mappings**. **Still 2/14** phones — companion lacks Baileys `lidMapping` for 12 peers; WA UI number = phone client local mapping / address book, not Evolution.
- **Verify (v8.2):** deploy `ai-whatsapp-worker` backups `20260805-212256/`, `20260805-212636/`; force sync **57s** → `peopleSynced=14`; CRM **2/14** (`+79262625252` Boomerservice, `+79032692646` Пашка). User action for remaining: open each chat on linked phone or wait inbound with `senderPn`.
- **Verify (v8.1):** deploy `evolution-api` backup `/opt/voxly/backups/20260805-210810/`; WA session **no QR** (reconnect ~15s). Force sync bot `cmsfsbnei00028n4dkn9cgwkq` **39s** → `dialogs=14 peopleSynced=14`; CRM `platformUsername` phone **2/14** (same two LIDs). Profile-index did not add phones for remaining 12 on this run.
- **Deploy:** v1 `…092457/`; v2 `…095059/`; v3 `…101610/`; v4 `…103459/`; v5 `ai-whatsapp-worker` backups `/opt/voxly/backups/20260805-105239/` (+ `105544/`, `105823/`); v6 `ai-whatsapp-worker` backup `/opt/voxly/backups/20260805-141016/`; v7 `ai-whatsapp-worker` backup `/opt/voxly/backups/20260805-150848/`; v7.1 `ai-whatsapp-worker` backup `/opt/voxly/backups/20260805-153506/`; v8 `evolution-api` backups `20260805-161407/`, `20260805-161718/`, `20260805-161822/`; **v8.1** `evolution-api` backup `20260805-210810/`.
- **Re-sync:** portal «Синхронизировать» or `POST …/whatsapp/accounts/:botId/sync-history` (force).
- **Дата:** 2026-08-05.

### INC-096 — GramJS group message created CRM deal (MG 8855743233)
- **Симптом:** в CRM voxly сделка `8855743233 · AI · @toxasagmsk`, контакт `MG 8855743233`; сообщения нет в личке Telegram. Параллельно `@igor_dev_ru · AI · @genadich_agency` — чат пустой в CRM.
- **Причина:** (1) GramJS `NewMessage` обрабатывал **любого** `Api.User` sender, в т.ч. сообщения **в группе/мегагруппе** → `syncLeadToCrm` создавал Person+Opportunity. User id `8855743233`, firstName `MG`. `ReadHistory` на peer падал (`Could not find the input entity`) — типично для non-DM. (2) Igor: реальное private inbound (фото + «Чем они отличаеться?» + vision), но `Conversation.botInstanceId=null` после reconnect/delete → CRM chat `listCrmChatTargets` пропускал тред (`botInstanceId: { not: null }`).
- **Фикс:** GramJS — AI/CRM только если `getChat() instanceof Api.User` (private 1:1); group/channel → audience sighting only. `suppressDealCreation` на Conversation/GiftSubscriber — **только** ручной CRM toggle «Не создавать сделку» (не auto-set при delete Opportunity). Orphan threads: fallback bot + relink on sole GramJS connect. Private dialog sync on connect (**all** private dialogs × **30** msgs).
- **Verify:** сообщение в группе не создаёт сделку; DM создаёт; после delete deal + inbound — сделка может пересоздаться, пока флаг не включён вручную; sync button / reconnect показывает историю private.
- **Deploy:** `gramjs-bridge,saas-api,ai-telegram-worker,ai-whatsapp-worker,gift-bot-worker` + crm-chat **0.1.25**.
- **Дата:** 2026-08-05.

### INC-095 — Gift extra URL buttons vanish on save (step 4+)
- **Симптом:** на шаге 4 («пост после старта») пользователь добавляет доп. кнопку (текст + https), превью показывает её, «Сохранить» → строка исчезает, в `funnelJson` нет `extraButtons`. То же для gift / afterGift / дожим при общем `saveCampaign`.
- **Причина:** zod `campaignSchema` принимал `extraButtons`, portal слал их, но API `sanitizeFunnel()` пересобирал `start` / `gift` / `mapMsg` **без** копирования `extraButtons` → запись в `funnelJson` теряла поле; `load({ refreshForm: true })` после save подтягивал пустой список.
- **Фикс:** `sanitizeFunnel` + helper `sanitizeExtraButtons` сохраняют валидные http(s) кнопки на start/gift/MessageList; portal кнопка шага 4 → «Сохранить».
- **Verify:** добавить кнопку на шаге 4 → сохранить → reload → кнопка на месте; `/start` в TG показывает канал + custom + «Я подписался».
- **Deploy:** `saas-api,saas-portal` (worker уже читал `extraButtons` из JSON).
- **Дата:** 2026-08-05.

### INC-094 — Gift media quality loss on upload (sendPhoto staging)
- **Симптом:** фото/видео после загрузки в gift-бот выглядят хуже оригинала; посты в канале/воронке тоже «мыльные».
- **Причина:** `POST …/media` staging шёл через Telegram `sendPhoto`/`sendVideo` → TG сразу пережимает и отдаёт сжатый `file_id` (AgAC/BAAC). Клиент **не** рекомпрессил пост-медиа (`fileToJpegFile` только для аватара). Повторный `sendPhoto` с тем же file_id не сжимал второй раз — оригинал уже потерян на staging.
- **Фикс:** staging photo/video → `sendDocument` first (оригинал, BQAC); `mediaType` остаётся photo/video; `detectStoredMediaKind(BQAC, photo|video)` → intent; publish/worker: download (`getFile` ≤20 МБ) → `sendPhoto`/`sendVideo` (одно сжатие TG при доставке). Если getFile недоступен → fallback `sendDocument` (оригинал без inline-photo UX).
- **Verify:** новый upload JPEG/PNG/MP4 → `mediaType` photo/video + BQAC file_id; превью через media-file показывает оригинал; publish/воронка — photo/video в TG; PDF по-прежнему document.
- **Deploy:** `saas-api,gift-bot-worker,saas-portal` (shared).
- **Дата:** 2026-08-04.

### INC-093 — Gift TelegramPreview shows «Медиа загружено» instead of photo/video
- **Симптом:** `/dashboard/bots/:id` шаги 3–4: слева «Файл сохранён в Telegram · photo» / «Файл в Telegram», справа серый блок «Медиа загружено».
- **Причина:** после staging в Telegram UI хранит только `telegramFileId`; `mediaUrl`/`imageUrl` очищаются; blob preview живёт только в session state. `TelegramPreview` при `mediaPlaceholder` без `src` рисовал placeholder. Reload / другой блок без blob → нет displayable URL (`file_id` не публичный). Доп.: gift `type=file` дефолтил `mediaType: document` → `useResolvedMediaSrc` не фетчил photo/video; `detectStoredMediaKind` раньше отдавал hint `document` приоритетнее префикса `AgAC`.
- **Фикс:** `GET /api/bots/:botId/media-file?fileId=` (auth + tenant) → Telegram `getFile` proxy (как avatar); `TelegramPreview` принимает `botId`+`telegramFileId` и резолвит blob URL для photo/video/video_note; document/voice/audio — текстовые индикаторы. Blob после upload по-прежнему preferred. Follow-up: prefixes authoritative in `detectStoredMediaKind`; TelegramPreview всегда резолвит kind по `file_id`; gift preview больше не дефолтит document.
- **Verify:** hard-refresh bot с уже сохранённым photo/video → превью показывает картинку/видео; новый upload → сразу blob; PDF → «Файл загружен»; gift file photo с AgAC+legacy document hint → photo.
- **Deploy:** `saas-api,saas-portal` (media-file); follow-up `saas-portal` backup `/opt/voxly/backups/20260804-111207/`.
- **Дата:** 2026-08-04.

### INC-092 — Login 500: disk full → control PG recovery loop + Redis MISCONF
- **Симптом:** `/login` → Internal Server Error; `POST /api/auth/login` **500** for any email (incl. `anton@genadich.com`). Health API still 200.
- **Evidence:** saas-api `PrismaClientUnknownRequestError` / `FATAL: the database system is in recovery mode` on `user.findUnique`; Redis `MISCONF` / AOF+RDB `No space left on device`; `postgres-control` **unhealthy**, crash-loop: redo OK → checkpoint `PANIC: … replorigin_checkpoint.tmp: No space left`; `df /` **100%** (0 avail). Recurrence of INC-052.
- **Причина:** root disk filled by **~68GB dangling Docker images** after many same-day rebuilds (not auth/JWT/code). PG could not finish end-of-recovery checkpoint; Redis stopped writes.
- **Фикс (no volume wipe, no code deploy):** truncate large `*-json.log`; `journalctl --vacuum-size=50M`; `docker image prune -f` (reclaimed **68GB** → `df` ~26% / 70G free); `restart postgres-control` → `pg_is_in_recovery=f`, healthy; Redis BGSAVE ok; `restart saas-api` (+ gift/platform/manager/ai workers) to drop dead Prisma pools (P1017 after PG bounce).
- **Verify:** `POST /api/auth/login` → **401** `Invalid credentials` (not 500); user `anton@genadich.com` present; `/login` 200; api/health 200; control PG healthy.
- **Backup:** prior deploy backups still at `/opt/voxly/backups/20260804-103952/` (and earlier today); no new dump required for this ops fix.
- **Prevention:** prune dangling images after heavy deploy days; keep ≥15GB free before rebuilds (same as INC-052).
- **Дата:** 2026-08-04.

### INC-091 — Gift media: PDF/DOC coerced to photo; voice/video_note unsupported
- **Симптом:** после загрузки PDF/DOC/XLS save/publish поста слали `mediaType: photo`; голосовые и кружочки уходили как document/video.
- **Причина:** UI `normalizePromo` / save/publish: `mediaType === 'video' ? 'video' : 'photo'`; staging только photo|video|document.
- **Фикс:** `detectUploadMediaKind` + kinds `voice`/`video_note`/`audio`; API staging `sendVoice`/`sendVideoNote`/`sendAudio`; worker `sendBotStoredMedia`; portal accept + checkbox «кружочек»; preserve `document` on save.
- **Verify:** unit tests shared; upload PDF/DOC/XLS/OGG/MP3/photo/MP4 + кружочек ≤48МБ → file_id + publish.
- **Дата:** 2026-08-04.

### INC-090 — Gift media upload 499 at ~57%: Traefik readTimeout 60s
- **Симптом (после INC-089):** UI «Отправка/Загружено 57%» → abort. Bot `cms3bdwkj000aq8b1wyygzspl`.
- **Evidence (2026-08-03 ~16:01–16:03 UTC):** NPM `proxy-host-5`: OPTIONS 204 then POST **499** exactly **~60s** later (`16:01:05→16:02:05`, `16:02:52→16:03:52`); `[Length 21]`; Sent-to `docker-traefik-1`. saas-api **did receive POST** (`req-i1`, `req-jr`) but never `request completed`. Live Traefik entrypoint `web` had `respondingTimeouts.readTimeout: 1m0s`. NPM `proxy_request_buffering off` still live.
- **Причина:** Traefik default **readTimeout 60s** aborts reading the multipart body mid-stream; XHR upload progress (~57%) is client-side bytes sent before the connection dies — not server processing %. Portal timeout already 300s (INC-089).
- **Фикс:** `docker-compose.prod-npm.yml` → `entryPoints.web.transport.respondingTimeouts.{read,write,idle}Timeout=300s`; recreate traefik only. NPM custom: `proxy_connect_timeout`/`client_body_timeout` 300s + keep buffering off. Verified entrypoints API `readTimeout: 5m0s`; health/landing/OPTIONS media 200/200/204.
- **Backup:** NPM conf `${CONF}.bak-20260803-1908-inc090`; compose rsync via `prod-deploy.sh --skip-backup compose`.
- **Verify:** hard-refresh → re-upload video; expect POST to complete (200) in saas-api; NPM status not 499 before ~5m.

### INC-089 — Gift media upload 499: NPM request buffering + portal 180s timeout
- **Симптом (после INC-088):** POST `api.getvoxly.ru/api/bots/…/media` → **499** ~189s; saas-api получил только OPTIONS (zero POST); progress UI шёл, затем abort.
- **Причина:** (1) NPM `proxy_request_buffering on` — тело буферится во временный файл до проксирования в API; (2) portal XHR `DEFAULT_TIMEOUT_MS = 180_000` → client abort совпал с wall clock ~189s. INC-088 path (direct API) + 300s proxy timeouts были ок, buffering оставался.
- **Фикс:** NPM `/opt/automation/npm_data/nginx/custom/server_proxy.conf` → `proxy_request_buffering off;` (keep `client_max_body_size 64m`, `proxy_*_timeout 300s`); portal `DEFAULT_TIMEOUT_MS = 300_000`; nginx `-t` + reload (no volume wipe).
- **Deploy:** backup `/opt/voxly/backups/20260803-155457/`; `saas-portal` only; nginx conf bak `server_proxy.conf.bak-20260803-185446`.
- **Verify:** nginx conf shows buffering `off`; smoke landing/health 200; OPTIONS media 204. User: hard-refresh → re-upload; saas-api should see POST before finish.
- **Дата:** 2026-08-03.

### INC-088 — Gift promo/post media upload abort (rewrite 500 + document kind)
- **Симптом:** на `/dashboard/bots/:id` блок «Пост в канале» видео грузится с прогрессом и обрывается; file_id не сохраняется. То же для фото/файлов в рассылках.
- **Evidence (NPM access):** клиент YaBrowser `POST getvoxly.ru/api/bots/cms3bdwkj…/media` → **500** (~36–91с); после INC-086 Mac → `api.getvoxly.ru` **499** (client abort во время Telegram staging). Broadcasts всё ещё слали multipart через Next rewrite.
- **Причина:** (1) длинный upload через portal rewrite; (2) `sendVideo→document` fallback оставлял `mediaType: video`; (3) promo/publish/funnel не умели `document` / `sendDocument`; (4) NPM `proxy_read_timeout` 90s мало для staging в Telegram.
- **Фикс:** harden `uploadBotMedia` (never relative on prod); broadcasts → XHR direct API + progress; shared `detectStoredMediaKind` + `document` в schema/publish/worker; trust Telegram extracted kind; NPM custom `server_proxy.conf` timeouts 300s / body 64m; promo clears preview on error.
- **Deploy:** backup `/opt/voxly/backups/20260803-153618/`; `saas-api,saas-portal,gift-bot-worker`; smoke 200; OPTIONS media 204.
- **Verify:** hard-refresh bot page → MP4/фото/PDF ≤48МБ → progress → «Файл в Telegram» → Save/Publish.
- **Follow-up:** INC-089 — buffering still `on` + client 180s timeout → 499 without POST reaching saas-api.
- **Дата:** 2026-08-03.

### INC-087 — Admin `/admin/pricing` не сохраняет 0 ₽ для клиента
- **Симптом:** в «Индивидуальные цены» ставят `0` (бесплатно) → «Сохранить для клиента» не применяет override; остаётся «платформа».
- **Причина:** UI (`n < 1`) и API (`PRICE_MIN_RUB = 1` / zod `.min(1)`) запрещали 0; ошибка «от 1 ₽» уходила в Alert наверху страницы.
- **Фикс:** tenant overrides `0…1_000_000`; platform defaults остаются `≥1`; CRM tenant PUT + `crm-tenant-pricing` тоже `≥0`; checkout при `netAmount === 0` fulfills без Robokassa (free list price или баланс).
- **Verify:** `/admin/pricing` → клиент → CRM база `0` → Save → badge `custom`, «сейчас 0 ₽»; typecheck saas-api + saas-portal.
- **Дата:** 2026-08-03.

### INC-086 — CRM «Сделки» kanban blank (gesha) — Redis flat-map cache
- **Симптом:** `gesha-crm` → Сделки: шапка/«Канбан · 6» живы, область доски белая (0 колонок). Данные в PG есть (6 opportunity, 6 viewGroup, type=KANBAN).
- **Причина:** битый/протухший Redis flat-map cache workspace (`engine:workspace:flat-maps:*:005bad75-…`). UI монтирует `record-board`, но колонки не гидратятся.
- **Фикс:** `redis-cli` DEL keys `*005bad75*` (+ bump `core.workspace.metadataVersion`); hard-refresh CRM.
- **Verify:** board показывает «Новый лид / Screening / …» + карточки.
- **Prevention:** after SQL view/group fixes always flush workspace Redis flat-maps; if blank board + good SQL → flush first.
- **Дата:** 2026-08-03.

### INC-085 — Partners copy «Зачесть партнёрский баланс» but AI/gift checkout had no opt-in
- **Симптом:** `/dashboard/partners` блок «Оплатить свой счёт» обещает checkbox на шаге оплаты для CRM/мест/AI; пользователь не видит/не может зачесть баланс (кроме скрытого CRM-only UI).
- **Причина:** API `applyBalanceRub` + CRM checkbox существовали; CTA вёл на `/dashboard/crm` без `#oplata`; AI/gift/agent pay кнопки звали `startCheckout` без `applyBalanceRub` и без UI. Full-cover redirect всегда `/dashboard/crm?paid=ok`.
- **Фикс:** shared `PartnerBalanceApply` + `usePartnerBalanceApply`; CRM refactor; AI TG/GramJS/WA/agents + gift list/detail; partners CTA → `#oplata`; product-aware balance-only redirect.
- **Follow-up (same day):** mailing banner + `ai_topup` opt-in; mailing 402/`?pay=1` no longer silent-checkout when free balance > 0; partners copy = any own Voxly services; withdrawal min verified 1000 ₽ (`REFERRAL_WITHDRAWAL_MIN_RUB`).
- **Verify:** typecheck saas-portal + saas-api; local smoke: balance > 0 → checkbox on CRM `#oplata`, AI, gift, mailing, AI topup; opt-in off by default.
- **Дата:** 2026-08-03.

### INC-084 — Admin purge tenant fails for referral partners (`john`)
- **Симптом:** `/admin/crm` → Удалить `john` — UI не убирает портал; CRM workspace уже стёрт, control `Tenant` остаётся. AuditLog `purge_tenant` пишется несколько раз.
- **Причина:** `Referral.referrerTenantId` → `Tenant` был `ON DELETE RESTRICT`. `john` — реферер `johntest` → `DELETE Tenant` падает после hard-drop Twenty + audit.
- **Фикс:** `purge-tenant` `referral.deleteMany({ referrerTenantId })` перед `tenant.delete`; Prisma/migration → `ON DELETE CASCADE` на referrer FK.
- **Verify:** purge `john` → нет в `Tenant`, нет workspace `657134a2-…`.
- **Дата:** 2026-08-03.

### INC-083 — Robokassa live ResultURL «Invalid signature» (Password#2)
- **Симптом:** после реальной оплаты SuccessURL → `/dashboard/crm?paid=ok`, но `Payment` остаётся `pending`; в логах `Invalid Robokassa signature` на `POST /api/billing/result` (InvId 1025, gesha, 5 ₽).
- **Диагноз:** SuccessURL Signature (Password#1) совпадает с `.env` P1 `z1y5…`; ResultURL от Robokassa **не** совпадает с `.env` P2 `fvOG…`. Self-test Result с подписью от нашего P2 → `OK1025` (код верификации ок). Значит в ЛК Robokassa Password#2 ≠ значение в `/opt/voxly/.env`.
- **Mitigation:** вручную доставлен InvId 1025 (signed Result self-test) → gesha `crm_base` active до 2026-09-09; Result fail log расширен (`outSum`, `shpKeys`, `sigPref`).
- **Next:** скопировать **актуальный Password#2** из ЛК Robokassa → `/opt/voxly/.env` → recreate `saas-api`; новый живой платёж должен дать Result `OK{InvId}` без ручной доставки.
- **Дата:** 2026-08-02.

### INC-082 — Robokassa live → error 29 (Signature)
- **Симптом:** после `ROBOKASSA_IS_TEST=0` + live Password#1/#2 checkout → «Код ошибки: 29 / Оплата счетов недоступна».
- **Диагноз:** тот же код + **тестовые** Password#1/#2 + `IsTest=1` открывает pay UI. Live-пароли со скриншота совпадают с `.env`, но Robokassa отклоняет Signature в боевом режиме. OTP не при чём.
- **Mitigation:** вернули test passwords + `IS_TEST=1` из `.env.bak.20260802-203443`, recreate `saas-api`.
- **Next:** перегенерировать/сохранить боевые Password#1/#2 в ЛК (или подтвердить активацию магазина), обновить `.env`, `IS_TEST=0`, recreate saas-api.
- **Дата:** 2026-08-02.

### INC-081 — «Канбан» показывает список (TABLE)
- **Симптом:** johntest Сделки — picker «Канбан», UI таблица; viewId INDEX.
- **Причина:** `ensureOpportunityRuDefaults` переименовывал INDEX в «Канбан» + icon, **не** ставил `type=KANBAN` / `mainGroupByFieldMetadataId`. GraphQL convert не сработал; SQL с `fm.deletedAt` падал (`fieldMetadata` без soft-delete).
- **Фикс:** SQL конвертит INDEX TABLE→KANBAN + stage groupBy + seed 6 `viewGroup`; `view.applicationId` для insert; убран `fm.deletedAt`. johntest починен вручную + flush Redis view cache. Deploy `saas-api`.
- **Verify:** INDEX `Канбан` type=KANBAN, 6 groups; hard-refresh `johntest-crm` → колонки этапов.
- **Дата:** 2026-08-02.

### INC-080 — `/install-apps` после провижининга CRM
- **Симптом:** после создания workspace первый заход на `{slug}-crm` показывает «Установите свои первые приложения» (`/install-apps`).
- **Причина:** signup пишет `ONBOARDING_*_PENDING` в `core.keyValuePair`; GraphQL `triggerInstallAppsOnboardingStep([])` только claim’ит `INSTALL_APPS` и может **опередить** запись флагов (silent catch). SPA остаётся на `/install-apps` даже после `onboardingStatus=COMPLETED`.
- **Фикс:** `clearTwentyOnboardingFlags(workspaceId)` (SQL DELETE install-apps/sync-email/invite/connect — **не** CREATE_PROFILE) early + after chat install в `queues.ts`; `syncOwnerProfileFromControlDb` для уже созданных порталов с пустым ФИО.
- **Регрессия (voxly 2026-08-04):** ранний фикс удалял `ONBOARDING_CREATE_PROFILE_PENDING` → экран ФИО пропускался; исправлено.
- **Verify:** install-apps keys=0; CREATE_PROFILE остаётся до ввода ФИО (или backfill из control User); hard-refresh CRM.
- **Дата:** 2026-08-02 (amend 2026-08-04).

### INC-077 — Twenty: 6-й workspace blocked («enterprise key»)
- **Симптом:** новый тенант (`johntest`) — подписка active, UI «CRM создаётся…», `twentyWorkspaceId` NULL. `johntest-crm.getvoxly.ru` 200 без workspace.
- **Причина:** Twenty v2.22 `assertWorkspaceCountWithinLimit` — без `ENTERPRISE_KEY` макс. **5** workspace (`MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY`). Job: `Cannot create more than 5 workspaces without a valid enterprise key`.
- **Фикс:** `docker/patch-twenty-workspace-limit.cjs` → лимит **100000**; wired в `twenty.Dockerfile` + `prod-deploy.sh`. Deploy `twenty`. Re-enqueue `provision-workspace` для johntest → workspace `d8c9bf10-…` ACTIVE.
- **Verify:** 6 workspaces в `core.workspace`; tenant `johntest` has `twentyWorkspaceId`; hard-refresh `/dashboard/crm`.
- **Дата:** 2026-08-02.

### INC-076 — `/r/{CODE}` referral short links 404
- **Симптом:** `https://getvoxly.ru/r/JOHNA130` (и коды кампаний) → Next.js 404. `/register?ref=` и `GET /api/referrals/click/:code` работали.
- **Причина:** UI строил `https://{domain}/r/{code}`, но в portal не было маршрута `/r/[code]` — только API-редирект клика.
- **Фикс:** `apps/saas-portal/src/app/r/[code]/route.ts` — best-effort click через API, затем 302 на `/register?ref=`. Deploy `saas-portal`.
- **Verify:** `curl -sI https://getvoxly.ru/r/JOHNA130` → 302 → `/register?ref=JOHNA130`.
- **Дата:** 2026-08-02.

### INC-072 — CRM Chat author «Менеджер» + sidebar «john» vs Тест2
- **Симптом:** (1) top-left CRM shows pink «J» + «john» while logged in as `test2@voxly.ru` (profile «Тест2 ФИОтест2»); (2) Chat outbound bubble labeled «Менеджер» instead of «Тест2».
- **Причина:** (1) Twenty `MultiWorkspaceDropdown` = workspace `displayName` (= slug `john`), **not** current user — session is correct (`createdBy` = Тест2). (2) Chat `/s/*` proxy uses `VOXLY_SERVICE_TOKEN` → `sub=twenty-app`; saas-api `formatOperatorName` fell back to «Менеджер» (Voxly User names for invitees often empty; Twenty member names ignored).
- **Фикс:** forward `X-Twenty-User-Workspace-Id` from logic functions; `resolveTwentyOperatorLabel` → workspaceMember name; shell-ux «CRM · {slug}» + chip «Вы: {member}»; crm-chat **0.1.23**.
- **Verify:** hard-refresh john-crm as test2 → sidebar «CRM · john» + «Вы: Тест2…»; Chat reply → bubble «Тест2…» (not «Менеджер»).
- **Дата:** 2026-07-30.

### INC-073 — Delete CRM member → «Не удалось удалить пользователя из CRM»
- **Симптом:** `/dashboard/crm` Delete → 502 friendly error; member stays.
- **Причина:** `deleteUserFromWorkspace` arg typed as `UUID!` but Twenty metadata expects `String!`.
- **Фикс:** GraphQL var → `String!` in `@voxly/twenty-client`.
- **Verify:** Delete test2/test3 on john → 200; gone from CRM + portal list.
- **Дата:** 2026-07-30.

### INC-074 — WA: кошелёк AI обнулился в диалоге → AI продолжает отвечать
- **Симптом:** баланс AI дошёл до 0 посреди диалога; в Telegram клиент получает предупреждение и уходит на оператора, в WhatsApp AI отвечает как обычно. Диалог остаётся `mode=ai`, оператор его не видит как ожидающий; стоп срабатывал только на **следующем** входящем — pre-flight `hasAiBalance(tenantId, 1)` (`apps/ai-whatsapp-worker/src/index.ts` flushWhatsAppAiReply).
- **Причина:** `chargeAiUsage` возвращает `paused` (кошелёк исчерпан), но WA-воркер использовал `chargeResult` только для полей `ChatMessage` — ветки `paused` не было (в TG есть: `chargeResult.paused` → `switchToHuman`). Плюс сам pre-flight gate только отправлял текст про баланс и **не** переводил диалог на человека.
- **Фикс:** WA-воркер: `switchToHuman(instanceName, from, tenantId, botId, conversationId)` (`mode='human'`, `status='waiting_for_human'` + `fireGoal('human_handoff')`) — зеркало TG; вызывается после `paused` (с уведомлением про исчерпанный баланс) и на pre-flight gate.
- **Verify:** обнулить кошелёк тенанта → написать в WA → после ответа AI приходят «Баланс … исчерпан … Переключаю на оператора.» + «Режим оператора. Ожидайте ответа.»; `Conversation.mode=human`, `status=waiting_for_human`; следующее входящее AI не отвечает (`shouldAiReply` → false).
- **Дата:** 2026-07-31.

### INC-075 — Параллельные списания AI теряли деньги (lost update)
- **Симптом:** сумма `AiUsageLog.chargedRub` за период больше, чем реально списано с `AiWallet`; при медиа-сообщениях (ASR/vision летят как detached promises рядом со списанием за ответ) баланс уменьшался на одно списание вместо двух-трёх.
- **Причина:** `chargeAiUsage` (`packages/ai-core/src/index.ts`) делал read-modify-write абсолютного значения (`balanceRub: Math.max(0, currentBalance - chargedRub)`) внутри Read Committed транзакции — обе параллельные транзакции читали один и тот же старый баланс, побеждала последняя запись. Плюс `Math.max(0, …)` молча списывал недобор, а `chargedRub` в логе оставался полным → маржа в админке и трата за 30 дней завышались.
- **Фикс:** атомарный условный декремент `aiWallet.updateMany({ where: { tenantId, balanceRub: { gte: chargedRub } }, data: { balanceRub: { decrement } } })` (как в `admin-referrals.ts` для выплат партнёрам); при `count === 0` — `SELECT … FOR UPDATE`, собираем остаток, обнуляем кошелёк, пишем недобор в новую колонку `AiUsageLog.uncollectedRub` и возвращаем `paused: true`.
- **Verify:** запустить два списания на один тенант одновременно → баланс уменьшается на сумму обоих; при нехватке средств кошелёк = 0, в логе `uncollectedRub > 0`, `paused = true`.
- **Дата:** 2026-07-31.

### INC-076 — Повторная доставка Robokassa ResultURL начисляла всё дважды
- **Симптом:** потенциально дубли `Subscription`, двойной топап `AiWallet`, двойные `ReferralEarning` + `TenantBalance` по одному `InvId`.
- **Причина:** `apps/saas-api/src/routes/billing.ts` проверял `existing.status === 'paid'` **до** транзакции (stale read), а внутри делал безусловный `payment.update` по id. Robokassa ретраит до ответа `OK{InvId}`, поэтому две доставки могли пройти проверку одновременно.
- **Фикс:** условный claim внутри транзакции — `payment.updateMany({ where: { id, status: 'pending' }, data: { status: 'paid', paidAt } })`; при `count === 0` транзакция возвращает `false`, эффекты не применяются, но ответ остаётся `OK{InvId}` (иначе Robokassa продолжит ретраить). DB-бэкстоп: `@@unique([paymentId])` на `ReferralEarning`.
- **Verify:** отправить один и тот же подписанный ResultURL дважды подряд → второй отвечает `OK{InvId}`, в логе `Payment already claimed by another delivery`, новых `Subscription` / `ReferralEarning` / изменений баланса нет.
- **Дата:** 2026-07-31.

### INC-077 — `productScope` / `durationMonths` в `ReferralRule` не читались при начислении
- **Симптом:** супер-админ в `/admin/partners` выбирает «С каких оплат начисляем» и «Начислять, мес.», UI пишет «первые N мес.», но начисления идут 20% со **всех** оплат (кроме `ai_topup`) и **бесконечно** — прямая переплата партнёрам против явной настройки. В prod хранилось `productScope='subscriptions'` — значение, которого нет ни в комментарии схемы (`// all, crm`), ни в коде начисления.
- **Причина:** `creditReferralForPayment` (`apps/saas-api/src/routes/billing.ts`) читал только `rule.type` / `rule.value`; `productScope` валидировался как свободная строка (`z.string()`), сохранялся и отдавался обратно на экран, но нигде не сравнивался с `payment.productCode`. Ветка `percent_recurring` не сверялась с `Referral.firstPaymentAt`. Персональное правило (`PUT /partners/:tenantId/rule`) вообще хардкодило `productScope: 'all'`.
- **Фикс:** словарь `REFERRAL_PRODUCT_SCOPES` (`all` | `crm`) + `isProductInReferralScope` / `normalizeReferralProductScope` в `packages/shared`; guard по скоупу **сразу после** `REFERRAL_EXCLUDED_PRODUCTS` (AI-топап исключён всегда, независимо от скоупа); окно `durationMonths` от `Referral.firstPaymentAt`; `z.enum` на границе API + приём `productScope` в персональном правиле; миграция `20260731180000_referral_rule_product_scope` нормализует legacy `'subscriptions'` → `'all'`, чтобы включение проверки **не сузило** выплаты.
- **Verify:** правило `percent_recurring` 20% + «Начислять, 6 мес.» → оплата клиента через >6 мес. после его первой оплаты не создаёт `ReferralEarning`; скоуп «Только CRM» → `ReferralEarning` только на `crm_base` / `extra_seat`; `ai_topup` не начисляет ни при каком скоупе; `PUT /api/admin/referrals/rule` с `productScope: 'subscriptions'` → 400.
- **Дата:** 2026-07-31.

### INC-078 — Расход AI нельзя было разложить по каналам (`addonId` почти всегда пустой)
- **Симптом:** тенант видит общую сумму списаний за 30 дней, но не может ответить «сколько съедает WhatsApp против Telegram». Разбивка была только по `aiAgentId`, а один агент обслуживает несколько каналов (ADR-014), так что по ней канал не восстанавливается.
- **Причина:** единственный намёк на канал в `AiUsageLog` — `addonId`, и его передавал **один** call-site из десяти (`ai-whatsapp-worker` текстовый ответ). Остальные девять (ASR/vision в TG/WA, текст TG Business и GramJS, gift-бот, эмбеддинги RAG) писали лог без какой-либо привязки к каналу → любая агрегация по `addonId` дала бы почти пустую таблицу.
- **Фикс:** словарь `AI_USAGE_CHANNELS` + `aiUsageChannelLabel` в `packages/shared`; nullable колонка `AiUsageLog.channel` + индекс `(tenantId, channel, createdAt)` (миграция `20260731190000_ai_usage_channel`); `channel` в `ChargeAiUsageParams` и во всех десяти call-site; `byChannel[]` в `GET /api/ai/agents/usage` рядом с существующим `byAgent[]`; блок «Куда ушли деньги — по каналам» в `/dashboard/ai`.
- **Verify:** написать в WhatsApp и в Telegram Business → в `/dashboard/ai` §02 два канала с суммами; голосовое в WA даёт отдельное списание в том же канале; загрузка файла в базу знаний попадает в «База знаний и обучение».
- **Осторожно:** строки до миграции остаются `channel = null` и показываются как «Не определён» — бэкфилла нет и быть не может, канал в старых строках не восстановим.
- **Дата:** 2026-07-31.

### INC-071 — CRM portal Edit/Delete member → Bad Request
- **Симптом:** `/dashboard/crm` «Редактировать» / «Удалить» → `Bad Request` (400).
- **Причина:** portal `authHeaders()` всегда шлёт `Content-Type: application/json`, а DELETE и `POST .../reissue-credentials` без body → Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`.
- **Фикс:** saas-api JSON parser treats empty body as `{}`; (invite still provisions Twenty).
- **Verify:** Edit + Delete on member → 200; Edit returns new password modal.
- **Дата:** 2026-07-30.

### INC-070 — CRM side-panel «Чат» tab missing (app uninstalled)
- **Симптом:** john-crm сделка/контакт: вкладки Главная / Временная шкала / +Ещё, **нет «Чат»**. Unread badge «N» на карточке остаётся (shell-ux). Не путать с кабинетным nav.
- **Причина:** `voxly-crm-chat` **не установлен** в Twenty (`core.application` / `applicationRegistration` пусты) → нет `pageLayoutTab` «Чат» на Opportunity/Person. Типичный триггер: `refreshCrmChatAppForTenant` делает DELETE registration + `forceReinstall` (uninstall → cascade tabs) **до** успешного install; при **ENOSPC** / сбое upload-install вкладка исчезает, а shell-ux badges живут отдельно. После mailing **0.1.22** на prod был ENOSPC во время refresh.
- **Диагностика:** `SELECT name FROM core.application WHERE "universalIdentifier"='b5c92442-…'`; `pageLayoutTab` title=`Чат`; metadata `getPageLayouts` tabs; `GET /rest/front-components/:id` → JS bundle.
- **Фикс:** `POST /api/admin/tenants/:id/refresh-crm-chat` (body `{}`) на все tenants после свободного места на диске; flush Redis `flatPageLayout*`; bump `workspace.metadataVersion`. Tarball уже **0.1.22** в saas-api — отдельный twenty rebuild не нужен.
- **Verify:** metadata `getPageLayouts` Opportunity/Person → tab «Чат» position 15; REST front-component **200**; hard-refresh john-crm → open deal → «Чат» visible + messages.
- **Дата:** 2026-07-27.

### INC-069 — CRM Chat empty («нет данных») after mailing receipts schema
- **Симптом:** john-crm вкладка «Чат» пустая на WA / Business WA / GramJS при живых Conversation+ChatMessage+AI; API выглядел «без данных».
- **Причина:** в Prisma/`ChatMessage` появились `deliveryStatus`/`deliveredAt`/`readAt` (миграция `20260727020000_mailing_broadcast_receipts` для mailing receipts), saas-api задеплоили с новым client, **колонок на prod control PG не было** → `chatMessage.findMany` **P2022** → GET `/api/crm/chat/:recordId` **500**. UI (RestApiClient) показывает пусто/ошибку. Не баг `listCrmChatTargets` / soft-delete ids.
- **Фикс:** backup + `ALTER` + `BroadcastRecipient` + запись в `_prisma_migrations`. Дополнительно (AI): refusal retry + near-duplicate skip + burst focus (workers).
- **Verify:** GET Person/Opportunity john → 200 + msgs>0 (WA 37/63, GramJS 51); hard-refresh Chat tab.
- **Дата:** 2026-07-27.

### INC-068 — Personal WA voice after CRM wipe: no Person/Opportunity
- **Симптом:** после wipe / clear stale ids на `+79150946944` голосовое с личного WA → сделки нет (Business WA ASR+сделка ок).
- **Причина:** (1) после INC-067 clear CRM ids **не было реального inbound** с `+7915` до recreate (Evolution: только LID `79855…` media). (2) WA `syncLeadToCrm` шёл **после** `enrichWaTextWithMediaAi` — при hang/fail ASR lead не создавался вовремя; TG media тоже ASR→sync.
- **Фикс:** WA: ChatMessage placeholder → **await syncLeadToCrm** → ASR/vision/doc enrich + update content; TG media: ensureConversation+sync **до** `extractInboundText`; success/empty CRM logs.
- **Verify:** wipe CRM ids on `+7915` → send voice → Person+Opportunity + `[голос]/` / `[голосовое]`; Business WA / TG text unchanged.
- **Дата:** 2026-07-27.

### INC-067 — WA video ASR OK but AI refuses; PDF/DOCX CRM download broken; typing stuck; personal WA no deal after wipe
- **Симптом:** Business WA («ремонт тоя»): video/кружочек → AI «не могу просмотреть/прослушать»; PDF/DOCX AI читает, но скачать в CRM «Чат» нельзя; «Печатает» залипает / ответы висят; обычный WA (+7915…) после wipe — сделки нет.
- **Причина:** (1) ASR уже писал `[видео]:` / `[кружочек]:` в ChatMessage, но история few-shot'ила старые отказы «не могу просмотреть» + слабый MEDIA hint. (2) Документы шли через `/file`→base64 в Twenty `/s` (~96KB cap) — PDF/DOCX не влезают; photo/audio ок. (3) `sendPresence(composing)` без `paused` на abort/error; TG Business GET chat слал `typing` на каждый poll. (4) Conversation `+7915` держал soft-deleted Opportunity + мёртвый Person id; после wipe inbound с этого номера не было в логах до фикса.
- **Фикс:** `filterMediaCapabilityRefusals` + усиленный `MEDIA_INBOUND_HINT`; CRM documents → signed URL (crm-chat **0.1.20**); `Content-Disposition: attachment` для docs; `clearWhatsAppTyping(paused)`; убран typing с CRM GET (TG); await `syncLeadToCrm`; cleared stale IDs на `79150946944`.
- **Verify:** Business WA video/кружочек → AI отвечает по transcript; PDF/DOCX «Скачать» в CRM; typing clears after reply; personal WA (+7915) video/text → new Person+Opportunity.
- **Дата:** 2026-07-26 / 2026-07-27.

### INC-066 — WA Business off-topic AI + regular WA silent / no Opportunity
- **Симптом:** (1) WhatsApp (business-profile peer) — AI «не впопад» vs TG с тем же агентом. (2) «Обычный» WA — нет ответа и/или сделки.
- **Причина:** (1) `filterHistoryAfterAgentUpdate` оставлял *все* user-сообщения до смены промпта без старых assistant → длинный WA-тред (оскорбления / старая персона) few-shot'ил мусор; MEDIA hint слабо запрещал «не могу обработать видео». (2) `resolveDefaultOpportunityStage` GraphQL `filter: { nameSingular }` → Twenty ObjectFilter 400 → fallback `NEW` → createOpportunity падает на RU стадиях (INC-055). (3) Closed LID-тред с фейковым `platformUsername=+20034505` (INC-060) — новый inbound мог не попасть в живой CRM-тред; AI off на `status=closed`.
- **Фикс:** metadata objects без filter + pick `opportunity` client-side; fallback stage `''` (omit), не `NEW`; history cut **всех** ролей до `agent.updatedAt`; stronger `MEDIA_INBOUND_HINT`; WA reopen closed peer/phone threads + clear bogus username.
- **Verify:** worker log no `nameSingular is not defined`; `resolveDefault` → `NOVYY_LID` (or workspace value); personal/LID inbound → reopen or one Person+Opportunity + AI reply; after agent prompt edit WA answers match TG echo style without old-thread pollution.
- **Дата:** 2026-07-26.

### INC-063 — GramJS / WA / TG Business media missing in CRM chat
- **Симптом:** фото/видео/стикер/кружочек приходят в Telegram/WA, в CRM «Чат» нет превью (или сообщение не появляется); AI не «видит» медиа. **Reopen 2026-07-26 вечер:** видео = чёрный HTML5 player 0:00; кружочек = только текст `[кружочек]`; AI не понимает video_note. **Reopen 2026-07-26 ~22:16:** кружочек = только «Кружочек · скачать» (нет `<video>`); AI «Секунду…» / эхо ASR без полезного ответа. **Reopen 2026-07-26 ~22:30:** кружочек OK; **обычное видео** — AI не расшифровывает (placeholder-only). **Reopen 2026-07-26 ~22:45 user smoke:** кружочек/аудио/фото OK; обычное видео — AI отвечает «Это видео.» (игнор ASR); PDF/DOCX — только `[файл: name]`, AI не читает. **Reopen 2026-07-26 ~23:05:** parity — gift inbound missed `video_note` + no ASR/vision/docs enrich for CRM.
- **Причина:** (1)–(8) как раньше. **(9)** После regular-video ASR ship: Whisper часто **уже** писал `[видео]: transcript` (~600KB TG Business), но LLM few-shot из старых `[видео]` → «Это видео.»; caps **8MB/90s** + raw-mp4 Whisper без ffmpeg — хрупко на реальных роликах; PDF/DOCX inbound = placeholder only (extract был только в knowledge upload). **(10)** Gift funnel only stored bare placeholders; `video_note` not in inbound message filter.
- **Фикс:** inbound media + signed URL (0.1.11); **0.1.13:** MIME sniff + Range; **0.1.15 / API:** `maxParamLength: 8192` + route `/media/*`; video_note ASR; **Regular video ASR v2:** caps **20MB / 180s**, **ffmpeg** audio demux → Whisper; **MEDIA_INBOUND_HINT**; **PDF/DOCX** extract on TG Business / GramJS / WA; **Gift:** `enrichGiftInboundMedia` + `video_note` inbound + OPENROUTER/ffmpeg in gift-bot compose/image (CRM text parity; no sales LLM).
- **Дата:** 2026-07-26 (reopen size-cap + evening playback/mime + night maxParamLength + video ASR + doc extract / LLM hint + gift parity).

### INC-065 — Unread badges duplicated on cards + not clearing after Chat open
- **Симптом:** на карточке сделки/контакта красный счётчик «N» несколько раз (title + date + person chip / имя + «Электронные письма»); после открытия вкладки «Чат» бейджи не сбрасываются.
- **Причина:** (1) `twenty-shell-ux` `paintUnreadBadges` вешал badge на board-host **и** на каждый `a[href*="/object/person|opportunity/"]` внутри карточки (отдельные ключи `painted[rid]` vs `painted['link:'+id]`), плюс person-chip с тем же count. (2) `GET /api/crm/chat/:recordId` обновлял `lastOperatorReadAt` только у **активного** `conversationId`, тогда как unread-badges суммирует все треды Person/Opportunity (WA+TG+gift).
- **Фикс:** shell — один badge на card root (title field); не красить links внутри board card. API — `updateMany` всех `conversationId` из `listCrmChatTargets`; await. Optimistic clear пока открыт Chat canvas.
- **Дата:** 2026-07-26.

### INC-064 — AI agent system prompt edit ignored in chat
- **Симптом:** в `/dashboard/ai/agents` сохранили новый system prompt, в UI он виден, но ответы в TG/WA/GramJS продолжают старую персону.
- **Причина:** workers уже читали `AiAgent` из DB на каждый flush, но ~20 предыдущих `assistant` ChatMessage few-shot'или старый стиль и перекрывали новый system prompt. Дополнительно resolve шёл через Prisma relation include (менее явно, чем fresh `findFirst` by id).
- **Фикс:** `resolveAssignedAgent` → fresh `aiAgent.findFirst` by id + `updatedAt`; `filterHistoryAfterAgentUpdate` дропает **все** сообщения (user+assistant) до `agent.updatedAt` (INC-066: orphan user lines тоже путали модель); `AGENT_PROMPT_PRIORITY_HINT`; fallback `settings.systemPrompt`.
- **Дата:** 2026-07-26 (amended INC-066).

### INC-062 — WA business email blocked by Twenty soft-delete unique
- **Симптом:** business profile отдаёт `anton@…`, сайт заполняется, email на новом Person пустой; Instagram/Facebook пустые.
- **Причина:** (1) `emailsPrimaryEmail` UNIQUE включает soft-deleted — после удаления контакта email остаётся в корзине. (2) Evolution/Baileys `fetchBusinessProfile` для этого peer **не возвращает** Instagram/Facebook (только website/email/address) — Meta linked accounts не в WA Web API.
- **Фикс:** `releaseSoftDeletedPersonEmail` via `TWENTY_DATABASE_URL` before retry `updatePersonEmail`; worker compose gets Twenty DB URL; IG/FB only when URLs appear in website/description.
- **Дата:** 2026-07-26.

### INC-061 — WA no CRM lead after wipe + parallel AI storms
- **Симптом:** удалили Person/Opportunity → новое WA сообщение: сделки нет; ИИ шлёт 2×4 пузыря на паузу ~7с между сообщениями.
- **Причина:** (1) `createPerson` с `anton@…` → Twenty unique «duplicate entry» (email ещё занят / soft-delete); sync abort. (2) debounce 6с: «Привет» flush стартовал, следующее сообщение через ~7с → второй параллельный flush.
- **Фикс:** `findPersonByEmail` + reuse/name-only on duplicate; debounce default **10s** + serialize in-flight (queue mid-flight); abort checks before/after OpenRouter; `sendStartedAt` at flush start.
- **Verify:** wipe → one WA burst with 7–9с gaps → one Person+Opportunity; one AI reply series; log no parallel `human gap` pairs.
- **Дата:** 2026-07-26.

### INC-060 — WA creates 2 deals + 2 contacts for one message
- **Симптом:** одно входящее WA → сделки `+20034505 · WA · …` (контакт «WhatsApp») и `Антон · WA · …` (телефон `+7985…`) одновременно.
- **Причина:** Evolution шлёт twin webhook (`7985…@s.whatsapp.net` + `…@lid`). Для LID `extractPhoneFromEvoRow` брал Contact **`id` (CUID)** `cmrxq2epw003jt45it0gun5tz` → digits `20034505` (проходило `isLikelyE164Phone` min=8) → второй Person/Opportunity. Разные `platformUserId` (PN vs LID) → два Conversation.
- **Фикс:** не читать `row.id` как телефон; E.164 min length **10**; skip duplicate `externalMessageId` (twin) + enrich phone; merge open threads by E.164; prefer phone as `platformUserId` when known.
- **Verify:** wipe deals/contacts → one WA msg → one Person + one Opportunity; worker log `skip duplicate webhook messageId=…` on twin; no `contact_row … +20034505`.
- **Дата:** 2026-07-26.

### INC-058 — Opportunity without Person + AI auto-pause + inbound burst
- **Симптом:** deal+contact создаются, Person не на Opportunity; после ответа из CRM AI молчит (~1h / «Вкл AI»); несколько коротких inbound → мгновенный ответ на каждое; GramJS composer едет со скроллом; WA без синих галочек.
- **Причина:** `createOpportunity` мог успеть без connect; auto-`pausedUntil` на CRM/human outbound; нет debounce; shell-ux искал только «Ответ в Telegram»+Прикрепить; markRead один jid/id.
- **Фикс:** connect+update link; убран auto-pause; inbound debounce + bubble gaps; shell-ux «Ответ в»; multi-jid markRead.
- **Verify:** deploy workers+api+twenty shell; wipe deals → new msgs all channels.

### INC-057 — CRM Chat AI buttons missing after re-register; dashboard AI spend 0₽
- **Симптом:** чат работает, но нет Вкл/Пауза/Выкл AI; на дашборде «14 запросов / 0 ₽».
- **Причина:** (1) `uploadAppTarball` duplicate → workspace ставит старый фронт без кнопок; `installApplication` не обновляет UI без uninstall. (2) OpenRouter часто отдаёт `usage.cost:0` — мы списывали 0; `Math.round` прятал копейки.
- **Фикс:** clear registry + `forceReinstall` (uninstall→install) на provision/refresh; voxly-crm-chat **0.1.5**; cost fallthrough при cost=0; dashboard formatRub + токены.
- **Дата:** 2026-07-26.

### INC-056 — Business AI visible in CRM but not in Telegram
- **Симптом:** в CRM чате есть ответ «Бот», в Telegram Business-чат клиенту ничего не пришло. GramJS/WA ок.
- **Причина:** `getBusinessConnection.can_reply=false` — Telegram отклоняет `sendMessage` от Business-бота; ранее ответ всё равно писался в ChatMessage как успешный.
- **Фикс:** ai-telegram-worker pre-check `can_reply`; при false — registry `limited` + предупреждение в CRM, без генерации/отправки; после send — persist с ⚠️ если fail; generateAiBubbles `persist:false` до доставки.
- **Клиент:** Telegram → Настройки → Business → Чат-боты → включить «Отвечать на сообщения» для бота → написать ещё раз.
- **См.:** INC-054.
- **Дата:** 2026-07-26.

### INC-055 — No Opportunity (stage NEW invalid) + WA wrong deal + empty Business chat
- **Симптом:** toast OK; Person may exist; Opportunity not created (`stage: NEW` rejected — workspace has `NOVYY_LID`…); CRM chat empty for new Business peer; WA «другой номер» via LID→pushName прилип к чужой сделке; дубль WhatsApp chips; AI silent (`mode=human`).
- **Причина:** (1) `createOpportunity({ stage:'NEW' })` throws after RU stage rename; sync aborts before linking Conversation. (2) CRM thread dedupe `biz:bot:connection` collapsed all Business peers into one chip. (3) LID→phone by unique pushName false-positive. (4) stuck `mode=human`.
- **Фикс:** twenty-client `resolveDefaultOpportunityStage()` по seed option id `20202020-8e01-4afd-9c39-d2063097587a` (+ retry по Valid values); biz dedupe includes peer id; drop pushName LID map; CRM AI enable/pause/disable (voxly-crm-chat 0.1.4); backfill DanMSK opp; unlink wrong WA LID.
- **Дата:** 2026-07-25 / 2026-07-26 (option id).

### INC-054 — CRM reply BUSINESS_PEER_INVALID (Business can_reply=false)
- **Симптом:** ответ из CRM «Telegram · Business-бот» → `Bad Request: BUSINESS_PEER_INVALID`.
- **Причина:** `getBusinessConnection` → `can_reply:false`, `rights:{}`; registry row `telegram_business_account` status=`limited`. Telegram не даёт боту писать от имени Business без права «Отвечать на сообщения».
- **Фикс (код):** crm-chat pre-check registry + live `getBusinessConnection`; humanize RU; worker stores peer from `chat.*` on owner outbound (not owner `from.*`).
- **Фикс (пользователь):** Telegram → Business → Чат-боты → @voxly_AI_Agent_bot → включить ответ/чтение; клиент пишет снова; затем ответ из CRM.
- **Дата:** 2026-07-25.

### INC-053 — AI silent after CRM / phone reply (mode=human stuck)
- **Симптом:** agent assigned + balance OK; inbound stored; log `AI off (no agent / paused)`; no reply. CRM toast missing when testing from business owner phone.
- **Причина:** (1) CRM chat + WA outbound set `Conversation.mode='human'` + `pausedUntil`; after pause expired `shouldAiReply` still false forever (`isAiConversationMode`). TG business owner outbound only set `pausedUntil` (correct). (2) Writing *as* business owner → role=operator, auto-pause, no inbound toast.
- **Фикс:** pause paths only set `pausedUntil` (keep mode ai); reset stuck john convs; deploy saas-api + ai-whatsapp-worker.
- **Verify:** customer inbound on WA after CRM reply → AI replies after pause OR immediately if pause cleared; toast for `role=user` only.
- **Дата:** 2026-07-25.
- **Prevention:** never flip `mode` to human for temporary handoff; use `pausedUntil` only. Explicit `/human` may still set mode.

### INC-052 — Prod disk full → Postgres panic mid-deploy
- **Симптом:** deploy recreate stuck; `postgres-control` unhealthy; logs `PANIC: No space left on device`; `df` 100% on `/`.
- **Причина:** ~80GB Docker images reclaimable (old builds), not volume growth.
- **Фикс:** `docker image prune -af` (~66GB) + `journalctl --vacuum-size=200M` (~3.8GB). **No** `down -v`. Restart postgres → healthy; start app containers.
- **Verify:** `df` ~27% used; api/portal 200; control PG queries OK.
- **Дата:** 2026-07-25.
- **Prevention:** prune unused images periodically; keep ≥15GB free before big rebuilds.

### INC-051 — Gift bots list 500 after saas-api deploy (missing columns)
- **Симптом:** `/dashboard/bots` → «Не удалось загрузить ботов»; `GET /api/bots` 500.
- **Причина:** Prisma schema + client уже с `BotInstance.telegramDescription` / `telegramShortDescription`, migration `20260724183000_bot_telegram_description` **не** применена на prod control PG (deploy не делает migrate).
- **Фикс:** `ALTER TABLE … ADD COLUMN IF NOT EXISTS` + запись в `_prisma_migrations`.
- **Verify:** `GET /api/bots` 200; страница ботов грузится.
- **Дата:** 2026-07-24.
- **Prevention:** after shipping Prisma fields, always run migration on prod explicitly (deploy reminder).

### INC-050 — CRM Chat: URLs not clickable + `nbsp;` garbage
- **Симптом:** в вкладке «Чат» `https://…` как обычный текст (не ссылка); между абзацами видно `nbsp;`.
- **Причина:** `formatContent` / `formatInlineMarkdown` не linkify’или URL; пустые строки рендерились как `&nbsp;`, Remote DOM мог съесть `&` → литерал `nbsp;`.
- **Фикс:** linkify `http(s)://` в text-нодах после MD; нормализация `&nbsp;`/`nbsp;`; пустые строки без entity (только `min-height`). `voxly-crm-chat` **0.1.3**; parity в `docker/twenty-deal-chat.js`.
- **Verify:** hard-refresh CRM «Чат» → URL синие/кликабельны (`target=_blank`); пустые строки без `nbsp;`.
- **Дата:** 2026-07-24.
- **Prevention:** any chat HTML renderer: linkify after escape; never rely on `&nbsp;` in Remote DOM.

### INC-049 — Gift bot creates second Opportunity for same Person
- **Симптом:** канбан New: `@toxasagmsk · AI · @voxly_AI_Agent_bot` и дубль `@toxasagmsk · den · @voxly_john_01_bot` (один контакт).
- **Причина:** gift `syncSubscriberToCRM` находил Person (`findPersonByHint` / prior gift), но **не** искал существующую Opportunity на Conversation/других gift — всегда `createOpportunity`.
- **Фикс:** reuse Opportunity by `twentyPersonId` from GiftSubscriber + Conversation (как AI worker); prod delete dupe opp + retarget gift sub.
- **Verify:** one live Opportunity for Person; new gift start on known TG user attaches same deal.
- **Дата:** 2026-07-24.
- **Prevention:** any channel sync: Person first, then Opportunity-by-Person before create.

### INC-048 — CRM Chat: no live message / missed left toast
- **Симптом:** входящее в Business/WA есть в БД и после F5 в «Чат», но пока вкладка открыта сообщение не появляется; left toast иногда нет.
- **Причина:** Remote DOM chat **без** `setInterval` (только open/send/«Обновить»). Toast poll пустыми ответами двигал `toastSince` с skew **2s** → при drift часов DB/Node сообщение могло выпасть из окна `sentAt > since`.
- **Фикс:** shell-ux кликает «Обновить» при toast на открытую карточку + soft-refresh ~4.5s пока открыт Chat canvas; skew пустого poll **15s**.
- **Verify:** hard-refresh CRM → Network `/s/crm-chat/inbound-toasts`; открыть «Чат» → inbound ≤5s в ленте без F5; toast слева снизу.
- **Дата:** 2026-07-24.
- **Prevention:** never rely on Remote DOM timers for live inbox; host shell-ux owns poll + refresh click.

### INC-047 — Business bot linked but no CRM deal / empty account list
- **Симптом:** `@voxly_AI_Agent_bot` in Business automation; portal shows only `Business-аккаунты 1/10` without names; no Opportunity; AI «выкл».
- **Причина:** (1) `business_connection` not persisted as listable registry; (2) only owner outbound «Рр» stored — `pauseOnHumanOutbound` did not call `syncLeadToCrm`; (3) Telegram `getBusinessConnection` → **`can_reply=false`, `rights={}`** so customer `business_message` never arrived; (4) no `AiAgent` assigned (`defaultAiAgentId` null = AI off by ADR-014).
- **Фикс:** registry Conversations `telegram_business_account`; API/portal list; CRM sync on outbound + Business label on Opportunity; status `limited` + UI warning when no reply rights; backfill john deal.
- **Verify:** bot page lists `@toxasagmsk` with «нет прав ответа»; CRM has Opportunity `… · Business @toxasagmsk`; after granting rights + agent assign, inbound creates/updates deal and AI can reply.
- **Дата:** 2026-07-24.
- **Prevention:** on connect, surface `can_reply`; never count registry rows as customer dialogs; agent assign is on bot (all Business accounts).

### INC-046 — AI Business bot created in Telegram but missing from portal
- **Симптом:** «Подключить бота» → создали `@voxly_AI_Agent_bot` в Telegram → кабинет john всё ещё «Пока нет AI-ботов» / dashboard BUSINESS=0.
- **Причина:** (1) `User.telegramUserId` создателя был привязан к **другому** tenant (antontest), а `BotProvisionRequest` — к **john**; (2) кастомный @username ≠ `suggestedUsername` (`voxly_john_0N_bot`); (3) matcher сначала брал linked tenant → «No pending provision»; (4) UI после клика оставлял empty-state, provision-карточка легко терялась при refresh.
- **Фикс:** `resolveProvisionForManagedBot` — username → pending linked tenant → unique pending tenant/ai_tg; `assignTelegramToTenantOwner` (unique move); portal waiting UI; replay ManagedBotUpdated → `@voxly_AI_Agent_bot` на john.
- **Verify:** john `BotInstance` ai_tg active `@voxly_AI_Agent_bot`; telegramUserId on john owner; manager log «linked to tenant».
- **Дата:** 2026-07-24.
- **Prevention:** always «Привязать Telegram» (nonce) before create when portal shows unlinked; never assume linked TG tenant == current portal tenant.

### INC-045 — Opportunity picker shows second fake kanban «All Сделки»
- **Симптом:** view picker: **Канбан** (ok) + **All Сделки** with kanban icon — both look like boards; no real list view.
- **Причина:** GraphQL `updateView` wrote `type=KANBAN` / `IconLayoutKanban` into `view.overrides` on the seeded TABLE; columns stayed TABLE/`IconList`, but UI trusted overrides. Converting INDEX→KANBAN in-place when a separate board exists made this worse after SQL demoted key.
- **Фикс:** SQL `set-opportunity-kanban-default.sql` + `ensureOpportunityRuDefaults` → secondary **Списком** TABLE/`IconList`, strip kanban keys from `overrides`; `ensureOpportunityKanbanDefault` skips in-place convert when another board exists; `ensureOpportunityListView` renames secondary.
- **Verify:** john = `Канбан` KANBAN INDEX + `Списком` TABLE IconList; antontest/lexx same; hard-refresh picker.
- **Дата:** 2026-07-24.
- **Prevention:** never GraphQL-convert INDEX to KANBAN when a separate board exists; after `updateView` type/icon, verify `overrides` or clear via SQL.

### INC-044 — TG/WA create duplicate Person for same phone
- **Симптом:** WhatsApp lead `+7915…` уже Person; inbound GramJS/Business с тем же номером создаёт **второго** Person; toast/чат не на том контакте; threads switcher не объединяет.
- **Причина:** TG `syncLeadToCrm` dedupe только platformUserId / gift / `findPersonByHint` (username) — **без** phone. WA sync писал phones/whatsapp, но не искал существующего TG Person по номеру.
- **Фикс:** `@voxly/twenty-client` `findPersonByPhone` (phones.primaryPhoneNumber variants + `whatsapp` eq); GramJS передаёт `User.phone`; TG/WA sync merge before create; ambiguous → `needsReview`; Opportunity reuse по Person.
- **Verify (prod):** WA Person with `whatsapp=+7915…` → TG inbound from account with visible same phone → **same** `twentyPersonId` on both Conversations; toast opens that Person; no phone → new Person; two conflicting matches → `needsReview=true`.
- **Дата:** 2026-07-24.
- **Prevention:** always search phone/whatsapp before createPerson when E.164 known; keep INC-042 stale-id checks.

### INC-043 — WA Person phones/whatsapp empty (LID webhook, no senderPn)
- **Симптом:** inbound WA → toast + Chat OK; Person «Антон» Phones и social **WhatsApp** пустые. Header «Пишем от: WhatsApp · ремонт тоя».
- **Причина:** Evolution `messages.upsert` for Android peers often has only `@lid` in `key.remoteJid` — **no** `remoteJidAlt`/`senderPn` in stored Message or webhook. INC-039 extract path never got E.164 → `syncLeadToCrm` skipped `updatePersonPhone` / `updatePersonWhatsapp`.
- **Фикс (частичный):** parse webhook `remoteJidAlt`/`senderPn`/vCard; Contact/Chat **explicit** PN fields; `POST /internal/crm/backfill-phones`. Avatar/pushName twin matching **disabled by default** (see INC-059).
- **Verify:** Evolution prod upgraded to **v2.3.7-lid** (2026-07-26, backup `20260726-002454`); session restored without QR. Next inbound LID chat should log phone `source=webhook` when `remoteJidAlt`/`senderPn` present; else still manual/`contactMessage`/`platformUsername` cache.
- **Дата:** 2026-07-24 / уточнено 2026-07-26.
- **Prevention:** never invent E.164 from avatar/pushName; upgrade Evolution for Baileys lidMapping.

### INC-059 — WA wrong phone from avatar twin (LID→Contact profilePic)
- **Симптом:** WhatsApp chat list/header shows real PN (e.g. +7 985…), CRM Person got wrong number (e.g. 7915…) or empty. Number is **not** only from phone address book — WA UI has lidMapping.
- **Причина:** Evolution `voxly-evolution-api:v2.2.3-lid` Message.key: **0** rows with `remoteJidAlt`/`senderPn`; `IsOnWhatsapp` has no `@lid` map. Worker INC-043 matched LID Contact → `@s.whatsapp.net` twin by **profilePic fingerprint** → stranger's E.164.
- **Фикс:** disable avatar twin by default (`WA_LID_AVATAR_PHONE_MATCH=1` opt-in only); keep webhook/vCard/explicit Contact|Chat fields; reuse `Conversation.platformUsername` E.164 cache; `fetchBusinessProfile(@lid)` → Person email (no phone); log `source=` + LID-without-PN; document Evolution upgrade → **v2.3.7** (Baileys LID mapping; avoid 2.4 licensing until decided).
- **Дата:** 2026-07-26.
- **Prevention:** empty phone > wrong phone; upgrade Evolution for real lidMapping.

### INC-042 — WA inbound after CRM wipe: toast OK, Person/Opportunity missing
- **Симптом:** john: удалили всех People+Opportunities в Twenty → inbound WA → left toast есть, Person/Opportunity не создаются; клик по toast не открывает Чат.
- **Причина:** Twenty soft-delete (`deletedAt`); `Conversation.twentyPersonId` / `twentyOpportunityId` остались на trashed uuid. `syncLeadToCrm` early-return при обоих id → create пропускается (updatePerson* может трогать trash). Toast строится по ChatMessage без проверки существования Person → клик на мёртвый `/object/person/<stale>` или no-op.
- **Диагностика:** control PG john WA: msgs>0 + CRM ids NOT NULL; Twenty `person.deletedAt` set; GraphQL `people(id=…)` → empty; worker без `syncLeadToCrm failed` (silent skip).
- **Фикс:** `@voxly/twenty-client` `personExists` / `opportunityExists`; WA (+ TG) sync: validate → clear stale → recreate Person+Opportunity; sync на каждый inbound; toast без CRM ids не навигирует.
- **Verify:** backfill john 2 WA → live Person+Opportunity; service-token GET chat 200 (WhatsApp, msgs present); backup `20260724-115625`.
- **Дата:** 2026-07-24.
- **Prevention:** never trust stored Twenty ids without existence check after CRM delete/wipe; keep sync on every inbound.

### INC-041 — CRM inbound left toasts never appear (shell-ux sed)
- **Симптом:** john-crm: inbound ChatMessages есть (WA «Прррр»/«Ппррр»), `GET /api/crm/chat/inbound-toasts` с service token → `items[]`, но left toasts не показываются. Poll в Network отсутствует.
- **Причина:** `twenty.Dockerfile` `sed` заменяет **все** `__VOXLY_API_URL__`, включая guard `API.indexOf('__VOXLY_API_URL__') !== -1` → после bake условие всегда true → `pollInboundToasts` сразу `return`. Вторично: poll ходил только с portal `#voxlyChatToken` (bookmark/hard-refresh без Open CRM = silent).
- **Диагностика:** curl `john-crm…/voxly-shell-ux.js` → `API.indexOf('https://api.getvoxly.ru')`; control PG 2× `role=user` за 10 мин; saas-api service-token → 2 items; CORS preflight OK.
- **Фикс:** shell-ux `apiUrlReady()` = `API.indexOf('__') === -1`; prefer same-origin `GET /s/crm-chat/inbound-toasts` via Twenty `tokenPairState.accessOrWorkspaceAgnosticToken` + logic `get-inbound-toasts`; fallback portal JWT → api host.
- **Verify:** hard-refresh john-crm (logged in, no portal hop) → Network `/s/crm-chat/inbound-toasts` 200; send inbound → toast ≤10s; baked JS must not contain `indexOf('https://api.getvoxly.ru')`.
- **Дата:** 2026-07-24.
- **Prevention:** never put Dockerfile sed placeholders inside runtime string-equality checks; use split/`indexOf('__')` or a one-shot assignment.

### INC-040 — GramJS CRM reply 400: peer not found (deleted/spam)
- **Симптом:** `john-crm` «Чат» Person `c787d312-…` → reply → `/s/crm-chat/…/reply` **400**; toast только `Request to … failed with status 400`. Contact in CRM (Meeting), not visible in Telegram dialogs.
- **Причина:** Conversation `telegram_gramjs`, `platformUserId=8471608447` (Лариса). Inbound spam-like «🥰 Подаришь мне улыбку? ✨». GramJS `getEntity` → `peer not found: Could not find the input entity for PeerUser`. UI `replyErrorMessage` extracted `body.error` but **returned `err.message`** (status string).
- **Фикс:** saas-api `humanizeCrmChatSendError` → «Аккаунт удалён или недоступен» (+ privacy / WA exists:false); chat-panel prefers API `error` over status toast; re-ensure crm-chat tarball on john.
- **Verify:** service-token reply → `{"error":"Аккаунт удалён или недоступен"}` **400**; hard-refresh CRM toast shows Russian (not status 400).
- **Дата:** 2026-07-24.
- **Prevention:** map TG/GramJS/Evolution peer-gone errors before CRM UI; always surface `body.error` in snackbar.

### INC-039 — WA Person name ends with LID digits; phone empty
- **Симптом:** Twenty Person «Антон 165274770739447»; phones пустые, хотя в WA виден реальный номер. CRM media reply → 400 «вложения не поддерживаются».
- **Причина:** (1) `syncLeadToCrm` писал `lastName = platformUserId` (часто Linked ID, 14–16 цифр) → UI склеивает first+last. (2) Phone брался только из `platformUserId`; при `@lid` без отдельного E.164 из `remoteJidAlt`/`senderPn` поле phones не заполнялось. (3) saas-api явно блокировал WA multipart из CRM.
- **Фикс:** extract E.164 из Evolution alt/PN fields; `firstName` = pushName/«WhatsApp», lastName без LID; `platformUserId` остаётся LID для send; Evolution `sendMedia` + CRM attachments; presence/read на GET/reply.
- **Verify:** новый inbound → Person с `+E.164` когда alt есть; имя без 14–16-значного хвоста; media reply → 200; открытие чата шлёт composing (best-effort).
- **Дата:** 2026-07-24.
- **Prevention:** never put WA LID into Twenty name/phone; store LID only on Conversation.platformUserId; prefer remoteJidAlt/senderPn for phones.

### INC-038 — CRM Chat reply 400 for WhatsApp LID peers
- **Симптом:** `john-crm` «Чат» → reply → `/s/crm-chat/<opportunityId>/reply` **400**. History loads. saas-api: `CRM chat reply send failed` / `Bad Request` via `sendViaWhatsappWorker`; `botType=ai_wa`, `chatId` like `122372778684449`.
- **Причина:** Conversation.`platformUserId` is WhatsApp **Linked ID** (`@lid`), not E.164. Worker sent digits-only → Evolution maps to `@s.whatsapp.net` → `onWhatsApp` `exists:false` → HTTP 400. Even with `digits@lid`, stock **Evolution v2.2.3** rejects LID in `sendMessageWithTyping` (no `@lid` bypass; PR #2544). tsup duplicates that check across ~132 dist chunks — patching only `whatsapp.baileys.service.js` is not enough.
- **Фикс:** `ai-whatsapp-worker` formats LID as `digits@lid`, prefers inbound `remoteJidAlt`, tighter E.164 heuristic; `docker/evolution-api.Dockerfile` FROM v2.2.3 patches **all** dist JS copies (`@broadcast` + `@lid` bypass); compose image `voxly-evolution-api:v2.2.3-lid`; `prod-deploy.sh` service `evolution-api` + `--profile whatsapp`.
- **Verify:** Evolution `sendText` `@lid` → **201**; worker `/internal/messages/send` → **200**; service-token `POST /api/crm/chat/1a0beec2-…/reply` + `X-Twenty-Workspace-Id` → **200** + operator `ChatMessage`. GramJS/gift untouched.
- **Дата:** 2026-07-24.
- **Prevention:** always send WA LID with `@lid` suffix; when patching Evolution, patch every tsup chunk (or upgrade past PR #2544); prefer `remoteJidAlt` on inbound when present.

### INC-037 — WhatsApp inbound silent in CRM Chat (no Person/Opportunity)
- **Симптом:** messages to connected WA appear nowhere in CRM «Чат»; Telegram threads still show. Worker may restart-loop.
- **Причина:** Evolution webhook + ChatMessage OK; `syncLeadToCrm` called `createPerson({ phone: WA lid/digits })`. Twenty rejects phone without calling code / invalid LID (`Provided phone number is invalid`); `createPerson` fallback rethrew flat `firstName` error; **unhandled rejection crashed** `ai-whatsapp-worker` → Conversation never got `twentyPersonId` → `findCrmChatTarget` could not resolve CRM record.
- **Фикс:** `createPerson` retries nested **without** phones; WA worker skips non-E.164 phones, wraps sync in try/catch; CRM GET returns `threads[]` + `?conversationId=` switcher; WA identity = `displayName` / `+phone`. Backfilled existing WA convs on john.
- **Verify:** service-token GET `/api/crm/chat/<personId>` → `channelLabel=WhatsApp`, messages present; worker Restarts=0 after inbound; GramJS GET still `Telegram · личный аккаунт`.
- **Дата:** 2026-07-23.
- **Prevention:** never pass WA `@lid` / device ids as Twenty `phones`; always catch CRM sync so webhook path stays up.

### INC-036 — WhatsApp UI shows Evolution hash slug instead of typed name
- **Симптом:** after Cyrillic connect («ремонт тоя») portal list shows `n1oufrdm` (or earlier `__________`); failed QR leaves inactive junk rows.
- **Причина:** `sanitizeName` writes ascii/hash into `BotInstance.botUsername` and API exposed that as `name`; no separate human label; no delete/prune for stubs.
- **Фикс:** `BotInstance.displayName`; worker persists label vs slug; accounts API returns display name; DELETE account + underscore stub prune; portal delete button.
- **Verify:** john prod → one active WA with `displayName=ремонт тоя`, phone `79918829870`; junk deleted.
- **Дата:** 2026-07-23.
- **Prevention:** never put user-facing Cyrillic into Evolution instance id; always store display label separately.

### INC-035 — WhatsApp QR stuck «Подготовка…» (Evolution `qrcode.count:0`)
- **Симптом:** portal `/dashboard/ai/whatsapp` → «Показать QR» → badge «Подготовка…», QR never appears (soft billing OK; INC-034 column present).
- **Причина:** Evolution Baileys default `CONFIG_SESSION_PHONE_VERSION` (=`2.3000.1015901307`) no longer generates QR — create/connect return `{count:0}` without `base64` while state stays `connecting`. Secondary: Cyrillic display names (`ремонт тоя`) sanitized to `__________` → ugly/colliding Evolution instance ids.
- **Фикс:** set `CONFIG_SESSION_PHONE_VERSION=2.3000.1043705293` (wppconnect current) on prod `.env` + compose default; recreate `evolution-api` (no `-v`); worker `sanitizeName` → ascii hash slug when no alnum left; QR wait/retry; portal polls sanitized `name` from start.
- **Verify:** Evolution create returns `qrcode.base64` (~13k); worker `POST /internal/auth/qr/start` with Cyrillic → `status:qr_ready` + `hasQr`; portal/API smoke **200**.
- **Дата:** 2026-07-23.
- **Prevention:** when WA QR dies again, bump `CONFIG_SESSION_PHONE_VERSION` (do not wipe volumes); keep version in `.env.example`.

### INC-034 — WhatsApp connect 500: missing `BotInstance.defaultAiAgentId` (prod)
- **Симптом:** portal WhatsApp connect / accounts → Prisma error `The column BotInstance.defaultAiAgentId does not exist in the current database` (soft billing warning still OK).
- **Причина:** ADR-014 migration `20260723180000_ai_agent_assignment` (+ `20260723163000_telegram_audience_graph`) never applied on **prod** control Postgres. Prod schema was historically brought up with `prisma db push` → no `_prisma_migrations`; later code assumed AiAgent columns/tables.
- **Фикс:** backup control DB → idempotent SQL create `AiAgent` / audience tables + `ADD COLUMN IF NOT EXISTS` `defaultAiAgentId` / `aiAgentId` → `prisma migrate resolve --applied` for all four dated migrations.
- **Verify:** column present; Prisma findFirst with `defaultAiAgentId` OK; `/api/bots/whatsapp/accounts` → 401 Unauthorized (not 500).
- **Дата:** 2026-07-23.
- **Prevention:** after any control schema change, run `migrate deploy` (or resolve) on prod; do not rely on `db push` alone for prod history.

### INC-033 — CRM Chat reply 400 for GramJS (after INC-032)
- **Симптом:** после фикса 404 reply → `.../s/crm-chat/<id>/reply failed with status 400`. История грузится.
- **Причина (диагностика):** saas-api + gramjs `POST /messages/send` для этого Conversation **работают** (service-token reply → 200, сообщение в TG). UI 400 чаще из-за пустого body / вложения (GramJS attachments → 400) или кратковременного сбоя сессии; toast не всегда показывал `error` из JSON.
- **Фикс:** GET chat отдаёт `channelLabel` / `identityLabel` / `supportsAttachments`; chat-panel показывает «Пишем от: …»; для GramJS скрыт «Прикрепить»; composer не даёт пустой `el.value` перебить `draft`; reply принимает `message`/`content` aliases; warn-лог на send fail. Tarball пересобран, app re-ensured на john workspace.
- **Verify:** hard-refresh `john-crm…` → Чат → текст без вложения → в Telegram; шапка «Telegram · личный аккаунт · @bot».

### INC-032 — CRM Chat reply 404 for GramJS / AI leads (`/s/crm-chat/.../reply`)
- **Симптом:** на `{slug}-crm.getvoxly.ru` вкладка «Чат» → reply → `request to https://{slug}-crm…/s/crm-chat/<id>/reply failed with status 404`. Person+Opportunity из GramJS создались ОК.
- **Причина:** URL на CRM host `/s/crm-chat` **корректен** (Twenty logic → saas-api; curl без токена → Missing authentication token, не WORKSPACE_NOT_FOUND). saas-api `POST /api/crm/chat/:id/reply` искал только `GiftSubscriber` по `twentyPersonId`/`twentyOpportunityId`. AI/GramJS пишут CRM ids в `Conversation`, не в GiftSubscriber → 404 `No Telegram chat linked…`. Плюс GramJS не шлётся через Bot API (сессия в `botTokenEncrypted`).
- **Фикс:** `crm-chat.ts` — `findCrmChatTarget` (GiftSubscriber **или** Conversation); reply: gift/`ai_tg` → Bot API (+ `business_connection_id`); `ai_gramjs` → `gramjs-bridge` `POST /messages/send`. History/GET тоже через Conversation.
- **Verify:** curl `{slug}-crm…/s/crm-chat/<id>` без токена → auth missing; после deploy — reply text из CRM доходит в Telegram; история показывает inbound.
- **Дата:** 2026-07-23.

### INC-031 — New tenant CRM opens `app.app.getvoxly.ru` / auth fails on `{slug}-crm`
- **Симптом:** после регистрации Open CRM → `https://app.app.getvoxly.ru/welcome` (не резолвится) или `{slug}-crm…/verify` → ошибка auth → снова `app.app…`.
- **Причина:** (1) GraphQL `updateWorkspace(customDomain)` требует `CLOUDFLARE_API_KEY` (Twenty Cloud DNS); без него `customDomain` пустой. (2) Twenty `DEFAULT_SUBDOMAIN=app` + `SERVER_URL=https://app.getvoxly.ru` → fallback URL `app.app.getvoxly.ru`. (3) Portal `toBrowserCrmUrl` уже писал на `{slug}-crm`, но Host не матчил workspace без customDomain.
- **Фикс:** SQL `customDomain` + `isCustomDomainEnabled` через `TWENTY_DATABASE_URL` в provisioning (`ensureTwentyCustomDomain`); antontest3 patched; chat install duplicate/upload hardened.
- **Дата:** 2026-07-22.

### INC-030 — Chat `/s/crm-chat` 404 WORKSPACE_NOT_FOUND on custom CRM domain
- **Симптом:** вкладка «Чат» → `Request to https://app.getvoxly.ru/s/crm-chat/<id> failed with status 404` (`WORKSPACE_NOT_FOUND`).
- **Причина:** тот же класс, что INC-011/029: logic-function base URL = `SERVER_URL` (`app.*`). На `app.getvoxly.ru` workspace по custom domain не находится; на `{slug}-crm` маршрут есть (без токена → auth error, не workspace-missing).
- **Фикс:** (1) `docker/patch-twenty-functions-url.cjs` v2 → `location.origin+"/s"` (+ localhost subdomain fallback); вшит в `twenty.Dockerfile`. (2) `chat-panel` `workspaceAwareFetch` переписывает `/s/*` с origin `SERVER_URL`/`TWENTY_API_URL` → `WORKSPACE_ORIGIN`. Prod: rebuild twenty + `yarn twenty apply` antontest; vars `WORKSPACE_ORIGIN`/`VOXLY_API_URL` restored.
- **Verify:** `curl antontest-crm.../s/crm-chat/<id>` → Missing authentication token (не WORKSPACE_NOT_FOUND); `app.getvoxly.ru` тот же path → по-прежнему 404 workspace.
- **Дата:** 2026-07-22.

### INC-029 — FrontComponent chat 404/Failed to fetch on custom CRM domain
- **Симптом:** вкладка «Чат» → `Failed to fetch https://app.getvoxly.ru/rest/front-components/…/*.js` (404/403).
- **Причина:** Twenty `FrontComponentRenderer` строит URL от `SERVER_URL` (`app.getvoxly.ru`). Сессия на `{slug}-crm.getvoxly.ru` → куки не уходят на `app.*` → без auth 403/404.
- **Фикс:** `docker/patch-twenty-front-component-url.cjs` — URL = `location.origin/rest/front-components/...`; вшит в `twenty.Dockerfile`.
- **Дата:** 2026-07-22.

### INC-028 — Channel verify: Telegram OK but portal «не видит»
- **Симптом:** бот админ `@voxlytest111`, «Проверить админа» кажется бесполезным; канал не в проекте.
- **Причина:** `getChatMember` уже возвращал `administrator`, но verify только писал в React state — без автосохранения в `GiftCampaignConfig` (channelId оставался `pending`). У групп без публичного @username / invite `t.me/+` Telegram даёт `chat not found`.
- **Фикс:** verify сохраняет `channelId`/`channelUsername` в проект; UI показывает «Канал привязан»; понятные ошибки; поддержка числового id.
- **Дата:** 2026-07-22.

### INC-027 — Gift bot created in Telegram but missing from portal list
- **Симптом:** `@voxly_antontest_01_bot` создан через Manager; кабинет «Боты подарков» = 0.
- **Причина:** (1) Traefik слал `POST /bots/manager/webhook` в manager-bot, а сервис слушал только `/webhook` → Telegram `404 Not Found`, `ManagedBotUpdated` не доставлялся; (2) `User.telegramUserId` был NULL — даже при доставке линковка по creator падала; (3) `/tg/...` child webhooks не были в Traefik.
- **Фикс:** manager принимает `/bots/manager/webhook`; match pending provision by username + auto-link telegram; Traefik labels for gift-bot `/tg`; redelivered pending updates → `BotInstance` active.
- **Дата:** 2026-07-22.

### INC-026 — Prod CRM «Чат» logic functions: missing VOXLY_SERVICE_TOKEN
- **Симптом:** вкладка «Чат» на prod (antontest) после apply → proxy 500 / «VOXLY_SERVICE_TOKEN is not configured».
- **Причина:** `VOXLY_SERVICE_TOKEN` был только на `saas-api`; twenty-server/worker (LOCAL logic functions) читают `process.env.VOXLY_SERVICE_TOKEN` и не получали секрет.
- **Фикс:** compose env на `twenty-server` + `twenty-worker`; recreate без `-v`. App vars `WORKSPACE_ORIGIN`/`VOXLY_API_URL` через `updateOneApplicationVariable`.
- **Дата:** 2026-07-22.

### INC-025 — Prod CRM open: «Could not open CRM workspace»
- **Симптом:** новый аккаунт (`antonTEST@deploy.com`) на `getvoxly.ru/dashboard` → Open CRM → 502 / «Could not open CRM workspace».
- **Причина:** (1) Twenty `signIn` case-sensitive: portal email `antonTEST@…`, Twenty user `antontest@…` → `USER_NOT_FOUND`. (2) Twenty SSO URL `https://{slug}.app.getvoxly.ru` не резолвится (wildcard DNS = один label); нужен `{slug}-crm.getvoxly.ru`. (3) Workspace оставался `PENDING_CREATION` без schema до `activateWorkspace`.
- **Фикс:** `normalizeEmail` в `@voxly/twenty-client`; register lowercases email; `toBrowserCrmUrl(..., crmSubdomain)`; provisioning `activateWorkspace` + `customDomain={slug}-crm.{VOXLY_DOMAIN}`; prod: activate + customDomain для antontest, rebuild `saas-api`.
- **Дата:** 2026-07-22.

### INC-024 — CRM «Чат» missing photos on bot funnel messages
- **Симптом:** after `/start`, Telegram shows photo+caption; CRM tab «Чат» shows text only (e.g. «После /start»), no `<img>`.
- **Причина:** `logBotOutbound` wrote `ChatMessage` with `content` only — never `attachments`. Inbound/`operator` replies already stored `{ type, fileId }`. UI (`chat-panel`) and `GET /api/crm/chat/.../file/:fileId` were fine.
- **Диагностика:** `ChatMessage` role=`assistant` → `attachments IS NULL`; operator photo rows had `fileId`. Funnel `start.telegramFileId` present in `GiftCampaignConfig.funnelJson`.
- **Фикс:** `sendBotPhoto`/`Video`/`Document` → `attachmentFromSendResult` + `logBotOutbound(..., [att])`. Optional one-off SQL backfill for existing start rows from funnel `telegramFileId`.
- **Дата:** 2026-07-22.

### INC-023 — Chat UI looked like only the first line was sent
- **Симптом:** multiline reply (e.g. `~~111~~` + `||222||`) appeared as a single struck line in CRM «Чат»; user thought only line 1 was sent.
- **Причина:** (1) `ChatMessage.content` in DB already had full multiline — send path OK. (2) Display used `<br/>` + spoiler `color:#333;background:#333` → second line invisible; Remote DOM may also collapse/`br` poorly.
- **Фикс:** render each line as a `<div>` row; spoiler = dashed readable hint (not black-on-black). Keep Cmd/Ctrl+Enter send (INC-022).
- **Дата:** 2026-07-21.

### INC-022 — Chat multiline: Enter sent only the first line
- **Симптом:** CRM «Чат»: первая строка + зачёркнутый, вторая строка → в Telegram уходит только первая.
- **Причина:** `onKeyDown` treated plain **Enter** as send (`!shiftKey`). User pressed Enter for a new line → message sent immediately with only line 1. Shift+Enter was required for newline (undocumented).
- **Фикс:** Enter inserts newline; **Cmd/Ctrl+Enter** sends. `readComposerText()` prefers textarea DOM value (Remote DOM vs React draft). Format fallback wraps last word on the **current line** only. Placeholder hint.
- **Дата:** 2026-07-21.

### INC-021 — Kanban note chip shows `[object Object]` / short title instead of body
- **Симптом:** Сделки kanban (test2): chip `noteTargets` = literal `[object Object]` instead of note body (e.g. «Тестовая заметка…»). After SQL fix still two `[object Object]` chips until Redis flushed.
- **Причина:** (1) `labelIdentifier` was set to Note.`bodyV2` (RICH_TEXT) → stringify = `[object Object]`. (2) Postgres update alone is **not enough** — Redis flat-map `object-metadata` kept stale `bodyV2` id (`143cedd1…`) while DB already had `title` (`94a308d4…`).
- **Диагностика:** Compare `objectMetadata.labelIdentifierFieldMetadataId` in PG vs Redis `engine:workspace:flat-maps:object-metadata:<workspaceId>:data`; note rows already had correct TEXT `title` ← `bodyV2Markdown`.
- **Фикс:** labelIdentifier → `title`; sync `title ← bodyV2Markdown` on **every** INSERT/UPDATE (not only body column — Twenty often overwrites title with first line after body save); latest note first via `noteTarget.position`; **flush Redis object-metadata**; shell-ux hide 2nd+ chips + widen noteTargets 280. `ensureNoteTitleAsLabel` in twenty-client.
- **Дата:** 2026-07-21.
- **Reopen 2026-08-04 (voxly):** chip showed short title (`мм`) while body was `мсмчмчмч` — triggers missing after workspace recreate; GraphQL `reapply-crm-defaults` did not reinstall them. Fix: apply `set-opportunity-kanban-card-defaults.sql` + `ensureOpportunityKanbanCardDefaults` on provision/reapply.

### SEC-001 — Global service token + unbound fileId (review 2026-07-21)
- **Severity:** Medium (not shipping-blockers for local PoC).
- **Findings:** (1) `VOXLY_SERVICE_TOKEN` + caller `X-Twenty-Workspace-Id` can reach any tenant if token leaks. (2) `GET /api/crm/chat/:recordId/file/:fileId` does not verify `fileId` belongs to that conversation’s attachments (in-tenant IDOR).
- **Mitigations today:** JWT path still tenant-scoped; service token intended for Twenty→saas-api only; XSS escaped in chat HTML; Nest 10MB + JPEG shrink (INC-020).
- **Follow-up:** per-workspace service credentials; bind `fileId` to conversation messages before Telegram `getFile`.
- **Дата:** 2026-07-21.

### INC-020 — Multi-file chat reply 500 (`request entity too large`)
- **Симптом:** вкладка «Чат» на test2: два вложения (2 фото или смешанные) → toast `Request to http://test2.localhost:3007/s/crm-chat/<id>/reply failed with status 500`; chips остаются.
- **Причина:** Nest `useBodyParser('json', { limit: storage.maxFileSize })` = **10MB**. Outbound reply шлёт JSON `fileBase64` (×4/3). Крупные JPEG (часто при multi-select двух фото) → HTTP **500** с телом `"request entity too large"` (не Telegram/saas-api). saas-api при успешном проходе всегда 200; sequential `/reply` сам по себе ок.
- **Диагностика:** curl POST `/s/.../reply` с body >10MB → 500 `"request entity too large"`; ≤~8MB JSON → 200; два маленьких png/docx sequential → 200; saas-api logs без failed reply.
- **Фикс:** (1) host `patch-twenty-file-base64.cjs` — JPEG downscale (max edge 1600, quality ladder, ≤~7MB b64) before worker; re-patchable. (2) `chat-panel` — read top-level `event.files` (i4 shape), prefer lists with `dataBase64`; preflight size; toast for entity-too-large; clear composer only after all sequential sends. Apply front `c93f55cd…`; hot-patch FrontComponentRenderer.
- **Дата:** 2026-07-21.

### INC-019 — Chat composer scrolls with history (outer page-layout scroller)
- **Симптом:** блок ввода (toolbar / textarea / Прикрепить / Отправить) уезжает вместе с прокруткой истории; DOM path inside `#scroll-wrapper-scroll-wrapper-page-layout-…`.
- **Причина:** Twenty CANVAS wraps the widget in `.page-layout-scroll-wrapper { overflow: auto }`. Remote DOM/`height:100%`+CSS grid did **not** clamp the front root when messages grew → `scrollHeight` of outer wrapper > viewport → whole widget (incl. composer) scrolls. Internal `overflowY:auto` on the list never engaged.
- **Диагностика:** inject tall pads into message list → `root` grew (e.g. 991→4200), `sw.scrollHeight` >> `clientHeight`, composer `getBoundingClientRect().top` moved on outer `scrollTop`.
- **Фикс:** (1) `docker/twenty-shell-ux.js` `pinChatCanvasScroll` — detect Voxly Chat chrome, set wrapper `overflow:hidden`, widget+3 host wraps `height/max-height:100%; overflow:hidden; position:relative`. (2) `chat-panel` root `position:absolute; inset:0; display:flex; flex-direction:column`; list `flex:1; minHeight:0; overflowY:auto`; composer `flexShrink:0`. Apply front `fa82b539…`; hot-patch shell-ux.
- **Дата:** 2026-07-21.

### INC-018 — Chat tab «Неверная конфигурация» after file-base64 host patch
- **Симптом:** вкладка «Чат» → red «Неверная конфигурация» (tooltip: `SyntaxError: missing ) after argument list`).
- **Причина:** `docker/patch-twenty-file-base64.cjs` rewrote `a4=…` with `Promise.all(…map(…new Promise(…)))` but only **two** closing `)` before `.then` (needed three) → broken `FrontComponentRenderer-*.js` chunk; lazy load on FRONT_COMPONENT → error boundary.
- **Диагностика:** React fiber on `widget-invalid-config-tooltip-*` → `SyntaxError: missing ) after argument list`; isolated `new Function(a4…)` failed; `}})).then` vs `}))).then`.
- **Фикс:** add missing `)` in running asset + patch script (`}))).then`). Hard-refresh to drop cached broken chunk.
- **Дата:** 2026-07-21.

### INC-017 — Chat attach `FileReader.readAsDataURL`: parameter 1 is not of type 'Blob'
- **Симптом:** after INC-015 FileReader path: attach docx/photo → chips show names → send toast `Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'`.
- **Причина:** Twenty Remote DOM only forwards **file metadata** (`name/size/type/lastModified`) into the worker (PR #20458). Worker `target.files` entries are **plain objects**, not `Blob`/`File`. `arrayBuffer` and `FileReader` both fail. Encoding on send cannot work; host must base64 before postMessage.
- **Диагностика:** chips prove metadata crosses the bridge; FileReader error proves no bytes; inject `twenty-deal-chat.js` uses real-DOM `FormData` (different runtime).
- **Фикс:** (1) host patch `docker/patch-twenty-file-base64.cjs` — async FileReader on real `n.target.files` before forwarding, adds `dataBase64` per file (baked in Dockerfile + hot-patched running server). **Must close `Promise.all(map(Promise))` with three `)` before `.then` (INC-018).** (2) `chat-panel` stores `PendingAttachment{name,type,size,dataBase64}` on change; send uses stored base64 (no FileReader). Toast if metadata-only (unpatched host). Composer pin superseded by **INC-019** (absolute flex + shell-ux outer scroll lock). Keep INC-016 composer remount.
- **Дата:** 2026-07-21.

### INC-016 — Chat text send OK but composer draft still visible / Send gray
- **Симптом:** after INC-015, text-only reply reaches history (Менеджер) but textarea still shows draft and **Отправить** stays gray.
- **Причина:** not `sending` stuck (finally already cleared it). Remote DOM **does not sync controlled `value=""`** to the host textarea after `setDraft('')`. React `draft===''` → `canSend=false` → button correctly disabled/gray while the host DOM keeps the old text — looks like a stuck composer.
- **Диагностика:** send + history update prove `/reply` succeeded; gray Send with empty React draft is `!canSend`, not hung `sending`.
- **Фикс:** after successful send, `setDraft('')` + increment `composerKey` to remount `<textarea key={composerKey}>`; `setSending(false)` in `finally`; `void load()` outside. No `.focus()`. `yarn twenty apply --remote test2 --force` (front `6617426e…`, was `e7daa9b3…`).
- **Дата:** 2026-07-21.

### INC-015 — Chat attach send `t.arrayBuffer is not a function` + stuck Send
- **Симптом:** attach docx/photo → toast `t.arrayBuffer is not a function`; chips remain; text may reach Telegram but composer draft uncleared and **Отправить** stays gray/disabled.
- **Причина:** Remote DOM `File` stubs lack `arrayBuffer()`; encode mid-send threw. Hung `load()` inside same `try` could also leave `sending=true`.
- **Диагностика:** inject `docker/twenty-deal-chat.js` uses real-DOM `FormData`+File; SDK front must JSON `fileBase64` via `/s`.
- **Фикс (partial):** `setSending(false)` in `finally`; clear draft/files only after success. FileReader.encode superseded by **INC-017** (stubs are not Blobs). Text stuck draft → INC-016.
- **Дата:** 2026-07-21.

### INC-014 — Chat photo preview empty 200 / 📎 «Фото» (logic JSON size cliff)
- **Симптом:** inbound photo в SDK «Чат» → `📎 Фото` (failed branch); history loads OK.
- **Причина:** `get-crm-chat-file` via HTTP `/s/.../file/...` returns **200 + empty body** when JSON ≈240KB (full Telegram JPEG base64). Small docs (~18KB JSON) OK. `dev:function:exec` SUCCESS without Data dump for large payloads. Front sees `!dataBase64` → failed UI. (ПКМ format separately broken: Remote DOM `contextmenu` preventDefault unreliable.)
- **Диагностика:** saas-api `GET /file/:fileId` → 182KB JPEG OK; Twenty `/s/.../file/...` Host `test2.localhost` → `len=0`; compress path → ~33KB `image/jpeg` JSON OK.
- **Фикс:** `voxly-proxy` JPEG downscale via `jpeg-js` (max edge 480, quality ladder, ≤48KB raw); ПКМ abandoned → always-visible format toolbar; `yarn twenty apply --remote test2 --force`.
- **Дата:** 2026-07-21.

### INC-013 — Chat tab Worker «Failed to parse URL» from relative `/s/...`
- **Симптом:** после INC-012 relative fetch → `Failed to execute 'fetch' on 'WorkerGlobalScope': Failed to parse URL from /s/crm-chat/...`; снова плавающая «← Кабинет» после restart Twenty.
- **Причина:** (1) Web Worker не резолвит relative URL; (2) absolute `test2.localhost` не в hostFetch `allowedOrigins` (только `TWENTY_API_URL`/`TWENTY_FUNCTIONS_URL` = bare localhost); (3) Twenty `useGetLogicFunctionHttpUrl` локально даёт `${SERVER_URL}/s` без subdomain; (4) hot-patch `voxly-cabinet.js` слетает при recreate контейнера.
- **Фикс:** patch `useGetLogicFunctionHttpUrl` → `http://{sub}.localhost:PORT/s` (`docker/patch-twenty-functions-url.cjs` + Dockerfile); chat-panel absolute fetch + `WORKSPACE_ORIGIN`; cabinet `DISABLE_FLOATING_CABINET=true` hot-patch again; `yarn twenty apply --force`.
- **Дата:** 2026-07-20.

### INC-012 — Chat tab «Failed to fetch» (sandbox absolute URL + disabled logic)
- **Симптом:** вкладка «Чат» → `Failed to fetch` (не HTTP status); после INC-011 с `WORKSPACE_ORIGIN=http://test2.localhost:3007` чат всё равно не грузится.
- **Причина (два слоя):** (1) `RestApiClient({ baseUrl: WORKSPACE_ORIGIN })` делает absolute fetch на `test2.localhost` — в front-component host-bridged sandbox это даёт TypeError `Failed to fetch`; (2) production Twenty (`NODE_ENV=production`) по умолчанию `LOGIC_FUNCTION_TYPE=DISABLED` — даже при рабочем fetch logic `/s/crm-chat` не исполняется (`DisabledDriver`).
- **Диагностика:** curl `test2.localhost:3007/s/...` без токена → `Missing authentication token` (workspace ok); `docker exec twenty-server printenv LOGIC_FUNCTION_TYPE` пусто; saas-api logs без запросов от Twenty; `yarn twenty dev:function:exec -n get-crm-chat` после `LOCAL` → SUCCESS + `GET /api/crm/chat/...` с `saas-api:3002`.
- **Фикс:** front всегда relative `/s/...` via `workspaceAwareFetch` (без absolute baseUrl); compose/`.env` `LOGIC_FUNCTION_TYPE=LOCAL`; restart twenty-server; `yarn twenty apply --force` on test2.
- **Дата:** 2026-07-20.

### INC-011 — Chat tab `/s/crm-chat` 404 WORKSPACE_NOT_FOUND on bare localhost
- **Симптом:** вкладка «Чат» → `Request to http://localhost:3007/s/crm-chat/<uuid> failed with status 404 Not Found`.
- **Причина:** RestApiClient резолвит `/s/...` в `TWENTY_API_URL`/`TWENTY_FUNCTIONS_URL` = bare `localhost:3007`; локальный multiworkspace открыт как `{slug}.localhost:3007`. Без subdomain Host → `WORKSPACE_NOT_FOUND`. (Twenty `useGetLogicFunctionHttpUrl` локально тоже без subdomain.)
- **Диагностика:** `curl` bare `localhost:3007/s/...` → 404 `WORKSPACE_NOT_FOUND`; `test2.localhost:3007/s/...` → missing/invalid token (workspace найден).
- **Фикс (частичный, см. INC-012):** relative host-bridged fetch (pathname `/s/...`), не absolute `WORKSPACE_ORIGIN` baseUrl. `yarn twenty apply --force` on test2.
- **Дата:** 2026-07-20.

### INC-010 — FrontComponent `window.setInterval is not a function`
- **Симптом:** вкладка «Чат» на Person/Opportunity → `FrontComponent error: Uncaught TypeError: window.setInterval is not a function`; пустая страница scaffold «Voxly CRM Chat» в сайдбаре.
- **Причина:** front components в Remote DOM / Web Worker — нет host `window.setInterval`; пункт сайдбара — scaffold `defineNavigationMenuItem` + standalone page.
- **Фикс:** убрать polling (`setInterval`); refresh on open/send/«Обновить»; удалить nav + main page layout; `yarn twenty apply --force`.
- **Дата:** 2026-07-20.

### INC-009 — Twenty `yarn twenty apply` fails: missing `logoFileId`
- **Симптом:** `column ApplicationRegistrationEntity.logoFileId does not exist` при apply/sync Apps SDK app.
- **Причина:** схема `core.applicationRegistration` отстаёт от кода Twenty 2.22 (upgrade cursor / migrations не догнали).
- **Диагностика:** ошибка в CLI `yarn twenty apply`; `\d core."applicationRegistration"` в `postgres-twenty`.
- **Фикс:** `ALTER TABLE core."applicationRegistration" ADD COLUMN IF NOT EXISTS "logoFileId" uuid;` → restart twenty-server через upgrades → re-apply.
- **Дата:** 2026-07-20.

### INC-008 — CRM opens blank tab / `/welcome` from dashboard
- **Симптом:** пустая вкладка; или `localhost:3007/welcome`; или `*.lvh.me` blank SPA.
- **Причины:** (1) noopener `_blank`; (2) SSO на голый localhost → `/welcome`; (3) rewrite на `*.lvh.me` — в браузере белый/чёрный экран; Chromium нормально открывает `*.localhost`.
- **Диагностика:** `test2.lvh.me` blank vs `test2.localhost` рендерит Voxly; `crm-login` host.
- **Фикс:** local `SERVER_URL=http://localhost:3007`; SSO `http://{slug}.localhost:3007/verify?…`; не lvh.me; named window `voxly_crm`.
- **Дата:** 2026-07-20.

### INC-007 — CRM Person/Opportunity not created on gift `/start`
- **Симптом:** чат в портале есть, в Twenty нет контакта/сделки; `GiftSubscriber.twentyPersonId` пустой.
- **Причина:** Twenty 2.22 GraphQL: `createPerson(input:)` → `Argument not allowed: input`; нужно `createPerson(data:)`.
- **Диагностика:** `docker logs gift-bot-worker | rg 'CRM sync error|Argument not allowed'`.
- **Фикс:** `packages/twenty-client` mutations `data:` + fallback `name{firstName,lastName}`; дедуп Person по telegramId/username.
- **Дата:** 2026-07-20.

### INC-006 — Portal :3001 down (docker saas-portal exited)
- **Симптом:** сайт/дашборд не грузятся (`portal:000`); API/CRM могут быть ок.
- **Причина:** контейнер `saas-portal` остановлен (раньше крутили host `next start`, docker portal `Exited`); порт 3001 мог держать lima SSH mux.
- **Диагностика:** `docker ps -a --filter name=saas-portal`; `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/`.
- **Фикс:** `cd docker && docker compose --env-file ../.env up -d saas-portal` (Colima running).
- **Дата:** 2026-07-18.

### INC-001 — Redis AOF corrupt (локально)
- **Симптом:** Redis / зависимые сервисы unhealthy; BullMQ/Twenty не стартуют.
- **Причина:** повреждённый AOF в volume `redis-data` (compose: `--appendonly yes`).
- **Диагностика:** `docker logs redis`; `redis-cli ping` fails / AOF load error.
- **Фикс:** починить/сбросить AOF (осторожно с данными очередей) → контейнер healthy → поднять api/workers.
- **Дата:** ~2026-07-18 (Colima restart session).

### INC-002 — `api.telegram.org` unreachable
- **Симптом:** `manager-bot-service` рестартится; gift-bot polling падает; Google/прочий HTTPS ок.
- **Причина:** сеть/ISP блокирует Telegram (таймаут с хоста и из контейнеров).
- **Диагностика:** `curl -m 5 https://api.telegram.org` с хоста и `docker compose exec … curl`.
- **Фикс:** VPN/прокси до Telegram → restart `manager-bot-service` + `gift-bot-worker`.
- **Дата:** 2026-07-18.

### INC-003 — Docker portal показывает старый dark/purple UI
- **Симптом:** `:3001` — indigo gradient, white-on-white «Войти», ghost inputs; в git уже Twenty light.
- **Причина:** stale image/container без rebuild.
- **Диагностика:** сравнить UI с исходниками `apps/saas-portal`; проверить дату image.
- **Фикс:**  
  `docker compose --env-file ../.env up -d --build saas-portal`  
  Также: `next/font/google` → ETIMEDOUT в Docker build → system font stack.
- **Дата:** 2026-07-18.

### INC-004 — Portal `/api` бил не туда (ранний local)
- **Симптом:** register/login 404 / connection refused к API.
- **Причина:** rewrite на `localhost` без префикса `/api` или без Docker DNS.
- **Фикс:** `next.config.ts` → `SAAS_API_URL` + `/api/:path*` → `${apiBase}/api/:path*`.
- **Дата:** 2026-07-15 (зафиксировано в steps.md).

### INC-086 — Gift bot video upload hangs / Premature close (~30s)
- **Симптом:** в кабинете «Загрузка…» на медиа /start; видео так и не появляется; в API логах `ERR_STREAM_PREMATURE_CLOSE` на `POST /api/bots/:id/media` ровно ~30с.
- **Причина:** браузер слал multipart через Next rewrite (`getvoxly.ru/api` → `saas-api`). Прокси Next обрывал длинный upload. Плюс `sendVideo` капризен к MOV/WebM.
- **Фикс:** portal `uploadBotMedia` → напрямую `NEXT_PUBLIC_API_URL` (`api.getvoxly.ru`) с XHR progress; API — fallback video→document, таймауты, понятные 413/Premature close; UI progress bar.
- **Follow-up:** INC-088 — promo/broadcasts still incomplete; document kind + NPM 300s.
- **Дата:** 2026-08-03.

### INC-005 — Gift media silent fail (photo vs document)
- **Симптом:** подарок/медиа не уходит в Telegram.
- **Причина:** неверный метод send по типу; `file_id` префиксы путались.
- **Фикс:** `detectStoredMediaKind` / `resolveTelegramMedia` (`AgAC`→photo, `BQAC`→document, …).
- **Дата:** ~2026-07-16.

### INC-006 — Twenty Apps: `installApp` missing (2.22)
- **Симптом:** provisioning warn+skip; custom App не ставится.
- **Причина:** в 2.22 нет legacy `installApp`; есть `syncApplication` / `installApplication`.
- **Фикс (план):** ADR-001 — SDK app + новые mutation; stub не патчить.
- **Дата:** 2026-07-17.

### INC-079 — Unhandled rejection в джобе планировщика роняет процесс saas-api
- **Симптом:** saas-api контейнер перезапускается; в логах `UnhandledPromiseRejection` / Prisma P2022 (колонка не найдена) от `releaseStaleBalanceHolds` или другого scheduled job.
- **Причина:** async-функции передавались в `setInterval`/`setTimeout` без перехвата ошибок. Отклонённый промис в timer callback = unhandled rejection = Node роняет процесс. Проявилось при деплое: миграции накатывались ПОСЛЕ пересоздания контейнеров, и джоб стартовал на старой схеме (колонки `Payment.balanceAppliedRub` ещё не было).
- **Фикс:** (1) обёртка `safeJob(name, fn)` в `scheduler.ts` — ловит rejection, пишет `console.warn` (процесс не падает); (2) `prod-deploy.sh` теперь выполняет `prisma migrate deploy` ДО `docker-compose up -d --build` (контейнер стартует на актуальной схеме).
- **Verify:** деплой saas-api → `prisma migrate deploy` проходит (21 migration, 0 pending); контейнер стартует с 0 restarts; в логах нет `[scheduler] ... failed`; прежний P2022 невозможен т.к. миграции теперь предшествуют старту.
- **Дата:** 2026-07-31.
