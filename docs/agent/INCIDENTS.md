# Incidents (runtime)

Известные сбои и как диагностировали. **При дебаге читай первым.**  
Новый failure mode → добавь запись сюда + строку в WORKLOG.

---

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

### INC-021 — Kanban note chip shows `[object Object]`
- **Симптом:** Сделки kanban (test2): chip `noteTargets` = literal `[object Object]` instead of note body (e.g. «Тестовая заметка…»). After SQL fix still two `[object Object]` chips until Redis flushed.
- **Причина:** (1) `labelIdentifier` was set to Note.`bodyV2` (RICH_TEXT) → stringify = `[object Object]`. (2) Postgres update alone is **not enough** — Redis flat-map `object-metadata` kept stale `bodyV2` id (`143cedd1…`) while DB already had `title` (`94a308d4…`).
- **Диагностика:** Compare `objectMetadata.labelIdentifierFieldMetadataId` in PG vs Redis `engine:workspace:flat-maps:object-metadata:<workspaceId>:data`; note rows already had correct TEXT `title` ← `bodyV2Markdown`.
- **Фикс:** labelIdentifier → `title`; sync `title ← bodyV2Markdown` on **every** INSERT/UPDATE (not only body column — Twenty often overwrites title with first line after body save); latest note first via `noteTarget.position`; **flush Redis object-metadata**; shell-ux hide 2nd+ chips + widen noteTargets 280. `ensureNoteTitleAsLabel` in twenty-client.
- **Дата:** 2026-07-21.

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
