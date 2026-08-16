### 2026-08-15 — saas-portal landing redesign (light latitude/accelerate style) — deploy

- **Service:** `saas-portal`
- **Host:** `150.241.98.135`
- **Branch:** `feature/cross-channel-enrich-opp-activity` (commit `3dc82cb`)
- **Changes:**
  - Full landing page redesign to light theme matching `latitude.sh/accelerate` palette
  - Off-white `#f9f9f9` background, ink `#020817` text, signature lime `#e0fe56` + purple `#8261fb` accents
  - Vox robot mascot (SVG + framer-motion: float, blink, antenna pulse)
  - Hero: three messenger windows (Telegram/WhatsApp/MAX) animate open → merge into single Voxly inbox
  - Block 3: Interactive phone-enrich demo with clear "enter number" UX (illustrative, no public reverse-lookup)
  - Blocks 7/9/12 (Pricing, Custom-dev, Final CTA) fully restyled to light palette
  - PricingCalculator & ReferralCalculator restyled to latitude palette (ink/purple/lime)
  - 11 numbered sections (01–11), mono eyebrow `./labels`, scroll-reveal + stagger animations
  - `framer-motion` added to saas-portal deps; `prefers-reduced-motion` respected
- **Smoke:** ✅ `https://getvoxly.ru/` (landing), `https://api.getvoxly.ru/health`, all dashboard routes 200 OK
- **Backup:** Control + Twenty DBs backed up by deploy script
- **Note:** Old landing preserved in git history (`friendly-landing` redirects to `/`); new code in `apps/saas-portal/src/components/landing/voxly/`

### 2026-08-15 — 6.2 pgBouncer (transaction mode) перед control-plane PG + deploy

- Goal: снять давление на `max_connections` control-plane PG (8 Prisma-сервисов × ~13 conn) и подготовить к сплиту сервисов по ВПС.
- Changes: сервис `pgbouncer-control` (`edoburu/pgbouncer:v1.25.2-p0`, transaction, pool_size=25, max_client_conn=1000, scram-sha-256, IGNORE_STARTUP_PARAMETERS=extra_float_digits,search_path,options). 8 Prisma-сервисов → `DATABASE_URL=pgbouncer-control:5432?...&pgbouncer=true`; миграции → `DIRECT_DATABASE_URL=postgres-control:5432` (Prisma `directUrl`). Twenty PG не трогали (TypeORM + raw pg prepared statements, FROZEN). ADR-029; `.env.example` (dev: DIRECT=DATABASE_URL). Commit `<pgbouncer>`.
- Verify (local): `prisma validate`/`generate` ✅, `docker compose config` ✅, typecheck saas-api ✅. Pre-deploy live smoke throwaway-контейнером на проде: pgbouncer→postgres-control принимает коннекты, `SELECT Tenant`, `BEGIN; pg_advisory_xact_lock; COMMIT` проходят через transaction pooling.
- Deploy: `./scripts/prod-deploy.sh saas-api,gift-bot-worker,manager-bot-service,platform-bot-service,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` backup снят; prisma migrate deploy (no-op) через DIRECT; `pgbouncer-control` healthy; все сервисы Up; smoke landing/api-health/dashboard×4 **200**.
- Verify (post-deploy): backends к postgres-control **6** (active 1 / idle 5) — раньше 8 прямых пулов дали бы ~100; 0 db-ошибок (prepared statement/P1001/too many clients) во всех 8 сервисах за 3м; `POST /api/auth/login` → 401 (реальный запрос к БД через пул). pgbouncer health=healthy.
- Next: при выносе сервисов на отдельные ВПС — тот же pgbouncer как единая точка коннектов; при упоре Twenty PG в коннекты — отдельная задача (session mode).



- Goal: per-service tokens вместо единого `VOXLY_SERVICE_TOKEN` (split-readiness под рост нагрузки / вынос модулей на отдельные ВПС), безопасно для рабочего.
- Changes: `@voxly/shared/service-auth` (`resolveServiceToken`/`verifyServiceToken`/`extractBearer`/`timingSafeEqualStr`, browser-safe). Токен ключуется по TARGET-сервису (`VOXLY_TOKEN_<SERVICE>`) с fallback на общий `VOXLY_SERVICE_TOKEN` (полная обратная совместимость). Inbound-verify: saas-api `authenticate` + `crm-enrich/max/platform-bot/gramjs`-internal; gramjs-bridge, ai-telegram `/internal/inbound`, ai-whatsapp, max-bridge (py `hmac.compare_digest`). Outbound: proxy-роуты saas-api + воркеры резолвят токен цели. docker-compose anchor `x-voxly-service-tokens` (default пусто) во все сервисы; `.env.example`. ADR-028.
- Verify (local): `pnpm typecheck` 23/23; `pnpm test` 163 passed (+12 `service-auth`); `py_compile` + auth-логика max-bridge; `docker compose config` OK. Commit `d60b7cb`.
- Deploy: `./scripts/prod-deploy.sh saas-api,gramjs-bridge,ai-telegram-worker,ai-whatsapp-worker,platform-bot-service,gift-bot-worker,max-bridge` backup `20260815-*`; prisma migrate deploy (no-op, без новых миграций); все 7 контейнеров Up; smoke landing/api-health/dashboard×4 **200**; логи saas-api/bridges без 401/token-ошибок (fallback на общий токен работает — новые `VOXLY_TOKEN_*` на проде не заданы).
- Ops (Stage 0 hygiene): `docker image prune -f` −24.82GB (88 dangling); backups 207→14 (451M→25M). Disk `/` **53G→27G used, 67G free (было 42G)**. RAM 9.7G (n8n/baserow ещё живут — по плану будут удалены). Volumes нетронуты, без `down -v`.
- Next: при следующем сплите — задать индивидуальные `VOXLY_TOKEN_*` на разнесённых хостах; удалить n8n/baserow для RAM.



- Goal: urgent — user CRM won't open; suspects low disk.
- Findings: disk **OK** (57G→72G free after prune); CRM/Twenty/API **200**; containers Up; no OOM; volumes untouched. Disk **not** root cause.
- Ops: prophylactic `docker image prune -af` (−14.54GB unused images only). No Twenty recreate, no deploy, no commit.
- Verify: voxly-crm + healthz + GraphQL + api/health **200**.
- Docs: INC-119; CAPACITY snapshot refresh.
- Next: user hard-refresh `https://voxly-crm.getvoxly.ru/` — if still broken, need browser error/screenshot.

### 2026-08-07 — INC-118 GramJS CRM «Код» → visible MessageEntityPre

- Goal: toolbar «Код» visibly monospace in native Telegram (user: code still broken after INC-117; spoiler OK).
- Root cause: INC-117 already sent `MessageEntityCode` (verified on Remont msgs); Cyrillic inline code looks like plain text. Need Pre (grey block).
- Changes: `clientMdToTelegramHtml` maps `` `code` `` → `<pre>`; bridge format log; shared tests. No crm-chat / MAX / WA.
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge` backup `20260807-141203`. max-bridge / wa-worker untouched. Disk ~57G free. Volumes untouched. No commit.
- Verify: msg 36903 `MessageEntityPre` on `monospace_visible`; 36904 Cyrillic; health 200; `hasPre=true` in logs.
- Docs: INC-118; gramjs-crm-sync Last verified.
- Next: user smoke CRM → Код → Telegram grey block.

### 2026-08-07 — INC-117 GramJS CRM spoiler/code + outbound attach

- Goal: spoiler+code apply in native Telegram from CRM; show «Прикрепить» for GramJS like MAX/WA; do not regress MAX/WA.
- Root cause: bridge sent plain text (no entities; GramJS `md` omits spoiler); INC-033 hid `supportsAttachments` for `ai_gramjs` + 400 on fileBuffer.
- Changes: `clientMdToTelegramHtml` + bridge `parseMode:'html'` + `mediaBase64`/`sendFile`; saas-api GramJS media path + attach flag; crm-chat **0.1.29** (channel switch no longer disables MAX attach).
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge,saas-api` backup `20260807-132959`; `refresh-crm-chat` voxly/efim1/art-dekor `{ok:true}`; tarball **0.1.29**. **max-bridge / ai-whatsapp-worker untouched** (uptime older). Disk ~58G free. Volumes untouched. No commit.
- Verify: shared tests green; dist `supportsAttachments: botType !== 'gift_max'`; bridge has `clientMdToTelegramHtml`; health/landing/dashboard **200**. User: hard-refresh CRM → spoiler/code + attach on GramJS; MAX/WA attach when selected.
- Docs: INC-117; `modules/gramjs-crm-sync.md`; CHAT.md; CAPABILITIES; crm-chat-panel Last verified (MAX/WA freeze kept).
- Next: user hard-refresh CRM → GramJS Remont chat smoke.

### 2026-08-07 — Freeze verified MAX + WhatsApp CRM chat (~16:14 MSK)

- Goal: freeze verified MAX+WA chat so agents don’t break it («сохраняй»).
- Changes: **docs only** — `modules/{max-personal,wa-crm-sync,crm-chat-panel}.md` WORKING/FROZEN ~16:14; `modules/README.md`; `CAPABILITIES.md` Verified baseline; `ADDRESS_BOOK.md`; `steps.md` §3/§4; INC-114/115/116 closed note; `.cursor/rules/module-freeze.mdc`. No product code, **no redeploy**, no commit.
- Verify: user confirmed MAX chat + WhatsApp chat both work as expected.
- Broken: none.
- Next: —

### 2026-08-07 — INC-116 CRM Chat «Нет данных» after crm-chat 0.1.28 refresh

- Goal: restore Chat load ASAP (Remont MAX deal) without wiping volumes / without breaking INC-115 WA previews.
- Root cause: Twenty canvas empty state when `pageLayoutWidget.configuration` lacks `__typename: FrontComponentConfiguration` after `refresh-crm-chat`. DB messages OK; API 200; FC not mounting.
- Changes (prod): SQL patch `__typename` on 18 FRONT_COMPONENT widgets (all tenants); redis flat-map flush; metadataVersion bump; `refresh-crm-chat` voxly once during diagnosis; twenty-server recreate (storage volume kept). Code: `refreshCrmChatAppForTenant` post-install `__typename` patch.
- Kept: crm-chat **0.1.28** + saas-api `findAttachmentContext` (INC-115). max-bridge not touched.
- Backup: tip `20260807-130335` (saas-api harden ship); prior INC-115 `20260807-124124`. Disk ~60G free. Volumes untouched. No commit.
- Verify: API Remont 17 msgs / 2 threads; widget `__typename=FrontComponentConfiguration`; health 200; harden in saas-api dist.
- User: hard-refresh CRM Chat on Remont — must show history again.
- Docs: INC-116; crm-chat-panel Last verified.

### 2026-08-07 — INC-115 CRM WA photo/video paperclip (multi-channel bot mismatch)

- Goal: WA outbound/inbound photo+video previews in CRM chat without touching MAX freeze/bridge.
- Root cause: Person with MAX+WA — media resolve used busiest thread (MAX) → WA fileIds 400. Store types were already correct after INC-114 send fix.
- Changes: `crm-chat.ts` `findAttachmentContext` + resolve/signed-url by owning conversation; WA mime coerce + outbound `externalMessageId`; `ai-whatsapp-worker` fromMe retry + attachment fileId lookup; crm-chat **0.1.28** signed URL for images + extension classify.
- Deploy: `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker` backup `20260807-124124`; refresh-crm-chat voxly. **max-bridge not redeployed.** Disk ~66G free. Volumes untouched. No commit.
- Verify: WA photo/video/inbound media `200` with correct MIME; HTTPS smoke 200; max-bridge still up (pre-deploy uptime).
- User smoke: hard-refresh WA thread `@+79918829870` → jpg preview + mp4 player; MAX thread on same Person still OK; re-send not needed.
- Docs: INC-115; crm-chat-panel Last verified; MAX freeze untouched.

### 2026-08-07 — INC-114 CRM→WA media «Owned media must be a url or base64»

- Goal: restore CRM WhatsApp photo/video outbound without touching MAX freeze.
- Root cause: Evolution `sendMedia` rejects `data:…;base64,…` (`isBase64`/`isURL` both false). Worker was wrapping payload as data-URI. Not caused by MAX crm-chat changes (separate `sendViaWhatsappWorker` → worker → Evolution).
- Changes: `apps/ai-whatsapp-worker` `sendWhatsAppMedia` — pure base64 + mime coerce for image/video when `octet-stream`.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` backup `20260807-122920`. max-bridge/saas-api **not** redeployed. Volumes untouched.
- Verify: container recreated; health/landing/dashboard 200; dist has pure-base64 path.
- Broken: none observed. User: CRM WA photo+video smoke; MAX paths unchanged (freeze intact).
- Docs: INC-114; do not loosen `modules/max-personal.md`.

### 2026-08-07 — INC-113 harden + freeze MAX chat baseline

- Goal: belt-and-suspenders so owner phone/TG cannot land on peer Person again; document MAX chat as WORKING/FROZEN.
- Gaps vs prior INC-113 deploy `20260807-120603`: history sync still called `updatePersonPhone` (overwrite); saas-api had no owner-phone strip (bridge-only); enrich had no `forbidPhones`.
- Changes: `max-phone-guard.ts` + vitest; bridge inbound `selfPhone` + private-dialogs `selfPhone`/`selfMaxUserId`; max-internal/max-chat-sync `stripOwnerPhone`; enrich `forbidPhones`; freeze card + CAPABILITIES/ADDRESS_BOOK/modules README.
- Deploy: `./scripts/prod-deploy.sh saas-api,max-bridge` backup `20260807-121730`. Disk ~68G free. Volumes untouched. No CRM mass-delete (Marina already cleaned).
- Verify: unit test green; prod markers `stripOwnerPhone`/`selfPhone`/`forbidPhones` in saas-api dist + max-bridge; max-bridge session restore + `Attached on_message` for `cmshlhdd60002q6g7f9vydlky` me=`3361844`; smoke HTTPS 200.
- Docs: `modules/max-personal.md` freeze checklist — **do not regress** without explicit user ask.

### 2026-08-07 — INC-113 MAX channel lead + owner enrich leak onto Marina

- Goal: no CRM Person/Opp from MAX channels/bots; stop owner (toxasagmsk) profile leaking onto peer Persons; fix Marina + channel junk.
- Root cause: (1) live inbound did not filter `ChatType.CHANNEL` (history sync already DIALOG-only). (2) skip-me used `client.me.id` but User is on `me.contact` → me CALL/outbound applied owner phone → cross-channel enrich wrote `@toxasagmsk`/about/birthday. (3) DIALOG `chat_id` ≠ peer `user_id` → wrong `/open/max/{chatId}`.
- Changes: max-bridge unwrap/skip channel+self+bot heuristic; `maxUserId`+`chatType` on inbound; saas-api reject negative/non-DIALOG/self; applyMaxProfile fill-empty phone + real userId; max-chat-sync skip negative.
- Cleanup: Marina `ffd4ef82-…` phone `+79150910874`, cleared owner socials, max `28981896`; soft-delete channel Person/Opp `-70340712641969`; `phoneNumberId=3361844`.
- Deploy: `./scripts/prod-deploy.sh saas-api,max-bridge` backup `20260807-120603`. Disk ~70G. Volumes untouched.
- Verify: `profile_from_me` → `3361844`; API skip channel/self; personal DM path unchanged (Conversation key=chat id).
- Next: user hard-refresh CRM; smoke new personal DM → lead; channel message → no new deal.

### 2026-08-07 — INC-112 CRM→MAX outbound video no player (`:out` fileId)

- Goal: outbound MAX video (Reklama.mp4) shows inline `<video>` like inbound; no re-send.
- Changes: max-bridge resolve `max:…:out` via message attaches; extension classify on send; real native id when send result has attaches. saas-api effectiveMime + store type=video for .mp4. Docs: INC-112.
- Prod evidence: ChatMessage `cmsiva0aq000d7a8b28nm47xp` already `type=video` `mimeType=video/mp4` `fileId=max:346581106:117054009613552692:video:out`. Post-deploy `/messages/media` → **200** `video/mp4` ~3.1MB (resolved `video_id=16307919806337`, okcdn 200).
- Deploy: `./scripts/prod-deploy.sh max-bridge,saas-api` backup `20260807-114320`. Disk ~70G free. Volumes untouched. No crm-chat refresh.
- Broken: none. User: hard-refresh CRM — **re-send not needed**.
- Next: user confirms player on 14:34 bubble.

### 2026-08-07 — INC-111 MAX CRM outbound «Token has expired»

- Goal: restore CRM→MAX outbound after PDF error «Token has expired» / all send broken.
- Diagnosis: no matching send failure in max-bridge around 13:47 MSK; session live (`sessions=1`); pre-fix probe text+PDF **200**. Likely transient MAX/PyMax auth glitch surfaced as raw English error; not INC-110 UA.
- Changes: bridge drop+restore once on session-auth send errors + RU 401; saas-api humanize → same RU re-QR hint.
- Verify: post-deploy restore `cmshlhdd60002q6g7f9vydlky` + `Attached on_message`; text+PDF `/messages/send` **200** to peer `346581106`.
- Deploy: `./scripts/prod-deploy.sh max-bridge,saas-api` backup `20260807-105343`. Disk ~60G free. Volumes untouched.
- Broken: none observed. User: hard-refresh CRM → retry; re-QR only if RU session message returns.
- Next: watch if auth errors recur under read/media load; optional debounce MAX `/messages/read` spam.

### 2026-08-07 — INC-110 MAX regular video okcdn 400 (Chrome UA)

- Goal: regular MAX video file shows inline player in CRM (not only «скачать»).
- Changes: max-bridge `_http_get_bytes` → Chrome User-Agent (okcdn `srcAg=CHROME`); no Origin. Docs: INC-110 + `modules/max-personal.md`.
- Verify: prod `/messages/media` regular video + circle + voice + sticker + PDF → all **200**; okcdn GET **200**.
- Deploy: `./scripts/prod-deploy.sh max-bridge` backup `20260807-101651`. Disk ~61G free. Volumes untouched.
- Broken: none expected (classification already `video`).
- Next: user hard-refresh CRM chat on «Ремонт Инструмент» → inline `<video>` for 13:09 bubble.

### 2026-08-07 — INC-109 MAX media/read/attach + TG peer from MAX card

- Goal: MAX inbound media in CRM; attach outbound; read receipts; fix TG send peer when contact came from MAX (phone/@username).
- Changes:
  - max-bridge: extract `attaches` → inbound attachments; `/messages/media` download; `/messages/read` via PyMax `read_message`; send Photo/File/Voice/Video; history export attachments.
  - saas-api: inbound store attachments; `supportsAttachments` for `ai_max`; `fireMaxPresence` read; `resolveOutboundPeer` same-channel only (no MAX id→GramJS); phoneE164 + username to GramJS; max-chat-sync backfill `[сообщение]`.
  - gramjs-bridge: username `getEntity` + ImportContacts phone wins on id mismatch.
  - Docs: INC-109 + CAPABILITIES + `modules/max-personal.md`.
- Verify: smoke checklist in deliverable; typing unsupported (no PyMax send-typing API).
- Deploy: `./scripts/prod-deploy.sh max-bridge,saas-api,gramjs-bridge` backup `20260807-085850`; follow-up `--skip-backup` for messageId string/int read fix.
- Broken: outbound typing in native MAX app still N/A; old `[сообщение]` need re-send or history sync backfill (corrupted snowflake ids from pre-fix JSON numbers).
- Next: user smoke Remont_toua MAX media + TG send.

### 2026-08-07 — INC-108 MAX live inbound handler arity (max-bridge)

- Goal: diagnose why live MAX DM → no CRM Person/Opp; fix if tiny+safe.
- Changes: `max-bridge` `_listen_inbound.on_msg(message, event_client=None)` (PyMax 2.4 `callback(event, client)`); skip self by `sender == me.id`; log `inbound forwarded`. Docs: INC-108 + `modules/max-personal.md`.
- Verify (prod): before — 0 Conv/Msg for `cmshlhdd60002q6g7f9vydlky`, TypeError on every inbound; after deploy — session restored + `Attached on_message()`; await user DM smoke for Person/Opp.
- Deploy: `./scripts/prod-deploy.sh max-bridge` backup `20260807-083628`. Smoke landing/api/health 200. Disk 66G free.
- Broken: empty `phoneNumberId` → UI «появится после скана» despite restore `profile=3361844` (separate cosmetic).
- Next: user sends test DM to connected MAX → expect deal `· MAX · …`.

### 2026-08-07 — Disable auto history sync on connect (MAX / GramJS / WA)

- Goal: connecting MAX/GramJS/WA accounts must **not** start CRM history sync; sync only via portal «Синхронизировать».
- Changes:
  - MAX portal: removed auto `POST …/sync-history` on QR `authorized` (`dashboard/ai/max/page.tsx`); keep `loadAccounts` + manual button.
  - GramJS: `/api/internal/gramjs/connected` ack-only (no `enqueueGramjsCrmEnrich`); bridge `notifySaasCrmEnrichOnConnect` skip log; manual `POST …/sync-history` + admin enqueue unchanged.
  - WA: removed `scheduleWhatsAppHistorySync` from QR open + `CONNECTION_UPDATE`; `/internal/crm/sync-history` button path intact; inbound live messages unchanged.
  - Docs: CAPABILITIES + `modules/{max-personal,gramjs-crm-sync,wa-crm-sync}.md` + steps timeline.
- Verify: connect account → no «Синхронизация…» until button; button still 202/polls; inbound messages still create ChatMessage.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal,gramjs-bridge,ai-whatsapp-worker` → smoke landing/api/health/dashboard AI pages **200**; containers Up. Note: `saas-portal` rsync also shipped local Friendly LP homepage work if present.
- Broken: none expected (live inbound paths untouched).
- Next: user smoke — connect MAX/GramJS/WA without sync badge; press «Синхронизировать» once.

### 2026-08-07 — Pricing calculator UI polish

- Goal: make landing calculator visually stronger (not a dense checkbox list).
- Changes: two-column layout (config + dark summary), grouped cards (channels qty grid + automation toggles), seat chips, sticky-feel total panel.
- Deploy: `saas-portal` --skip-backup. Smoke OK.
- Next: none.

### 2026-08-07 — Pricing calc qty for TG/WA/MAX/gift

- Goal: personal channels + gift bot can be several units, not checkbox-only.
- Changes: `pricing-calculator.tsx` QtyRow (−/+) ×1…10; totals multiply unit price.
- Deploy: `saas-portal` --skip-backup. Smoke OK.
- Next: none.

### 2026-08-07 — Landing pricing calculator ← admin platform prices

- Goal: correct modular calculator; CRM 600/10 seats; pull live prices from admin PlatformSetting.
- Changes: `GET /api/pricing/catalog` (public); calculator toggles TG/WA/MAX/gift/secretary(+extra)/mailing/stories; shared `CRM_BASE_MONTHLY` 500→600; `loadPlatformPrices` reads `subscription_seats_included`.
- Deploy: `prod-deploy.sh --skip-backup saas-api,saas-portal`. Smoke OK.
- Verify: `GET /api/pricing/catalog` → crm_base **600**, seats 10; landing shows CRM от 600 + module toggles.
- Next: none.

### 2026-08-07 — OG logo + auth pages match Friendly LP

- Goal: messenger preview without robot; `/login` `/register` same style as `/`.
- Changes: `opengraph-image.tsx` / `twitter-image.tsx` / `icon.tsx` (wordmark V); `AuthShell`; restyle login/register (no amber/mascot); layout OG title updated.
- Deploy: `prod-deploy.sh --skip-backup saas-portal`. Smoke OK.
- Verify: `/opengraph-image` 200; login/register have `friendly-lp`, no mascot. Telegram may cache old preview until refresh.
- Next: if TG still shows robot — wait cache or use t.me link debug / share with `?v=2`.

### 2026-08-07 — Deploy hero copy tweak (Friendly LP)

- Goal: H1/subhero Max+соцсети/ФИО/ДР on live `/`.
- Ops: `./scripts/prod-deploy.sh --skip-backup saas-portal`. Smoke OK.
- Verify: getvoxly.ru HTML has «Все Ваши клиенты… Max…» + соцсети/ФИО copy.
- Next: none.

### 2026-08-07 — Deploy Friendly LP homepage (`saas-portal`)

- Goal: ship promoted Friendly LP to getvoxly.ru.
- Ops: `./scripts/prod-deploy.sh saas-portal` (1st SSH mid-build cut); retry `--skip-backup` OK. Backup from first run: `/opt/voxly/backups/20260807-082346/`. Disk 66G free. Volumes untouched.
- Verify: `https://getvoxly.ru/` 200 + friendly copy; `/lp/friendly` → `/`; api health 200; dashboard smoke 200.
- Broken: none lasting (transient 502 during portal restart).
- Next: none for this surface.

### 2026-08-07 — Promote Friendly LP to `/` (archive v3)

- Goal: make friendly LP the homepage; keep previous without delete.
- Changes: archive Awwwards v3 → `app/_archive/landing-v3/`; `/` renders `FriendlyLanding`; `/lp/friendly` redirects to `/` (+ref); layout metadata updated; design lock → `landing-friendly.md`.
- Verify: local `/` 200 + hero copy; `/lp/friendly` → `/`.
- Broken: none.
- Next: deploy `saas-portal` when user asks.

### 2026-08-07 — Friendly LP draft `/lp/friendly` (not homepage)

- Goal: new conversion LP for non-tech owners (prompt); keep live `/` until user approves swap.
- Changes: `app/lp/friendly/page.tsx` + `components/landing/friendly/{friendly-landing,phone-demo,pricing-calculator,referral-calculator,custom-dev-cta,gift-widget}.tsx`; scoped `.friendly-lp` CSS in `globals.css`. Pricing uses `@voxly/shared` (500/300/10 seats; stories+gift optional +500). Referral 20% preview @ ~3000 ARPU. Custom-dev → mailto sheet. `robots: noindex`.
- Verify: local `http://127.0.0.1:3011/lp/friendly` 200; hero/calc/FAQ present; tsc OK. `/` untouched.
- Broken: none.
- Next: user review → if OK, promote to `/` (archive v3) + deploy `saas-portal`.

### 2026-08-07 — Prod Stage-0 disk prune (no volumes)

- Goal: free disk after CAPACITY showed 97% / 3.2G avail (INC-052/092 pattern).
- Ops (readonly-safe): journal vacuum 160MB; `docker container prune -f` 882MB; `docker image prune -af` **66.87GB**. **No** volume prune / no `down -v`.
- Verify: `df` 24% / **72G free**; PG control+twenty healthy; api+portal **200**; critical containers Up.
- Next: merge product PR only if user wants; agent-memory docs still local uncommitted.

### 2026-08-07 — Agent memory: Address Book + Risk Gate + Capacity

- Goal: sustainable project memory for any agent — lookup, freeze, risk-before-code, prod VPS capacity (no parallel docs tree).
- Changes (docs/rules only):
  - `docs/agent/ADDRESS_BOOK.md` — topic→docs/code/freeze/risk index (incl. capacity + ENOSPC).
  - `docs/agent/RISK_GATE.md` — mandatory pre-code checklist (new vs existing, backfill, infra).
  - `docs/agent/CAPACITY.md` — prod facts 2026-08-07: 6 vCPU / ~10G RAM / 99G disk **3.2G free (97%)**; 3 tenants; automation (n8n/baserow) co-hosted; bands + scaling playbook.
  - `docs/agent/modules/cross-channel-enrich.md` + index row; wire README / CAPABILITIES new-vs-existing note.
  - Rules: `.cursor/rules/agent-memory-gate.mdc` (alwaysApply); `project-state.mdc` cascade updated.
- Verify: files present; SSH capacity snapshot recorded (not STALE).
- Broken / ops: prod disk already danger — Stage 0 prune before next heavy deploy.
- Next: optional commit; ops prune images on prod if deploying soon.

### 2026-08-06 — Opp chat activity sort + MAX enrich finish

- Goal: Kanban «Последнее обновление» follows chat; MAX on toxasagmsk (+79150946944); ship for all tenants; push GitHub.
- Changes:
  - `TwentyClient.touchOpportunityActivity` + live bumps (WA/TG/MAX sync, crm-chat reply).
  - Admin `POST /api/admin/tenants/:id/sync-opportunity-chat-activity` + platform `/api/admin/sync-opportunity-chat-activity` (SQL `updatedAt` from max ChatMessage).
  - MAX: by-phone `me` fallback (own phone); `get_user` for link; `maxOpenLink` + `GET /open/max/:userId` when no public max.ru; applyMaxProfile(userId).
- Ops: sync activity all tenants → voxly updated 5 (688 already newer); Anton Person MAX enriched (`fields: max,name`); open/max/3361844 **200**.
- Deploy: backups `20260806-163110` (+ later max-bridge/saas-api); services saas-api, WA/TG workers, max-bridge.
- Next: user hard-refresh Kanban + Person MAX; git push.

### 2026-08-06 — Symmetric cross-channel enrich (site / TG / MAX / WA)

- Goal: User «делай» — same phone enrich from all lead sources (not only WA hub).
- Changes:
  - `enrichPersonCrossChannelByPhone` + `enrichOnePersonWhatsappByPhone` (saas-api); WA worker `POST /internal/crm/check-on-whatsapp` (Evolution IsOnWhatsApp).
  - Wire: form-lead (TG+MAX+WA); max-internal + max-chat-sync (TG+WA); gramjs-chat-sync (MAX+WA); ai-telegram-worker + gift phone-share → `POST /api/internal/crm/enrich-by-phone`; admin channels include `whatsapp`.
  - Compose: `SAAS_API_URL` on ai-telegram-worker + gift-bot-worker.
- Contract: never invent t.me/+/max.ru/+; wa.me only when IsOnWhatsApp `exists`.
- Deploy: backup `/opt/voxly/backups/20260806-160936/`; services saas-api + WA/TG/gift + compose; smoke 200.
- Verify: site lead with phone → TG/MAX/WA fields when sessions connected; TG with phone → wa.me; MAX with phone → TG link.
- Next: Opp chat-activity sort + MAX backfill (this session).

### 2026-08-06 — Finish MAX cross-channel on prod voxly (INC-107)

- Goal: User «доделывай» — finish MAX under WhatsApp + WA→MAX enrich + inbound phone merge on prod tenant `voxly`.
- Verified (already on images from backup `20260806-152806`): worker `enrichMaxPresenceFromPhone`; max-bridge inbound `get_user`/`maxLink`; saas-api `syncMaxLeadToCrm` `findPersonByPhone`+`applyMaxProfile`; twenty-client order Telegram→WhatsApp→MAX. **No redeploy** of those services.
- Ops: superadmin JWT via `POST /api/auth/login` (not service token) → `reapply-crm-defaults` **200** but view layout unchanged (INC-107). Fixed with SQL Social order + redis flush + recreate `twenty-server`/`twenty-worker` (volumes untouched). GraphQL after restart: max pos 3 under whatsapp.
- Code: `movePersonFieldsToSocialGroup` catch now warns (INC-107).
- Broken / gaps: TG→WA IsOnWhatsApp still absent; GraphQL reapply alone insufficient for social layout when Twenty flat-maps drift.
- Next: user hard-refresh Person → Social shows MAX under WhatsApp; smoke WA msg → MAX enrich; MAX inbound → same Opp by phone.

### 2026-08-06 — MAX by-phone enrich (PyMax search_by_phone)

- Goal: Study PyMax; wire MAX enrich by phone into contact enrichment; confirm history sync live; deploy MAX-related only.
- PyMax (prod maxapi-python **2.3.1**): `search_by_phone`, `import_contacts`, `get_user`/`fetch_users`, `fetch_chats`/`fetch_history`, User `names`/`link`/`phone`/`description`. **No birthday** on User. Docs: github.com/MaxApiTeam/PyMax + docs.pymax.org.
- Changes: max-bridge `POST /users/by-phone` (search → import_contacts fallback; never invent max.ru/+phone); private-dialogs returns `link`; twenty-client Person.`max` LINKS + `applyMaxProfile`; admin `enrich-persons-by-phone` also tries MAX when `ai_max` connected (`channels`, `maxBotId`); max-chat-sync writes max link/name on sync. History sync already on prod (SHAs matched before this ship).
- Deploy: backup `/opt/voxly/backups/20260806-150447/` (first attempt rsync mid-fail; finished with `--skip-backup`); `./scripts/prod-deploy.sh max-bridge,saas-api,saas-portal`. Volumes untouched. Frozen WA/TG/gift/AI/secretary not rebuilt.
- Verify: bridge health + `/users/by-phone` in container; saas-api dist has `enrichOnePersonMaxByPhone` + `applyMaxProfile`; smoke landing/API/dashboard 200; max-bridge sessions=1 after recreate.
- Broken: birthday N/A; TG→WA IsOnWhatsApp still absent; privacy may hide phone search.
- Next: user smoke enrich on known MAX phone; optional bump maxapi-python 2.4.0 later.

### 2026-08-06 — INC-106: WA→TG enrich maximize Person (noname98 / Оксана)

- Goal: WA deals with phone must enrich Telegram name/links/birthday; never invent `t.me/+phone`; fix noname98.
- Diagnosis (prod): ImportContacts `userId=6392903179` exists; GetFullUser = **Оксана Шамсутдинова**; Person telegram empty + name `noname98`. Root: (1) scrape `t.me/+phone` error-page early-return discarded known userId; (2) ImportContacts overlays User.firstName with probe `Voxly`/`Check` until DeleteContacts — must GetFullUser **after** cleanup.
- Changes: WA `enrichTelegramPresenceFromPhone` skip scrape when userId known; gramjs `/users/by-phone` DeleteContacts→GetFullUser; `isPlaceholderPersonName` + guarded `applyTelegramProfile`; admin `enrich-persons-by-phone` (prefer wa.me E.164 over truncated phones); gramjs-chat-sync applies dialog profile on phone match. MAX phone-search skipped (no safe PyMax API).
- Deploy: backups `/opt/voxly/backups/20260806-143720/` then redeploy gramjs+saas-api; services `gramjs-bridge,ai-whatsapp-worker,saas-api`. Volumes untouched. Frozen chat/gift/AI/secretary not rebuilt.
- Verify (prod): Person `8355ea0d-…` → **Оксана Шамсутдинова** + `https://api.getvoxly.ru/open/tg/6392903179` + `wa.me/77784112019`; by-phone returns real ФИО; backfill 15 → enriched 7. Smoke landing/API 200.
- Broken: TG→WA IsOnWhatsApp still absent; MAX by-phone N/A; some Twenty phones truncated vs wa.me (backfill prefers wa.me).
- Next: user hard-refresh CRM; optional larger backfill.

### 2026-08-06 — MAX personal history sync → CRM deals

- Goal: Like WA/GramJS — sync private MAX dialogs into CRM with Person+Opp + dupe reuse.
- Changes: `max-bridge` `POST /crm/private-dialogs` (DIALOG only); `max-chat-sync.ts`; `POST …/max/…/sync-history` (202 + historySyncing); portal sync button + auto after authorize; inbound Opp reuse via `findOpenOpportunityByPerson`. Docs: CAPABILITIES/CHAT/modules/max-personal.
- Deploy: backup `/opt/voxly/backups/20260806-150044/`; `./scripts/prod-deploy.sh max-bridge,saas-api,saas-portal` + no-cache recreate max-bridge. Frozen WA/TG/gift/AI/secretary untouched.
- Verify: bridge has `/crm/private-dialogs`; saas-api `runMaxPrivateChatSync`; smoke landing/API 200. User: hard-refresh → Синхронизировать → deals `· MAX ·`.
- Next: user smoke on account `915`; media Phase 3 later.

### 2026-08-06 — MAX under WhatsApp + WA→MAX enrich + MAX inbound phone merge

- Goal: Person social shows MAX under WhatsApp; WA inbound enriches MAX; MAX message joins same deal by phone.
- Changes: `movePersonFieldsToSocialGroup` force order Telegram→WhatsApp→MAX; WA `enrichMaxPresenceFromPhone`; max-bridge inbound `get_user` phone/link; `syncMaxLeadToCrm` `findPersonByPhone` + `applyMaxProfile`.
- Deploy: `saas-api,ai-whatsapp-worker,max-bridge` (+ reapply CRM defaults for max field view). Volumes untouched.
- Verify: hard-refresh Person → MAX row under WhatsApp; WA msg → TG+MAX enrich; MAX msg → same Opp.

### 2026-08-06 — INC-105: MAX upsert 400 `maxUserId` null

- Goal: `/dashboard/ai/max` after QR must not land on Ошибка Zod `maxUserId` null.
- Changes: `max-internal` `maxUserId: z.string().nullish()`; `max-bridge` `resolve_me` retry + always send string. Docs INC-105 + module card.
- Deploy: backup `/opt/voxly/backups/20260806-140626/`; `./scripts/prod-deploy.sh saas-api,max-bridge` (dry-run first). Cleared `pending-*` only. Volumes untouched. Did **not** rebuild gift/WA/GramJS/AI workers/portal.
- Verify: host+container markers `nullish` / `resolve_me`; smoke landing/API/dashboard 200. User: hard-refresh → QR → Подключено.
- Next: live user smoke QR→CRM inbound.

### 2026-08-06 — INC-104: MAX QR stuck on «Проверяем пароль…»

- Goal: `/dashboard/ai/max` login completes after 2FA (or shows clear error); diagnose prod hang.
- Diagnosis: PyMax `start()` never returns → bridge never upserted/`authorized`; wrong 2FA re-prompted without UI error; stale pending session → `FAIL_LOGIN_TOKEN` / 400 password.
- Changes: `apps/max-bridge` — `on_start`/`wait_client_ready`, wipe pending, RU password errors + hint; portal MAX page — bridge `detail`, hint, 90s processing tip. Docs: INC-104, module card `max-personal.md`.
- Deploy: backup `/opt/voxly/backups/20260806-135432/`; `./scripts/prod-deploy.sh max-bridge,saas-portal` (dry-run first). Cleared `/data/max-sessions/pending-*`. Volumes untouched. Did **not** rebuild gift/WA/GramJS/AI workers/saas-api.
- Verify: health max-bridge ok; `/dashboard/ai/max` 200; code markers `wait_client_ready` in container. User: hard-refresh → QR → 2FA → «Подключено».
- Broken: none observed. Next: live user smoke QR→CRM inbound.

### 2026-08-06 — Freeze WORKING baseline (chats / WA / TG / gift / AI / secretary)

- Goal: Lock in user-confirmed working surfaces so future module work does not regress them («все остальное сохрани»).
- Changes: **docs/rules only** — `docs/agent/modules/` cards (+ new `ai-agent.md`, `telegram-secretary.md`); index Status **WORKING / FROZEN baseline 2026-08-06**; `CAPABILITIES.md` Verified baseline section; `steps.md` §4; strengthen `.cursor/rules/module-freeze.mdc`. No product code, no deploy.
- Verify: user-confirmed 2026-08-06; PR #1 already on main as `263e4ef`; prod tip backup `20260806-132913` (+ INC-103 `20260806-125415`).
- Broken: none.
- Next: other modules without regressing freeze; always read card + run smoke before/after edits to frozen surfaces.

### 2026-08-06 — Tip redeploy + PR for feature/getvoxlybot-otp-live-robokassa

- Goal: GitHub auth restored → open PR; ship tip `cb36ecf` to prod so CRM/TG/WA/portal match branch.
- Git: branch `feature/getvoxlybot-otp-live-robokassa` already at origin tip; no product commit (left untracked `.cursor/skills/*`, design dumps, `docker-compose.override.yml`).
- PR: https://github.com/toxasag/voxly/pull/1 (base `main`; created via GitHub API — `gh` CLI lacks `read:org` on the git credential PAT).
- Pre-check: `prod-diff` hot files matched; extended shas for open-tg/gramjs/workers/portal bots/crm-chat also matched. Redeployed anyway so images bake tip.
- Deploy: backup `/opt/voxly/backups/20260806-132913/` (`voxly_control.dump`, `twenty.dump`); `./scripts/prod-deploy.sh --dry-run` then `./scripts/prod-deploy.sh saas-api,saas-portal,gramjs-bridge,ai-whatsapp-worker,ai-telegram-worker,gift-bot-worker`. Prisma migrate deploy ran. Volumes untouched. No evolution-api.
- Smoke: landing/API health/dashboard partners|crm|ai|agents **200**; `GET /open/tg/928954961` **200** with `tg://user?id=928954961`.
- crm-chat: still **0.1.27** (no tarball bump) — skipped `refresh-crm-chat` (already ok earlier today for voxly).
- Not deployed: `evolution-api` (sessions), `max-bridge`, `twenty` image, `manager/platform-bot` — not required for this tip ship.
- Broken: none. Next: merge PR when ready; user smoke Кувалдин GramJS send.

### 2026-08-06 — INC-103: GramJS send when Person has TG userId (Кувалдин) + module freeze

- Goal: Кувалдин Chat — GramJS «Пишем от» was greyed despite Telegram `tg://user?id=928954961`; enable send without requiring prior GramJS Conversation; freeze working modules in docs.
- Diagnosis: `resolveOutboundPeer` ignored Person.telegram LINKS when base thread is WA; open/tg ≠ send peer.
- Changes: `parseTelegramPeerFromLink` + Twenty Person telegram/phone resolve; GramJS available from social peer; bridge send ImportContacts(phone, keepContact); gift gate unchanged. `docs/agent/modules/*` + `.cursor/rules/module-freeze.mdc`.
- Deploy: backup `/opt/voxly/backups/20260806-125415/`; `./scripts/prod-deploy.sh saas-api,gramjs-bridge` (dry-run first); smoke portal+API **200**. Volumes untouched.
- Verify: hard-refresh Кувалдин → GramJS selectable → send test; `curl` open/tg + health 200.
- Broken: none. Next: user smoke on voxly-crm Кувалдин.

### 2026-08-06 — INC-102: open Telegram without @username (tg:// via HTTPS bridge)

- Goal: Person/chat peers without public `@nickname` (e.g. `7083659060`, Кувалдин userId `928954961`) get a working open-in-Telegram link; never invent `t.me/+phone`.
- Diagnosis: Twenty Zod accepts `tg://`, but front `ensureAbsoluteUrl` mangles it → not clickable in LINKS.
- Changes: `telegramOpenLink` + `GET /open/tg/:userId` HTML→`tg://user?id=`; sync/enrich (gramjs/TG/WA/gift); admin `backfill-telegram-open-links`; migrate keeps tg:// label on bridge URL.
- Deploy: backup `/opt/voxly/backups/20260806-123456/`; `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker,ai-telegram-worker,gift-bot-worker`; smoke landing+health+cabinet **200**. Volumes untouched. No commit.
- Backfill voxly: scanned 464, updated **162** (skipped 302 with `@username`); peer `7083659060` → Person `8585f25c-…` url `/open/tg/7083659060` label `tg://user?id=7083659060`; Кувалдин `e5658d44-…` → `/open/tg/928954961` + WA `wa.me/79850868825`.
- Verify: `curl https://api.getvoxly.ru/open/tg/928954961` → 200 HTML with `tg://user?id=928954961`; hard-refresh CRM Person cards.
- Broken: none. Next: user hard-refresh voxly-crm; other tenants optional backfill.

### 2026-08-06 — INC-101: social LINKS show full URL + Кувалдин WA→TG honesty

- Goal: (A) LINKS pills show full clickable URL text, not "WhatsApp"/"Telegram"; (B) diagnose empty Telegram on Кувалдин `+79850868825`; (C) check Opp 399/400.
- Diagnosis: `primaryLinkLabel` was generic; Twenty renders label as button text. Кувалдин Person `e5658d44-…` WA `https://wa.me/79850868825`; GramJS by-phone exists userId `928954961` without `@username`; scrape `t.me/+phone` is not a profile — correctly leave Telegram empty (never invent `t.me/+`). Opp 399 (Ольга) ≠ 400 (Кувалдин).
- Changes: `twenty-client.linksInput` label=URL; `migrate-social-links` backfill label=url + clear `t.me/+`; admin reapply calls migrate.
- Deploy: backup `/opt/voxly/backups/20260806-102034/`; `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker,ai-telegram-worker` (container-name conflict cleaned, no `-v`); migrate voxly → 196 WA + 321 TG labels=URL. Volumes untouched. No commit.
- Verify: hard-refresh CRM → Анна `https://t.me/Ann_fire`, WA contacts show `https://wa.me/…`; Кувалдин Telegram empty by design.

### 2026-08-06 — Bug A/B: WA duplicate Opportunities + Person social LINKS

- Goal: (A) one Person must not get two WA Opportunities from sync (noname100 evidence); (B) «Социальные сети» must be clickable links (`wa.me` / `t.me/@user`, never `t.me/+phone`).
- Diagnosis (prod noname100): Person `14bc46de-…`, phones `+6281351989740`; two open Opps created **223ms** apart (`171` orphan, `352` linked to Conversation `cmsh8xu5a…`). Race: parallel LID/PN (or dual sync) created two Opps before reuse; twin merge left orphan Opp on same Person. Social fields were **TEXT** → gray plain values.
- Changes:
  - `ai-whatsapp-worker` / `ai-telegram-worker`: before `createOpportunity` → `findOpenOpportunityByPerson`; after LID↔PN merge → `softDeleteOpportunity` orphans.
  - `crm-deal-dedupe`: collapse multiple open Opps on same Person (keep Conversation-linked).
  - `twenty-client`: social fields as **LINKS** + `socialFieldToUrl` writers; `softDeleteOpportunity` / `listOpenOpportunityIdsByPerson`.
  - `migrate-social-links.ts`: TEXT→LINKS + backfill URLs (no invent `t.me/+`).
- Deploy: rebuild `saas-api` + `ai-whatsapp-worker` + `ai-telegram-worker` (rsync + compose `--build`); Twenty restart for metadata cache. Volumes untouched. No commit.
- Prod repair (voxly): soft-deleted orphan `4eb97672-…` (171); bulk collapsed **67** leftover WA dup Opps → **0** Persons with >1 open `· WA ·` opp; migrated 8 social fields to LINKS; noname100 `whatsappPrimaryLinkUrl=https://wa.me/6281351989740`.
- Verify: hard-refresh Person noname100 → one Opportunity; WhatsApp clickable; new WA sync does not create second open Opp for same Person+bot.
- Prior (same day): gift/WA «Пишем от» + save-time dedupe 0.1.27 still stand (backup `20260806-093403`).

### 2026-08-06 — Save-time CRM dedupe + «Пишем от» gift/WA gating

- Goal: (1) honest answers on post-resync dupe/WA↔TG checks; (2) gift bot must not appear in «Пишем от» for GramJS peers not subscribed; (3) WA send from TG deal when Person.whatsapp filled; (4) **duplicate check on every Opportunity save** (incl. contact/company changes).
- Diagnosis:
  - Sync-time Person dedupe (`findPersonByPhone` / hint) exists; soft-merge on GramJS **connect/enrich** only — **manual sync-history does not** run enrich. Prod: **0** soft-merge notes after wipe+resync; no `gramjs-crm-enrich` in saas-api logs.
  - WA→TG presence exists in WA worker after phone resolve; **TG→WA IsOnWhatsApp fill does not exist**.
  - `resolveOutboundPeer` treated gift like GramJS (any TG peer → gift available).
  - WA send required existing WA Conversation; ignored filled Person.whatsapp.
  - **No** save-time Opportunity/Person dedupe hooks before this change.
- Changes:
  - `crm-chat.ts`: gift/gift_max only if GiftSubscriber/conv on **that** bot (hide otherwise); WA fallback via Twenty `Person.whatsapp` (no invent from phones alone).
  - `crm-deal-dedupe.ts` + `POST /api/crm/chat/dedupe`; soft-merge People by phone/whatsapp + retarget Opportunities; shared by GramJS enrich.
  - crm-chat **0.1.27** LFs: `opportunity.created` / `opportunity.updated` / `person.updated` (phones/whatsapp) → dedupe API.
- Deploy: backup `/opt/voxly/backups/20260806-093403/`; rebuild `saas-api` (code already rsynced); `refresh-crm-chat` voxly `{ok:true}`. Smoke health **200**. Dedupe smoke `{ok:true,skipped:true,reason:no_phone_or_whatsapp}` on sample opp. Volumes untouched. No commit.
- Verify: GramJS deal without gift sub → «Пишем от» has no gift bot; Person with WhatsApp filled → WA option available; save deal with phone → soft-merge if duplicate Person exists.
- Not done: TG→WA IsOnWhatsApp backfill; Company entity merge; hard-delete loser People; other tenants refresh (only voxly).

### 2026-08-06 — CRM chat UI: stale `[media]` after GramJS backfill (voxly-crm-chat 0.1.26)

- Goal: `@kahlenko` still showed four `[media]` bubbles after DB/API backfill.
- Diagnosis: control DB + `GET /api/crm/chat/2b5879f5-…` already return `[файл: IMG_….JPG]` + `gramjs:149487687:{679..682}`; signed media URL → **200** `image/jpeg` (~8MB). Not an API/bridge auth failure.
- UI root cause: (1) soft-refresh fingerprint used **message ids only** → open Chat kept pre-backfill content; (2) `isMediaPlaceholder` omitted legacy `[media]` so attachment+placeholder could still show bare text.
- Changes (`twenty-app/voxly-crm-chat` **0.1.26**): fingerprint content+attachment `fileId`s; treat `[media]`/`[документ]` as hideable placeholders; document+`image/*` renders via mimeType.
- Deploy: `./scripts/prod-deploy.sh saas-api` backup `/opt/voxly/backups/20260806-090344/`; `refresh-crm-chat` tenant `voxly` `{ok:true}`. Volumes untouched. No commit.
- Verify: hard-refresh `voxly-crm.getvoxly.ru` → Opportunity `@kahlenko · AI · @genadich_agency` → Чат → Aug 23 photos as images (or 📎 filename), not `[media]`.
- Deliberately not touched: gift-bot, WA invent, Contact-book-as-deals, avatar phone match, suppressDealCreation auto, broad re-sync.

### 2026-08-06 — GramJS history sync: media attachments (not bare `[media]`)

- Goal: CRM chat showed `[media]` for TG history (e.g. @kahlenko) — no preview/download.
- Root cause: `exportPrivateDialogsForCrm` set text=`[media]` without attachment; sync skipped `attachments`.
- Changes: bridge exports `attachment` (`gramjs:peer:msgId` + type); `gramjs-chat-sync` stores + **backfills** existing `[media]` rows on re-sync.
- Deploy: `gramjs-bridge,saas-api` backup `/opt/voxly/backups/20260806-084234/`; smoke 200.
- Verify: re-sync `@genadich_agency` → hard-refresh CRM chat → placeholders `[фото]/`[файл:…]` + preview.

### 2026-08-06 — GramJS sync UI: «Синхронизация…» badge + background job

- Goal: portal row stayed «На связи» while TG history sync ran for minutes (nginx/browser timeout cleared busy).
- Changes: `saas-api` `POST …/gramjs/…/sync-history` → **202** background job + `historySyncing` on GET accounts; portal badge **Синхронизация…** + poll 3s until done.
- Deploy: `saas-api,saas-portal` backup `/opt/voxly/backups/20260806-082647/`; smoke 200. No commit.
- Verify: hard-refresh `/dashboard/ai/gramjs` → sync → amber badge until finish; hint above table.

### 2026-08-05 — INC-097 v8.2: profile-index poison + honest 2/14 blocker (prod)

- Goal: fill CRM Phones for remaining **12/14** open `@lid` chats after v8.1 (`findChats` 2/14 `remoteJidAlt`).
- **Prod investigation (instance `wa_cmseeil8m0_9150946944`, bot `79855014040`):**
  - Message.key: **0/14** `remoteJidAlt`/`senderPn` on any LID thread.
  - IsOnWhatsapp: jidOptions = LID only (no PN).
  - `whatsappNumbers(@lid)`: empty; `fetchStatus`/`presence`/`fetchContacts` no mapping.
  - `fetchProfile` / `fetchBusinessProfile` on **unmapped @lid** returns **linked account** business (`wid=79855014040`, `anton@genadich.com`, `team-big.ru`) — not peer profile.
  - Contact book: 1439 PN rows; **0** LID rows match open-chat LIDs; findChats **empty pushName** on all 14.
  - WA UI phone for 12 peers: **not in Evolution** — likely phone address book / WA client `lidMapping` on device, never synced to companion.
- **Worker bugs fixed (v8.2, `ai-whatsapp-worker`):**
  - `collectOpenWaChatPeers`: `remoteJidAlt` on `@lid` → `pnPhones` (was `fetched=0` — candidates empty).
  - `isPoisonedWaLinkedAccountProfile`: strip self-wuid/email/web from unmapped LID `fetchProfile`.
  - `pokeWaLidMappingViaPresence` before resolve (presenceSubscribe best-effort).
  - Profile-index: **no pic-only** match / `rememberLidPhoneMapping` unless email/web hit or `WA_LID_AVATAR_PHONE_MATCH=1` (reverted false Redis maps to `79032692646` during first sync).
- Deploy: `ai-whatsapp-worker` backups `/opt/voxly/backups/20260805-212256/`, `20260805-212636/`; Redis false `lid-mapping-*_reverse` keys **HDEL** (7 peers wrongly → Пашка). No commit.
- Verify: `profile-index fetched=2` (was 0); force sync **57s** → `dialogs=14 peopleSynced=14 mergedTwins=1`; **CRM phone still 2/14**; `findChats` **2/14** `remoteJidAlt` after Redis cleanup.
- **Blocker (honest):** Baileys companion has no LID→PN for 12 historical peers. Phones appear only after inbound `senderPn`/`remoteJidAlt`, user re-opens chat on phone (sync mapping), or outbound message triggering protocol mapping — **cannot invent**.

### 2026-08-05 — INC-097 v8.1: Evolution findChats lidMapping expose (prod)

- Goal: fix Evolution `findChats` returning **0/14** `remoteJidAlt` despite `fetchProfile` working; worker already has `resolveLidPhoneFromEvolution()` — expose PN at Evolution layer.
- Root cause: v8 patch matched `dm(r)` but runtime `whatsapp.baileys.service.mjs` uses `yp(r)`; only dead `main.mjs` got fetchChats patch; controller never enriched.
- Changes: `docker/patch-evolution-lid-pn.cjs` — regex `\w+\(r\)` + `for…of` service patch (75 files) + controller `voxly-lid-pn-ctrl` (150 files); `baileysCache` fallback on fetchProfile. Worker **unchanged**. No commit.
- Deploy: `evolution-api` backup `/opt/voxly/backups/20260805-210810/`; WA **no QR**; build log `fetchChats patches=75 controller=150`.
- Verify: `findChats` **2/14** `remoteJidAlt` (`20774874288269`→`79262625252`, `159004152090810`→`79032692646`). Force sync **39s** → `dialogs=14 peopleSynced=14`. CRM phone **2/14** (`+79262625252` Boomerservice, `+79032692646` Пашка). **12/14** gaps: no Redis/Baileys mapping; profile-index no hit this run.
- Next: phones for remaining peers only when inbound `senderPn`/`remoteJidAlt`, new Redis mapping, or profile-index match — not avatar invent.

### 2026-08-05 — INC-097 v7.1: full force sync on prod (post-deploy verify)

- Goal: backfill Person+Opportunity for all 14 Evolution open private chats on bot `cmsfsbnei00028n4dkn9cgwkq` / tenant `cmseeil8m00073ji1pz62ry1z` after v7.1 OOM fix; confirm worker stable + idempotent re-sync.
- Deploy: **none** (v7.1 already live; backup `/opt/voxly/backups/20260805-153506/`). No hung `prod-deploy.sh`. No commit.
- Force sync (`POST /internal/crm/sync-history`, `force:true`, `messageLimit:500`): **~42s** → `ok=true dialogs=14 peopleSynced=14 messagesUpserted=12 skippedEmptyIdentity=0 skippedNoMessages=0 mergedTwinConversations=0 repairedEmptyLeads=0`; worker **Up**, `OOMKilled=false`, `RestartCount=0`.
- Re-sync (idempotent): **~40s** → `messagesUpserted=0 peopleSynced=14`; Twenty WA opps total **24** rows / **14 distinct** titles (orphans 7–14 + dupes 15/16/18 from prior runs); **14 distinct** opps linked to synced convs — no new dupes on second pass.
- CRM (14 findChats peers): opp titles **`15–28 · WA · 9855014040`**; named: Boomerservice, Polimeroom, АВТОСЕРВИС, Ремонт Реставрация Пластика., Пашка + noname1/2/5–10.
- Boomerservice: **one** open conv `20774874288269` / `+79262625252` / **4 msgs**; Person phones `+79262625252`, Opp **`18 · WA · 9855014040`**.
- Gaps: **10/14** synced convs remain `status=closed` (history sync links CRM but does not reopen closed threads — only **4 open** convs with opp); stale LID twin `noname4` (`75351208272113`, 3 msgs, closed) **not merged** into Boomerservice (`mergedTwinConversations=0`); **10 orphan** WA opps in Twenty unlinked to current open convs; `platformUserId=0` conv (3 msgs) still no opp (system peer skip).

### 2026-08-05 — INC-097 v7.1: full force sync after OOM fix (prod)

- Goal: close gap **14 open findChats vs ~4–5 live Opportunities** on bot `cmsfsbnei00028n4dkn9cgwkq` / tenant `cmseeil8m00073ji1pz62ry1z` — run **full** force sync (not `repairOnly`) via `POST /internal/crm/sync-history` `force:true` `messageLimit:500`.
- Pre: no hung local `prod-deploy`; worker **Up** `oom=false` (v7.1 backup `20260805-153506/`). Baseline: **5** open WA convs with msgs, **408** open total (contact-book legacy), **24** live Twenty opps (`15–28 · WA · 9855014040`, seq **18–27 duplicated**), **4** open convs CRM-linked. Boomerservice `cmsfuzk8q004t9gwm4piiqywh` LID `20774874288269` / `+79262625252` / **4 msgs** / opp `28 · WA · 9855014040`.
- Sync JSON (**40s**, no OOM): `ok=true dialogs=14 messagesUpserted=0 peopleSynced=14 skippedGroups=1 skippedNoMessages=0 skippedEmptyIdentity=0 repairedEmptyLeads=0 mergedTwinConversations=0`. Worker log: `profile-index fetched=0 byPic=373`; idempotent re-run **40s** → identical JSON.
- Post: **14** distinct `twentyOpportunityId` on WA convs (4 **open**+msgs, 10 **closed**+1 msg each from Evolution LID threads); **24** live Twenty opps unchanged (10 duplicate pairs 18–27 — older shells from 10:36/12:17 + 15:39 re-sync); **403** open zero-msg contact-book convs untouched. Open+msgs: noname1 **100**, Пашка **17** `+79032692646`, noname2 **5**, Boomerservice **4**; 1 open conv `platformUserId=0` **3 msgs** no CRM (system skip). Boomerservice **unchanged** phone/4msgs/canonical LID.
- Gaps: CRM UI still shows **~4 open** deals with chat history (10 opp-linked threads are **closed** convs); duplicate opps in Twenty need manual soft-delete or repair pass; Evolution stores minimal history on 10 LID chats (1 msg); PDF/outbound only if Evolution has them.
- Deploy: **none** (sync succeeded on v7.1). Volumes untouched. No commit.

### 2026-08-05 — INC-097 v7.1: scope profile-index + repair to open findChats (prod)

- Goal: fix force sync / `repairOnly` OOM (exit 137) on bot `cmsfsbnei00028n4dkn9cgwkq` — worker walked ~418 contact-book Conversations + bulk Contact PN `fetchProfile`, not ~14 open chats.
- Root cause: v7 `buildWaProfilePnIndex` filled cap from `loadPnCandidatesFromEvolutionDb` Contact table (1400+); `repairWaLidPnSplitConversationsForBot` queried all WA Conversations (take 1000) including INC-097 v2 contact-book shells.
- Changes (`ai-whatsapp-worker`): `collectOpenWaChatPeers` + `fetchOpenWaPrivateChats`; scoped `loadPnCandidatesFromEvolutionDb` (open JIDs only, Contact table opt-in off); profile-index `fetchCap` tied to open-chat count; repair scoped to open peers + convs with messages; `repairOnly` loads findChats first.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backup `/opt/voxly/backups/20260805-153506/` (`voxly_control.dump` 253K, `twenty.dump` 1.6M); force-recreate worker; smoke landing/api/dashboard **200**. Volumes untouched. No commit.
- Verify: `repairOnly` via internal API **12s** → `ok=true dialogs=14 mergedTwinConversations=0 profile-index `fetched=0` (373 Contact CDN pic fp only); worker **Up** (no OOM). Boomerservice conv `20774874288269` / `+79262625252` / **4 msgs**. CRM: 418 legacy open WA convs (contact-book shells, 0 msgs) still in DB but **not** walked; 4 live opps / 5 convs with msgs vs 14 Evolution open chats — run full force sync when ready to backfill remaining threads.

### 2026-08-05 — INC-097 v7: official Evolution LID→PN + LID/PN twin merge (prod)

- Goal: wire Evolution/Baileys LID→PN paths the worker skipped (Message.key `remoteJidAlt`/`senderPn`, Redis `lid-mapping`, `IsOnWhatsapp.jidOptions`, `POST /chat/whatsappNumbers`) before profile-index; merge split LID↔PN Conversations so one thread per peer.
- Changes (`ai-whatsapp-worker`):
  - `resolveLidPhoneFromEvolution()` — ordered chain: Message.key SQL → Redis `lid-mapping-*_reverse` → IsOnWhatsapp cache → `/chat/whatsappNumbers` → Contact book → Chat DB → profile-index last.
  - `mergeWaLidPnTwinConversations` + `repairWaLidPnSplitConversationsForBot` (end of sync + `repairOnly` flag); per-chat merge when phone/LID known; move ChatMessages, keep LID `platformUserId` + `platformUsername` +E.164, close twin.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backup `/opt/voxly/backups/20260805-150848/`; force-recreate worker; smoke landing/api/dashboard **200**. Volumes untouched. No commit. No hung local `prod-deploy.sh` processes.
- Verify (bot `cmsfsbnei00028n4dkn9cgwkq` / tenant `cmseeil8m00073ji1pz62ry1z`): prod image has `mergeWaLidPnTwinConversations` + `repairWaLidPnSplit` (container created 2026-08-05T15:09Z); `prod-diff` shows only minor post-deploy local drift (`extraLidDigits`, merge expansion) — **no redeploy**. Force sync + `repairOnly` triggered; worker OOM/restart under profile-index on 418 contact-book Conversations (timeout before completion). **Boomerservice before/after:** one Conversation `20774874288269` / `+79262625252` / `Boomerservice` / **1 msg** (= Evolution LID inbound; PN jid **0** msgs). `noname4` (`75351208272113`, 3 outbound msgs) is a **separate** Evolution open chat — empty profile, no LID→PN mapping to `+79262625252`; correctly not merged.
- Remaining gaps: full `repairOnly` on prod bot with 400+ contact-book Conversations needs memory/time guard or scoped to open `findChats` only; Evolution still stores no `remoteJidAlt`/`senderPn` on Message keys for this instance; outbound/PDF only if Evolution has them under that LID; ship local `extraLidDigits` merge tweak when next worker deploy.

### 2026-08-05 — INC-097 v6.1: WA LID↔PN Conversation merge (prod)

- Goal: Boomerservice CRM chat showed **1 msg** while Evolution had **3** under stale LID `75351208272113` + **1** inbound under `20774874288269` — split across `noname4` and `Boomerservice` Conversations after v6 profile-index linked phone to wrong twin only.
- Root cause: v6 resolved `+79262625252` on rich LID only; stale LID has outbound-only msgs, no profile/email/pic for profile-index; no Conversation merge — upserts went to separate threads; `platformUserId` flipped LID→PN broke send path.
- Changes (`ai-whatsapp-worker`): `mergeWaLidPnTwinConversations` + `repairWaLidPnSplitConversationsForBot` + `repairOnly` mode; Redis `listLidDigitsMappedToPhone`; stale outbound LID→rich +phone linking in repair; merge in sync loop + `syncLeadToCrm`; keep LID on `platformUserId`, `platformUsername` +E.164.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backup `/opt/voxly/backups/20260805-153229/` (+ interim `151415/`, `152136/`); smoke 200. Volumes untouched. No commit.
- Verify (bot `cmsfsbnei00028n4dkn9cgwkq`): before **1+3 split** (Boomerservice 1 / noname4 3); after canonical **4 msgs**, one open conv `+79262625252` LID `20774874288269`, closed twin `75351208272113`; Person/Opp on canonical. Gaps: duplicate Person `noname4` CRM shell may remain in Twenty until manual merge; PDF/outbound only if Evolution stored; full force sync still heavy (~15 min).

### 2026-08-05 — INC-097 v6: WA profile-index LID→PN + seq deal titles (prod)

- Goal: Boomerservice chat shows `+79262625252` in WA header but CRM had empty phones, 1 msg, wrong title `Boomerservice · WA · 9855014040`; ~4 deals vs ≥14 open chats.
- Root cause: peer `@lid`; Evolution Message often has 1 inbound under LID; `fetchProfile(LID)` shares email/website/pic with `fetchProfile(79262625252)` but LID JSON has no E.164; Contact book lacks PN; Redis `lid-mapping` empty. v5 skipped CRM without phone → Conversation-only.
- Changes (`ai-whatsapp-worker`, `saas-api` proxy):
  - `buildWaProfilePnIndex` + `matchPhoneFromProfileIndex` wired in sync loop; `rememberLidPhoneMapping` on match.
  - `fetchAllEvoMessagesForJid` + LID/PN merge (dedupe by id); default messageLimit **500**.
  - Always `syncLeadToCrm` for chats with messages (`nonameN` if no name); Opportunity `{seq} · WA · {bot.displayName}`; no contact-first title renames.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backup `/opt/voxly/backups/20260805-141016/` (`voxly_control.dump` 253K, `twenty.dump` 1.6M); force-recreate worker; smoke landing/api/dashboard **200**. Volumes untouched. No commit. Killed hung local deploys (PIDs 15278/15279/15408/15409 + sshpass children).
- Verify (bot `cmsfsbnei00028n4dkn9cgwkq` / 79855014040): force sync ~15 min → `dialogs=14 peopleSynced=14 messagesUpserted=0 skippedEmptyIdentity=0 repairedEmptyLeads=0`; live WA opps **14** titles `15–28 · WA · 9855014040`; 14 distinct People/Opps (no dupes per `platformUserId`). Boomerservice Person `+79262625252` phones+whatsapp filled; Opp `28 · WA · 9855014040`; CRM msgs **1** (= Evolution inbound under LID; PN `findMessages` **0**). 4 named + 9 `nonameN` + 1 named-with-phone (Пашка). Gaps: PDF/outbound still missing if Evolution never stored; profile-index ~15 min on force sync (worker may restart under load).

### 2026-08-05 — INC-097 v5: kill «WhatsApp» shells; Conversation-only until E.164

- Goal: after v4 left 14 nameless phone-less CRM cards, stop creating garbage; fill names from business profile where possible; soft-delete the rest; keep chats.
- Root cause (prod Evolution `wa_cmseeil8m0_9150946944`): 14 `@lid` open chats; Message keys **0** `remoteJidAlt`/`senderPn`; Redis peer `lid-mapping` empty; Contact LID rows unlinked — **LID→PN impossible** from Evolution today. Business profile often has email/website/description but **never** phone.
- Changes (`ai-whatsapp-worker`):
  - Never `createPerson(firstName=WhatsApp)` without E.164; history sync CRM only if phone **or** real name.
  - Business profile → name (verifiedName / website host / description); skip punycode `xn--` hosts; rename Opportunity titles.
  - `repairEmptyWaHistoryLeads` soft-deletes live «WhatsApp»+empty-phone Persons/Opps (Conversation+messages kept).
- Verify: force sync → peopleSynced=4 names (Boomerservice, Polimeroom, АВТОСЕРВИС, Ремонт…), phones=**0**, repaired=10, Conversation-only=10, WhatsApp-named live people/opps=0.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backups `/opt/voxly/backups/20260805-105239/` (+ `105544/`, `105823/`); smoke 200. Volumes untouched. No commit.
- Next: phones appear only when Evolution/Baileys exposes LID→PN (inbound twin / lid_mapping) — then re-sync fills Phones + TG @username.

### 2026-08-05 — INC-097 v4: recreate CRM after Twenty wipe (LID open chats)

- Goal: after user deleted all People/Companies/Opportunities, WA «Синхронизировать» created **0** deals — recreate Person+Opportunity for open private chats with messages.
- Root cause: Evolution instance `wa_cmseeil8m0_9150946944` (79855014040) — `findChats` = 14 `@lid` with messages, **no** `remoteJidAlt`/`senderPn`/pushName, Redis `lid-mapping` empty; INC-097 v3 skipped CRM (`emptyIdentity=14`); repair soft-deleted LID chats that had messages. Contact book 1439 PN have names but 0 messages (not dialogs).
- Changes (`ai-whatsapp-worker`):
  - `clearStaleWaConversationCrmIds` before sync (INC-042 wipe path).
  - Open chats **with messages** always call `syncLeadToCrm` (LID-only → `needsReview`); reuse Conversation phone/name cache.
  - `repairEmptyWaHistoryLeads` **only** zero-message shells (never wipe open-chat CRM).
- Verify: force sync → `dialogs=14 peopleSynced=14`; Twenty live people=14 opps=14; Chat msgs linked; companies unchanged (business profile rare).
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` — backup `/opt/voxly/backups/20260805-103459/` (`voxly_control.dump` 245K, `twenty.dump` 1.6M); smoke 200. Volumes untouched. No commit.
- Next: phones/names enrich when Baileys lid-mapping appears; optional portal re-sync is idempotent.

### 2026-08-05 — INC-097 v3: open chats only + no fake t.me/+ + Chat resolve

- Goal: stop Contact-book→100+ deals; never invent Telegram `t.me/+{phone}`; write real `@username` (e.g. `@ShinkevichJu`); open-profile enrich; Chat tab; soft-delete empty contact-only shells.
- Root cause: INC-097 v2 iterated Evolution Contact book as dialogs; scrape treated phone deep-link HTML as TG presence and wrote `https://t.me/+E.164` (TG Desktop: user not found; real users like +79052000305 have `@ShinkevichJu`).
- Changes:
  - `ai-whatsapp-worker`: sync source = `findChats`+`findMessages` only; Contact book enrich only; skip 0-message rows; repair zero-msg CRM shells; `enrichTelegramPresenceFromPhone` → ImportContacts `@username` only → `/users/full` + `applyTelegramProfile` (about/birthday/channel/name; phone only if matches WA E.164); clear false `t.me/+` fields.
  - `gramjs-bridge`: username from `usernames[]` + getEntity; `/users/by-phone` link only `t.me/{user}`; `/users/full` uses same username extract.
  - `saas-api` crm-chat: SQL fallback Opportunity.pointOfContactId; prefer Conversations with messages.
- Verify: sync → peopleSynced ≈ open private chats; `@ShinkevichJu` not `t.me/+79052000305`; empty TG when not found; Chat loads msgs; repairedEmptyLeads clears contact-only.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker,saas-api,gramjs-bridge` — backup `/opt/voxly/backups/20260805-101610/` (`voxly_control.dump` 260K, `twenty.dump` 1.7M); smoke landing/api/health/dashboard **200**. `refresh-crm-chat` voxly+efim1 `{ok:true}`. Volumes untouched. No commit.
- Next: portal «Синхронизировать» (force) on WA — repair clears contact-only + false `t.me/+`; open chats re-sync with `@username` + profile enrich.

### 2026-08-05 — INC-097 v2: WA Contact-book sync + TG phone check + Chat person resolve

- Goal: restore WA private-chat deals after v1 skip-all; rich Person (phone/FIO/website/IG); Telegram presence; fix Chat «Нет данных» for deals linked only by Person (e.g. `@velengurin`).
- Why 0 deals: INC-097 v1 skipped CRM without E.164/name; Evolution chats are LID-only and Contact book was unused as sync source; repair wiped LID leads including named ones.
- Changes:
  - `ai-whatsapp-worker`: preload Contact book; sync PN `@s.whatsapp.net` contacts; LID→PN via book + unique pushName; PN findMessages fallback; repair only empty identity; `enrichTelegramPresenceFromPhone` after syncLead; `GRAMJS_BRIDGE_URL` on worker compose.
  - `gramjs-bridge`: `POST /users/by-phone` (ImportContacts + cleanup).
  - `saas-api` crm-chat + `twenty-client`: Opportunity→pointOfContact → find Conversation by personId; backfill `twentyOpportunityId`.
- Verify: WA «Синхронизировать» → peopleSynced>0 with phones/names; Person.telegram when on TG; Chat tab history for GramJS/WA deals; groups/suppressDealCreation unchanged.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker,saas-api,gramjs-bridge,compose` — backup `/opt/voxly/backups/20260805-095059/`; smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.
- Next: re-sync WA from portal; open `@velengurin` Chat tab.

### 2026-08-05 — Fix WA history sync empty CRM shells (INC-097)

- Goal: stop WhatsApp history sync from creating Person/Opportunity with empty phone/name; repair bad rows; keep chat messages.
- Root cause: Evolution chats are `@lid`-only (no remoteJidAlt); Contact PN book unlinked; syncLead still created «WhatsApp» shells. Title `… · WA · 9855014040` = bot displayName, not peer phone. CRM Chat API OK when linked; empty fields looked like «Нет данных».
- Changes (`ai-whatsapp-worker`):
  - History sync: PN via message extractors + Contact/Chat + Redis `lid-mapping-*_reverse`; skip self/`0@`/groups; skip CRM without E.164 or real name; business profile like inbound; reject `Você` as name.
  - `repairEmptyWaHistoryLeads`: soft-delete empty Twenty Person/Opportunity + clear Conversation CRM ids (msgs kept).
  - Inbound/backfill also try lid_mapping; `EVOLUTION_REDIS_URI` on worker compose.
- Verify (prod bot `cmsfsbnei…`): sync → `peopleSynced=0`, `skippedEmptyIdentity=14`, `repairedEmptyLeads=15` then 0; live empty WhatsApp Persons = 0; 15 convs unlinked, msgs intact.
- Deploy: backup `/opt/voxly/backups/20260805-092457/`; `./scripts/prod-deploy.sh ai-whatsapp-worker,compose` (+ skip-backup follow-ups). Volumes untouched. No commit. GramJS portal untouched.
- Next: phones appear after Evolution LID→PN (inbound / lid_mapping) → re-sync or live message recreates filled leads.

### 2026-08-05 — GramJS manual sync chats button (no QR)

- Goal: mirror WA «Синхронизировать чаты» on `/dashboard/ai/gramjs` — re-import all private dialogs without reconnect QR.
- Changes:
  - `saas-api` `POST /api/bots/gramjs/accounts/:botId/sync-history` → `runGramjsPrivateChatSync` (same as connect); clear RU error if session dead.
  - `gramjs-bridge` `/crm/private-dialogs`: catch loadClient failures + `isUserAuthorized` check.
  - Portal: RefreshCw button + syncHint; copy no longer says «отключите и QR».
- Verify: connected account → button → counts; dead session → «Сессия Telegram неактивна…»; WA/gift untouched.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal,gramjs-bridge` — backup `/opt/voxly/backups/20260805-090834/` (`voxly_control.dump` 214K, `twenty.dump` 1.3M). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.


### 2026-08-05 — Uncap private chat history sync (all dialogs × 30 msgs)

- Goal: sync **all** private WhatsApp + GramJS dialogs into CRM (was hard-capped at 40); keep per-chat message depth bounded; rate-limit to reduce ban/FloodWait risk.
- Changes:
  - `gramjs-bridge` `exportPrivateDialogsForCrm`: `getDialogs({ limit: undefined })` when uncapped; sleep ~500–900ms between peers; concurrency 1.
  - `saas-api` `runGramjsPrivateChatSync` + connect job: default dialogLimit=0 (all); messageLimit=30 (max 80).
  - `ai-whatsapp-worker` `runWhatsAppPrivateChatSync`: no dialog slice cap by default; sleep ~250–500ms between chats; portal/API defaults dialogLimit=0.
  - Portal copy on `/dashboard/ai/whatsapp` + `/gramjs`: «все личные» + «до 30 сообщений».
- Limits now: **dialogs = all private** (groups/channels/`@g.us` still skipped); **messages/chat = 30** (API max 80).
- Re-trigger: WA → button «Синхронизировать» or `POST /api/bots/whatsapp/accounts/:botId/sync-history`; GramJS → button «Синхронизировать» or `POST /api/bots/gramjs/accounts/:botId/sync-history` (no QR) / connect / admin enrich / internal `POST /api/internal/gramjs/connected`.
- Verify: connect or sync → logs show dialog count >40 when account has more; groups skipped; suppressDealCreation honored; gift-bot untouched.
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge,saas-api,ai-whatsapp-worker,saas-portal` — backup `/opt/voxly/backups/20260805-085839/` (`voxly_control.dump` 207K, `twenty.dump` 1.3M). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.
- Broken / next: deep history beyond 30 msgs/chat still not pulled (by design for rate limits). (Follow-up: GramJS manual sync button — see entry below.)



- Goal: user correction — `suppressDealCreation` must **not** auto-set when Opportunity is deleted; only CRM chat «Не создавать сделку».
- Changes:
  - Removed auto-set in `ai-telegram-worker` / `ai-whatsapp-worker` / `gift-bot-worker` syncLead + `saas-api` `gramjs-chat-sync` (stale/deleted Opportunity clears `twentyOpportunityId` only).
  - Kept: honor flag when true; `POST /api/crm/chat/:id/suppress-deal` + UI toggle; GramJS group skip unchanged.
  - Docs: CAPABILITIES + INC-096 corrected.
- Verify: delete deal → flag stays false → inbound can recreate Opportunity; toggle on → inbound skips create.
- Deploy: `./scripts/prod-deploy.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gift-bot-worker` — backup `/opt/voxly/backups/20260805-084346/`; smoke landing + api/health + dashboard OK. Gift-bot portal untouched (ADR-027). Volumes untouched. No commit.

### 2026-08-05 — WA private chat history sync on connect (gap from GramJS)

- Goal: mirror GramJS connect import for WhatsApp at `/dashboard/ai/whatsapp` — private chats → Conversation + ChatMessage + CRM deals (not groups).
- Changes:
  - `ai-whatsapp-worker`: `runWhatsAppPrivateChatSync` via Evolution `POST /chat/findChats` + `findMessages`; skip `@g.us`/broadcast/newsletter; 40×30; honor `suppressDealCreation` via `syncLeadToCrm`; idempotent by `externalMessageId`; debounce 2m; trigger on CONNECTION_UPDATE open + QR `authorized`; `POST /internal/crm/sync-history`.
  - `saas-api`: `POST /api/bots/whatsapp/accounts/:botId/sync-history` (owner JWT → worker).
  - Portal: sync button (RefreshCw) on connected accounts + post-authorize hint.
- Limits / caveat: best-effort — only chats/messages already persisted in Evolution DB after WA multi-device sync; may be empty/partial right after QR. Re-run button after a minute if needed. No AI replies on history import.
- Verify: connect or press sync → worker log `history-sync bot=…`; CRM People/Opportunities for private JIDs only; groups skipped; suppress toggle still blocks new Opportunity; GramJS/gift/send-from untouched.
- Deploy: **yes** `./scripts/prod-deploy.sh ai-whatsapp-worker,saas-api,saas-portal` — backup `/opt/voxly/backups/20260805-084550/` (`voxly_control.dump` 207K, `twenty.dump` 1.3M). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.
- Broken / next: none for this path. If Evolution DB empty right after QR, wait ~1–2 min and press sync again.


### 2026-08-05 — GramJS: no CRM deals from groups + suppress-deal + private chat sync

- Goal: group chatter must not create Person/Opportunity; optional suppress-deal after manual toggle; sync private dialogs on GramJS connect (bots not required).
- Root cause (prod voxly): `8855743233 · AI · @toxasagmsk` / Person `MG 8855743233` = **group** inbound on `@toxasagmsk` (GramJS). `@igor_dev_ru` = real private photo+caption via `@genadich_agency`, but orphaned `botInstanceId=null` → empty CRM chat.
- Changes:
  - `gramjs-bridge`: skip non-private chats for AI/CRM; `POST /crm/private-dialogs`; relink orphaned gramjs convs on connect.
  - `Conversation`/`GiftSubscriber.suppressDealCreation` + migrate; honor in TG/WA/gift syncLead (**later corrected:** no auto-set on Opportunity delete — manual toggle only).
  - CRM: `POST …/suppress-deal` + chat toggle «Не создавать сделку»; crm-chat **0.1.25**.
  - `runGramjsPrivateChatSync` on connect job (40 dialogs × 30 msgs, private only).
  - Orphan chat targets: fallback bot when `botInstanceId` null.
- Verify: group msg → no deal; DM → deal; suppress toggle; reconnect imports private history.
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge,saas-api,ai-telegram-worker,ai-whatsapp-worker,gift-bot-worker` — backup `/opt/voxly/backups/20260805-083000/` (+ retry `--skip-backup` after TS fix). Migrate `20260805120000_conversation_suppress_deal` applied. crm-chat **0.1.25** refresh voxly+efim1 `{ok:true}`. Ops: MG conv `suppressDealCreation=true`; igor `botInstanceId` relinked to genadich_agency. Volumes untouched.
- Gaps: multi-GramJS orphan relink only when sole active session.

### 2026-08-05 — CRM send-from accounts + rename GramJS/WA

- Goal: CRM «Пишем от» can send via connected GramJS/WA (not only gift bot); rename accounts on `/dashboard/ai/gramjs` + `/whatsapp`. Preserve-first (Phase 0 backup already `/opt/voxly/backups/20260805-075512/`).
- Changes:
  - Additive only: reuse `BotInstance.displayName` (no schema migrate).
  - `PATCH /api/bots/gramjs|whatsapp/accounts/:botId` + portal pencil rename UI.
  - GramJS GET accounts exposes `displayName`; CRM `channelMeta` prefers it for GramJS identity.
  - crm-chat GET `sendFromOptions[]`; reply `sendFromBotId` + peer resolve (TG id from gift/TG thread; WA only if existing WA dialog). Clear RU 400 if no mapping.
  - `voxly-crm-chat` **0.1.24**: «Пишем от» `<select>`; logic forwards `sendFromBotId`.
  - Gift-bot setup UX untouched (ADR-027).
- Verify: local `tsc` saas-api + saas-portal OK; portal build on prod OK; smoke landing/api/health/dashboard **200**.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` — backup `/opt/voxly/backups/20260805-080506/` (+ Phase0 `/opt/voxly/backups/20260805-075512/`). Volumes untouched. No commit.
- crm-chat tarball **0.1.24** baked; `refresh-crm-chat` efim1 + voxly → `{ok:true}`.
- Limitations: WA from gift-only lead without WA dialog = unavailable; GramJS media outbound still text-only; TG Business cross-account not listed; GramJS send may fail if peer privacy/no mutual history (bridge error surfaced).


### 2026-08-05 — Phase 0 backup before CRM send-from / account rename

- Goal: preserve client data + document current CRM «Пишем от» before additive GramJS/WA rename + send-from features. User: «Сначала сохрани все настройки. не сломай ничего!»
- Snapshot (no code change yet):
  - Accounts: `BotInstance` (`botType` ai_gramjs / ai_wa / gift…); human label = existing nullable `displayName` (WA already uses; GramJS GET `/accounts` did not expose it).
  - CRM send: reply always uses **active thread** bot (`GiftSubscriber` or `Conversation.botInstanceId`). Header «Пишем от» is label-only (`channelLabel · identityLabel`), not an account picker. Cross-channel send from gift-lead via GramJS/WA was not possible without a separate linked Conversation.
  - Gift-bot setup UX (ADR-027) untouched.
- Backup (prod, volumes untouched): `/opt/voxly/backups/20260805-075512/` (`voxly_control.dump` 205K, `twenty.dump` 1.3M). Containers `docker-postgres-control-1`, `docker-postgres-twenty-1`.
- Next: Phase 1 rename PATCH + UI; Phase 2 sendFrom selector + reply wiring; deploy saas-api + portal + crm-chat after local verify.


### 2026-08-05 — INC-095: gift extraButtons stripped on campaign save

- Goal: persist step-4+ `extraButtons` on save; rename step-4 CTA to «Сохранить».
- Changes:
  - `apps/saas-api/src/routes/bots.ts` — `sanitizeFunnel` now keeps `extraButtons` on start/gift/notSubscribed/afterGift/notGifted (was silently dropped after zod accept)
  - portal step 4 save label: «Сохранить пост после старта» → «Сохранить»
- Verify: add https URL button on step 4 → save → hard refresh → row + preview remain; other ExtraUrlButtonsEditor blocks same path
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api,saas-portal` — backup `/opt/voxly/backups/20260805-071948/` (`voxly_control.dump`, `twenty.dump`). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.
- Broken / next: none for this path.

### 2026-08-04 — Gift-bot extra URL buttons under posts

- Goal: allow optional custom https URL inline buttons under gift posts (steps 4–6 + Дожим notGifted/notSubscribed); default empty = no change for existing bots.
- Changes:
  - `@voxly/shared`: `GiftExtraButton`, `extraButtons?` on `start` / `gift` / `GiftFunnelMessage`
  - saas-api `PUT …/campaign` zod: validate ≤8 `{text,url}` http(s) buttons
  - portal: `ExtraUrlButtonsEditor` («Добавить кнопку») + preview via `TelegramPreview` `linkButtons` (↗); sanitize incomplete rows on save
  - gift-bot-worker: append extras in `subscribeKeyboard` / gift delivery / delay jobs (`after_gift` = extras only)
- Verify: add button on step 4 → preview green URL row → save → `/start` shows channel + custom + «Я подписался»; empty bots unchanged
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api,saas-portal,gift-bot-worker` — backup `/opt/voxly/backups/20260804-160301/` (`voxly_control.dump`, `twenty.dump`). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.

### 2026-08-04 — Promo button: optional click counter

- Goal: allow hiding « · N» on gift promo channel button (step 3); keep counter on by default for existing bots.
- Changes:
  - `@voxly/shared`: `GiftPromoPost.showClickCounter`, `promoShowClickCounter()`, `formatPromoButtonLabel(..., showClickCounter?)`
  - saas-api `PUT/POST …/promo`: persist + publish label respects flag
  - gift-bot-worker `trackPromoClick`: skip `editMessageReplyMarkup` when counter hidden; still increments `clickCount`
  - portal `#section-promo`: checkbox «Показывать счётчик нажатий на кнопке»; preview/hint update
- Verify: uncheck → preview without « · N»; save + publish → TG button plain label; re-check + republish → counter back
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api,saas-portal,gift-bot-worker` — backup `/opt/voxly/backups/20260804-154215/` (`voxly_control.dump`, `twenty.dump`). Smoke landing/api/health/dashboard **200**. Volumes untouched. No commit.

### 2026-08-04 — Gift-bot CTA label «Добавить сообщение»

- Goal/Changes/Verify/Deploy: `MessageList` «+ ещё напоминание» → «Добавить сообщение» (`BTN_AMBER` unchanged); `./scripts/prod-deploy.sh saas-portal` backup `/opt/voxly/backups/20260804-150819/`; volumes untouched; no commit.

### 2026-08-04 — Gift media quality: stage as document (INC-094)

- Goal: stop irreversible Telegram recompression of gift photo/video at upload staging.
- Changes:
  - `uploadAttemptsForKind` photo/video → `sendDocument` first; keep requested `mediaType` photo/video when staged as document
  - `detectStoredMediaKind` + `isTelegramDocumentFileId`: BQAC/BQAD + photo|video hint → intent (true docs unchanged)
  - saas-api `publishChannelMedia` + gift-bot-worker `sendBotPhoto`/`sendBotVideo`: download → sendPhoto/Video; fallback sendDocument if getFile fails
  - Tests shared; ADR-002 note; INC-094
- Verify: `pnpm --filter @voxly/shared test` / root vitest shared cases green (90 passed unit suite)
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api,gift-bot-worker,saas-portal` — backup `/opt/voxly/backups/20260804-150636/` (`voxly_control.dump`, `twenty.dump`). Volumes untouched. No commit.
- Broken / next: already-uploaded AgAC/BAAC file_ids stay compressed (re-upload to get originals); getFile 20MB cap → large files send as document.

### 2026-08-04 — Gift-bot «+ ещё напоминание» → amber CTA

- Goal: match add-reminder buttons on `/dashboard/bots/[botId]` to promo «Опубликовать в канале» (`land-btn-amber` / `BTN_AMBER`).
- Changes: `MessageList` «+ ещё напоминание» `BTN_GHOST_SM` → `BTN_AMBER` (covers after-gift + Дожим notGifted/notSubscribed). Ghost saves/cancel/delete untouched; previews/text/emoji/media untouched (ADR-027).
- Verify: portal build ok; smoke landing/api/health/dashboard **200**.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-145632/` (`voxly_control.dump`, `twenty.dump`). Volumes untouched. No commit.
- Broken / next: none.

### 2026-08-04 — Persist gift-bot setup UX as multi-tenant canon (ADR-027)

- Goal: lock `/dashboard/bots/[botId]` polish (steps 1–6 + Дожим, dual photos, emoji under preview, media-file preview, TG chrome, partners page chrome, InputWithEmoji/TelegramMdTextarea, PNG→JPG) as the standard for **all** tenants; prevent future regressions.
- Changes (docs only):
  - `docs/agent/CAPABILITIES.md` — canonical gift detail section + Do not regress checklist; `media-file` API row
  - `docs/agent/DECISIONS.md` — **ADR-027**
  - `docs/agent/README.md` — reading order 3b for gift portal
  - `.cursor/rules/gift-bot-setup-ux.mdc` — always-on reminder
  - `steps.md` §4 snapshot note
- Verify: repo grep — **zero** hits for example bot id `cmseet8qs000eq8b1ld6nmszc`; page uses `useParams().botId` + `/api/bots/${botId}/*` only.
- Deploy: **no** (no code bug). Commit: no (docs unless user asks).
- Broken / next: none; agents must not casually refactor preview/text/media.

### 2026-08-04 — Gift-bot detail restyle to partners visual language

- Goal: align `/dashboard/bots/[botId]` page chrome with partners / bots-index amber industrial style without touching funnel logic or Telegram preview chrome.
- Changes:
  - `apps/saas-portal/src/app/dashboard/bots/[botId]/page.tsx` — Card/Button → section + `land-btn` / `land-btn-ghost` / `land-btn-amber`; cream readiness (`#faf8f5`); warm how-to (`#fff8ec` / `#f5a623`); partners alert/table/hint tokens; TG previews untouched.
  - `apps/saas-portal/src/components/portal/project-picker.tsx` — same tokens (cream panels, amber selected border, land buttons).
- Verify: portal `tsc --noEmit` ok; deploy smoke landing/health/dashboard partners+crm+ai **200**.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-113607/` (`voxly_control.dump`, `twenty.dump`). Volumes untouched. No commit.
- Broken / next: hard-refresh bot detail; confirm TG previews still look like Telegram.

### 2026-08-04 — Deploy gift-bot-worker: shared detectStoredMediaKind prefix-wins

- Goal: ship send-path fix so gift `type=file` with photo/video file_id prefixes is not sent as document (same shared change as portal preview audit).
- Changes: no new code in this step; rebuild `gift-bot-worker` with `packages/shared` where `detectStoredMediaKind` prefers known Telegram file_id prefixes over stored mediaType.
- Verify: dry-run then `./scripts/prod-deploy.sh gift-bot-worker`; container grep shows «Known file_id prefixes are authoritative»; worker `/health` ok; landing + `api/health` + dashboard smokes **200**.
- Deploy: **yes** — backup `/opt/voxly/backups/20260804-111824/` (`voxly_control.dump`, `twenty.dump`). Volumes untouched.
- Broken / next: none for this path; Telegram getFile ~20MB cap still applies to preview.

### 2026-08-04 — Auto CRM enrich+dedupe on GramJS connect

- Goal: after personal TG connect, scan CRM contacts → enrich + soft-merge phone duplicates; new leads keep enrich. All portals.
- Changes:
  - `runTelegramCrmEnrich` + BullMQ `gramjs-crm-enrich`
  - `POST /api/internal/gramjs/connected` (bridge service token)
  - bridge notifies saas-api on QR authorize + `/sessions/connect`
  - admin enrich uses same service (`async:true` queues)
- Verify: connect GramJS → logs `[gramjs-crm-enrich] done`; Persons get phone/about/birthday; dupe Conversations share personId.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api,gramjs-bridge` — smoke **200**.

### 2026-08-04 — GramJS Telegram profile → CRM Person (phone/about/birthday)

- Goal: auto-fill Person from Telegram profile visible in app (phone, bio, birthday, name, channel) — Bot API cannot see these.
- Changes:
  - `gramjs-bridge` `POST /users/full` → `users.GetFullUser`
  - `twenty-client`: Person fields `about` + `birthday`; `applyTelegramProfile`
  - gift-bot + ai-telegram: enrich after CRM sync
  - admin `POST /api/admin/tenants/:id/enrich-telegram-profiles` backfill
- Verify: tenant needs active `ai_gramjs`; privacy must expose fields; then enrich or new /start.
- Deploy: **yes** `./scripts/prod-deploy.sh gramjs-bridge,gift-bot-worker,ai-telegram-worker,saas-api` — smoke **200**.
- Broken / next: voxly has **no** `ai_gramjs` yet — connect at `/dashboard/ai/gramjs` (account that sees phone/ДР), then auto-enrich on connect.

### 2026-08-04 — INC-021 reopen: kanban note chip showed title not body

- Goal: chip **Заметки** = note **body** (not short title like «мм»).
- Root cause: PG triggers `voxly_sync_note_title_from_body` **missing** on both ACTIVE workspaces; `reapply-crm-defaults` only did GraphQL (labelIdentifier=title) without SQL backfill/triggers. Example: title=`мм`, body=`мсмчмчмч`.
- Changes:
  - Ops: applied `docker/set-opportunity-kanban-card-defaults.sql` on prod → backfill + triggers; titles now = body.
  - Code: `ensureOpportunityKanbanCardDefaults` in saas-api; hooked in provision (`queues.ts`) + `reapply-crm-defaults` (`admin.ts`).
- Verify: voxly note titles = body markdown; triggers present on both schemas.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-api` — smoke landing/health/dashboard **200**. SQL already live; code keeps triggers on provision/reapply.
- Broken / next: hard-refresh voxly-crm Сделки — chip should show body (`мсмчмчмч`), not `мм`.

### 2026-08-04 — Opportunity kanban card fields (noteTargets) on all portals

- Goal: deal cards show full default fields incl. **Заметки** (`noteTargets`); align live portals with SoT.
- Changes (ops): `POST /api/admin/tenants/:id/reapply-crm-defaults` for **voxly** + **efim1** → `ensureOpportunityKanbanCardFields` added missing `createdAt`/`taskTargets`, set `noteTargets` size **280** (was 100). Note `labelIdentifier` = **title** (unchanged).
- Verify (prod PG): both ACTIVE workspaces INDEX KANBAN viewFields = name, createdAt, amount, createdBy, closeDate, company, pointOfContact, taskTargets, noteTargets@280.
- Deploy: **no** (admin reapply only). Hard-refresh `{slug}-crm` Сделки.
- Broken / next: new portals get same via `provisionWorkspace` → `applyWorkspaceDefaults` (coded ADR-010, not live clone of one URL).

### 2026-08-04 — Gift-bot preview audit: media kind + chrome consistency

- Goal: audit all gift-bot detail preview blocks; fix media stuck on placeholder when `file_id` exists but kind was wrong.
- Changes:
  - Root: gift step defaulted `type=file` → `mediaType: document`, so `useResolvedMediaSrc` skipped photo/video fetch (`isVisualMediaKind`).
  - `detectStoredMediaKind` — known Telegram `file_id` prefixes now beat wrong/legacy `mediaType` (AgAC→photo even if hinted document).
  - `TelegramPreview` resolves kind via `detectStoredMediaKind` when `telegramFileId` set; uses `TG_INLINE_BTN` from chrome.
  - Gift preview: no longer defaults to document; link gifts append URL in text (matches worker delivery).
  - `BotGreetingPreview` uses `TG_START_BTN`; chrome inline-btn green aligned.
- Verify: shared tests 23 pass; deploy smoke landing/health/dashboard 200.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-111207/` (compose also recreated saas-api as dep; no API route change).
- Broken / next: Telegram `getFile` ~20MB cap; document/voice/audio stay labeled placeholders; gift-bot-worker rebuilt with prefix-wins shared — backup `20260804-111824` (see entry above).

### 2026-08-04 — INC-092: login 500 (disk full / PG recovery)

- Goal: restore portal login after Internal Server Error for `anton@genadich.com` (and all users).
- Changes (ops only, no app code):
  - Root cause: `/` at 100% → `postgres-control` stuck in recovery (checkpoint PANIC) + Redis MISCONF; login Prisma `user.findUnique` 500.
  - Freed ~68GB via `docker image prune -f` (+ truncate container logs, journal vacuum). **No** `down -v`, no DB wipe.
  - Restarted `postgres-control`, then `saas-api` + gift/platform/manager/ai workers (stale Prisma P1017).
- Verify: `POST https://api.getvoxly.ru/api/auth/login` → **401** Invalid credentials (not 500); user row exists; health + `/login` 200; PG healthy; `df` ~26% used / 70G free.
- Deploy: **no** `prod-deploy.sh` (infra). Last app backup remains `/opt/voxly/backups/20260804-103952/`.
- Broken / next: schedule periodic dangling-image prune; watch disk before multi-service rebuilds (INC-052/092).

### 2026-08-04 — INC-093: gift TelegramPreview placeholder instead of media

- Goal: fix gift-bot preview showing «Медиа загружено» after media is saved to Telegram.
- Changes:
  - Root: preview had `file_id` only (no public URL / lost blob after reload).
  - `GET /api/bots/:botId/media-file?fileId=` proxy via Telegram `getFile` (saas-api).
  - `TelegramPreview` resolves photo/video/video_note via auth fetch → blob; keeps local blob when present; document/voice/audio stay labeled placeholders.
  - Wired `botId`+`telegramFileId` on bot detail + gift broadcasts previews.
- Verify: hard-refresh bot page with saved photo → image in preview; video ≤20MB; smoke landing/health.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` — backup `/opt/voxly/backups/20260804-110027/`; smoke landing/health/dashboard **200**.
- Broken / next: Telegram `getFile` download cap ~20MB — larger videos keep placeholder unless same-session blob exists.

### 2026-08-04 — Unified Telegram previews (chat + before-Start)

- Goal: match real TG chat UI (wallpaper, green inline buttons, ↗ on URL) and unify chrome with BotGreetingPreview.
- Changes:
  - New `telegram-preview-chrome.tsx` — shared frame, label, header, wallpaper tokens.
  - `telegram-preview.tsx` — mint doodle wallpaper `#95bb87`, white bubble, translucent green buttons + link icon; shared header + optional `botAvatarUrl`.
  - `bot-greeting-preview.tsx` — same frame/header; keeps blue greeting wash + distinct profile vs card photo + СТАРТ.
  - `bots/[botId]/page.tsx` — all preview labels via `TG_PREVIEW_LABEL`; avatar wired into every `TelegramPreview`.
  - Also labels on broadcasts / channel-broadcasts / mailing stories.
- Verify: smoke landing + api/health + dashboard routes 200; hard-refresh bot detail to see green buttons + shared chrome.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-103952/` (earlier partial authenticity deploy: `20260804-093127`).
- Broken / next: none for this UI pass.

### 2026-08-04 — Gift bot step 2: two photos + emoji under preview

- Goal: fix «2 шаг: Настройте бота» — separate profile vs description-card photos; emoji under preview; rename save button.
- Changes:
  - `bot-greeting-preview.tsx` — `profilePhotoUrl` (header circle) + `cardPhotoUrl` (large card); no longer reuses one asset.
  - `bots/[botId]/page.tsx` — profile upload→TG API (PNG→JPG kept); card photo local preview + localStorage; BotFather note; `EmojiPickerPanel` under preview with field target; button «Сохранить настройки бота».
  - `emoji-picker.tsx` — `placement` on popover + `EmojiPickerPanel`; `input-with-emoji` / `telegram-md-textarea` — `showEmoji` / `onFocus`.
- Verify: step 2 shows two uploads; preview circle ≠ card image; emoji panel below preview; button label updated; deploy saas-portal.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-102056/`.
- Broken / next: description media still BotFather-only in Telegram (no Bot API).

### 2026-08-04 — Deploy check: already current (saas-api + saas-portal)

- Goal: user «задеплой» — ship any dirty portal/API vs last backup `20260804-100025`.
- Changes: none. `prod-diff saas-api,saas-portal` hot files all match; spot-check of dirty/untracked product paths (bots/[botId], settings, app-shell, to-jpeg/emoji, bots.ts, forms/max/admin-*, shared, gift-bot-worker, max-bridge) all **MATCH** `/opt/voxly`.
- Verify: smoke `https://getvoxly.ru/` / `https://api.getvoxly.ru/health` / `/dashboard/bots` / `/dashboard/settings` / `/login` → **200**. Containers Up (created ~2026-08-04T10:01Z) after prior funnel-reorder deploy.
- Deploy: **skipped** (already current). Last backup remains `/opt/voxly/backups/20260804-100025/`.
- Broken / next: none for this check; local git still dirty/uncommitted but code already on prod via prior rsync deploys.


### 2026-08-04 — Gift-bot setup steps reorder/rename on `/dashboard/bots/[botId]`

- Goal: rename + reorder TG funnel setup blocks to numbered «N шаг» flow; separate «Дожим» nudges.
- Changes:
  - `apps/saas-portal/src/app/dashboard/bots/[botId]/page.tsx` — visual order: 1 канал → 2 настройка бота → 3 пост акции → 4 пост после старта → 5 подарок → 6 после выдачи → **Дожим** (молчит / не подписан); readiness TOC: channel → promo → start → gift → subs; MAX titles adapted (1–3 + Дожим).
  - `docs/agent/CAPABILITIES.md` — bots/[botId] row updated.
- Verify: prod `.next` page.js contains all 6 step titles + Дожим + both nudge titles; `/dashboard/bots` 200; smoke landing + api/health OK.
- Deploy: **yes** `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-100025/`.
- Broken / next: none for this UI pass; hard-refresh bot detail if CDN/cache.

### 2026-08-04 — `/dashboard/settings` profile page + mobile avatar menu

- Goal: fix avatar «Настроить профиль» 404; same menu on mobile header.
- Changes:
  - `apps/saas-portal/src/app/dashboard/settings/page.tsx` — amber hero + cream cards; read-only email/name/role/workspace from `GET /api/auth/me`; note that password/profile edit APIs are not wired (`PATCH /api/tenant` stub returns 400).
  - `app-shell.tsx` — mobile sticky header: avatar `DropdownMenu` (settings + logout) beside Bell, before hamburger.
  - `CAPABILITIES.md` — row for `/dashboard/settings`.
- Verify: local `/dashboard/settings` loads profile; desktop+mobile avatar → settings; member redirect still allows settings.
- Deploy: **not** (local fix; leave saas-portal deploy for coordinated portal agents).
- Broken / next: no self-service change-password yet.

### 2026-08-04 — Deploy: portal/API UX batch (settings + avatar menu + PNG/emoji)

- Goal: ship gift-bot PNG→JPG avatar convert + emoji fields, avatar DropdownMenu, `/dashboard/settings` to prod with `saas-api` + `saas-portal`.
- Changes (rsync via `./scripts/prod-deploy.sh --no-cache saas-api,saas-portal`):
  - Portal: `to-jpeg.ts`, `emoji-picker.tsx`, `input-with-emoji.tsx`, `bots/[botId]`, `app-shell` avatar menu, `/dashboard/settings`.
  - API: `bots.ts` JPEG/PNG avatar validation messaging (client converts PNG→JPG).
  - Piggyback (dirty tree already intentional WIP): MAX/forms/admin pricing+AI-balance+services portal+API surfaces, `packages/` + migrations already on control DB (`form_lead_intake`, `referral_service_rate` — no pending), `twenty-app/voxly-crm-chat` nav tweaks.
- Verify:
  - Backup: `/opt/voxly/backups/20260804-094716/` (`voxly_control.dump`, `twenty.dump`).
  - Smoke: landing 200; `api/health` 200 `{"status":"ok"}`; `/dashboard/{partners,crm,ai,ai/agents}` 200; extra `/dashboard/bots`, `/dashboard/settings`, `/dashboard/bots/max` 200.
  - Remote files present: `settings/page.tsx`, `to-jpeg.ts`, `emoji-picker.tsx`, `input-with-emoji.tsx`.
- Broken / next: hard-refresh cabinet for avatar menu + PNG/emoji; live PNG upload + emoji insert smoke on a gift bot; password change still not wired on settings.
- Skipped intentionally: did **not** deploy `gift-bot-worker` / `max-bridge` / compose in this run (worker MAX handlers remain local dirty if any).

### 2026-08-04 — `/dashboard/bots` amber restyle + reorder + header cleanup

- Goal: match bots index to orange hero language; funnel totals above connect; list CTA «Настроить бота»; remove top toolbar (Подключить бота / Рассылки / Подарки MAX).
- Changes: `apps/saas-portal/src/app/dashboard/bots/page.tsx` only — section order hero → alert → balance? → 3-step → **Итоги** → **Подключить** → list; cream/`#fff8ec` sections; amber alert/badge; CTA label fixed.
- Verify: lint clean on page; DOM order + CTA text; header buttons gone.
- Deploy: `./scripts/prod-deploy.sh saas-portal` — backup `/opt/voxly/backups/20260804-093127/`; smoke OK.
- Broken / next: pre-existing bots load API errors untouched.

### 2026-08-04 — Dashboard header avatar menu (profile + logout)

- Goal: sticky header avatar opens menu with «Настроить профиль» + «Выйти».
- Changes: `apps/saas-portal/src/components/portal/app-shell.tsx` — shadcn `DropdownMenu` on desktop avatar; profile → `/dashboard/settings`; logout reuses existing `localStorage.removeItem('voxly_token')` + `router.push('/')`; initials from JWT email; member redirect allows `/dashboard/settings`.
- Verify: local — click avatar → menu; Escape closes; Выйти clears token. **Not deployed** (shared shell; leave for saas-portal deploy with other agents).
- Broken / next: **no `/dashboard/settings` page yet** (404) — needs a profile settings page; no `/dashboard/profile` either.
- Backup: n/a (local only).

### 2026-08-04 — Gift bot: PNG avatar + emoji on greeting/button fields

- Goal: finish incomplete UX — profile photo accept PNG (Telegram static = JPG only); emoji picker on remaining gift-bot text blocks.
- Changes:
  - Portal: `fileToJpegFile` (`to-jpeg.ts`) before `POST …/telegram-profile/photo`; accept `.jpg/.jpeg/.png/.webp`; copy «PNG или JPG» (no «Только JPG»).
  - Portal: `InputWithEmoji` on bot name, short description, subscribe `confirmLabel`, promo `buttonText`; `TelegramMdTextarea` (+ emoji) on description, start/promo/funnel/gift caption, MessageList, operator reply.
  - `emoji-picker.tsx`: fixed corrupted «Люди» group (ASCII «Blond»); note that TG Premium *custom packs* = paste from Telegram; Unicode via picker.
  - API (prior/partial): JPEG magic-byte check + friendly error mentioning client PNG→JPG.
- Verify: `pnpm --filter @voxly/saas-portal typecheck` OK; `pnpm --filter @voxly/saas-api typecheck` OK; no «Только JPG» in portal/api; emoji «Люди» group clean (no ASCII corruption).
- Deploy: **ready to deploy** — batch with avatar menu / settings (`saas-api,saas-portal`). Not deployed this session.
- Broken / next: hard-refresh after deploy; TG Premium *custom pack* emoji only via paste from Telegram (Unicode via picker).

### 2026-08-03 — INC-090: Traefik readTimeout 300s for gift media upload
- Goal: user re-upload after INC-089 still abort ~57%.
- Root cause: Traefik `web` entrypoint default `readTimeout: 60s` (confirmed via `/api/entrypoints`); POST reached saas-api then client/NPM 499 at exactly 60s.
- Changes: `docker-compose.prod-npm.yml` respondingTimeouts 300s; recreate `traefik` (`docker-compose ... up -d --force-recreate --no-deps traefik`); NPM `server_proxy.conf` connect/body timeouts 300s + `proxy_buffering off`.
- Verify: entrypoints `readTimeout: 5m0s`; `https://api.getvoxly.ru/health` 200; landing 200; OPTIONS media 204.
- Broken / next: user hard-refresh + re-upload; if file >48MB multipart limit, expect 413/fastify error after full body — separate from 60s cut.
- Backup: NPM `server_proxy.conf.bak-20260803-1908-inc090`; compose synced via `prod-deploy.sh --skip-backup compose`.

### 2026-08-03 — INC-089: media upload buffering off + portal 300s timeout

- Goal: post-INC-088 upload still aborted: API `499` ~189s, saas-api saw only OPTIONS (no POST).
- Root cause: NPM `proxy_request_buffering on` + portal XHR timeout 180s.
- Changes: `proxy_request_buffering off` in NPM `server_proxy.conf` (reload); `DEFAULT_TIMEOUT_MS = 300_000` in `upload-bot-media.ts`.
- Deploy: backup `/opt/voxly/backups/20260803-155457/`; `saas-portal`; nginx bak `server_proxy.conf.bak-20260803-185446`.
- Verify: buffering `off` in container; landing/health **200**; OPTIONS media **204**.
- Broken: none. Residual: user must hard-refresh and re-upload a large MP4 to confirm POST hits saas-api mid-upload.
- Next: client retest «Пост в канале» / broadcasts media.

### 2026-08-03 — INC-088: gift promo/post media upload (all kinds) + deploy

- Goal: promo post video on `cms3bdwkj000aq8b1wyygzspl` progressed then aborted; fix photo/video/document for posts, funnel, broadcasts.
- Root cause: NPM logs — YaBrowser still `POST getvoxly.ru/.../media` → 500 (Next rewrite); broadcasts used same path; `mediaType` coerced to photo/video so document/`sendVideo` fallback broke publish; NPM read timeout 90s.
- Changes: `upload-bot-media` harden; broadcasts → direct API + progress; shared `detectStoredMediaKind` + document; API publish/sanitize/worker sendDocument; NPM `server_proxy.conf` 300s/64m.
- Deploy: backup `/opt/voxly/backups/20260803-153618/`; `saas-api,saas-portal,gift-bot-worker`; smoke 200; OPTIONS `/media` 204.
- Verify: hard-refresh → upload MP4/photo/file ≤48MB on promo → file_id → Save/Publish.
- Broken: none. Residual: MAX gift media still unsupported on this endpoint; user must hard-refresh if cached old JS.
- Next: client retest on bot page section «Пост в канале».

### 2026-08-03 — Deploy: dashboard amber redesign

- Goal: ship `/dashboard` amber hub + tenant dashboard fields (`products.max`, `accounts.max`, `giftMaxBots`) to prod.
- Changes: deploy via `./scripts/prod-deploy.sh saas-api,saas-portal` (dry-run first).
- Deploy: backup `/opt/voxly/backups/20260803-151723/` (`voxly_control.dump`, `twenty.dump`); prisma migrate deploy — no pending; recreate saas-api + saas-portal.
- Verify: smoke `/` **200**, `api/health` **200** + body ok, `/dashboard` **200**, `/dashboard/{partners,crm,ai,ai/agents}` **200**.
- Broken: none. Brief initial `/` 502 during portal start (~3s), then OK.
- Next: visual smoke logged-in `/dashboard`; INC-087 pricing 0 ₽ still needs deploy note if not yet shipped in same tree.

### 2026-08-03 — Comp access: free grant for clients (except AI wallet)

- Goal: admin can open CRM/products for free for N months without AI top-up.
- Changes: `comp-access.ts` `grantCompAccess`; `POST /api/admin/pricing/tenants/:id/comp-access`; UI on `/admin/pricing` («Выдать бесплатно» + 1/3/6/12 мес). Also ships INC-087 (0 ₽ overrides).
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` (×2); backups `/opt/voxly/backups/20260803-152222/` + `20260803-152749/`; smoke landing + api/health + dashboard paths **200**.
- Verify: saas-api + saas-portal tsc clean; prod smoke OK.
- Broken: none.
- Next: UI smoke — efim1 «Выдать бесплатно» 12 мес → CRM unlocked, AI wallet unchanged.

### 2026-08-03 — INC-087: admin pricing allow 0 ₽ tenant overrides

- Goal: `/admin/pricing` individual prices — save `0` (free/comp) for a client.
- Cause: UI + API rejected prices `< 1` (treated as invalid); Alert at page top easy to miss.
- Changes: `PRICE_MIN_RUB=0` for tenant overrides; platform min stays 1; portal validation/inputs; `crm-tenant-pricing` + admin CRM PUT; billing fulfils `netAmount===0` without Robokassa.
- Verify: saas-api + saas-portal `tsc --noEmit` clean.
- Broken: none. Residual: needs deploy `saas-api,saas-portal` to prod.
- Next: deploy when asked; smoke efim1 CRM база → 0 → custom.

### 2026-08-04 — Gift media formats: PDF/DOC/XLS + voice + video_note

- Goal: support office files, voice, video circles, photo (not only MP4/photo).
- Changes: shared `detectUploadMediaKind` + media kinds; API staging/publish; worker send helpers; portal accept/checkbox; fix document→photo coerce (INC-091).
- Deploy: `--skip-backup saas-api,saas-portal,gift-bot-worker` (prior backup `20260804-085013`); smoke landing/health/cabinet **200**.
- Verify: shared vitest media cases; saas-api/portal tsc clean.
- Residual: кружочек needs checkbox or filename `*circle*`; OGG for voice; Telegram limits ≤48 МБ / video note ≤60s.

### 2026-08-04 — Funnel blocks 3.1–3.4 each with preview + no-cache deploy

- Goal: каждый блок воронки (вкл. 3.4 «молчит») — отдельная карточка с превью как пост после старта (кнопки канал + «Я подписался»).
- Changes: split funnel Card; `linkButtons` on 3.1/3.4; RMB textarea; `prod-deploy.sh --no-cache`; prior greeting/post-start included.
- Deploy: `--skip-backup --no-cache saas-api,saas-portal` (Docker cache had skipped prior build).
- Verify: smoke landing/api/health/cabinet 200.
- Broken: none. Residual: hard-refresh; media needs Telegram linked or verified channel.
- Next: user retest 3.4 preview + media uploads.

### 2026-08-04 — Gift bot block 3 post-start + RMB format + media

- Goal: «3. Пост после старта»; ПКМ-форматирование; превью с «Перейти в канал»; починить загрузку png/pdf/docx.
- Changes: `TelegramMdTextarea` + `wrapSelection`/link in shared; preview `linkButtons`; accept list; upload base URL always `api.getvoxly.ru` on prod host; rename section; deploy saas-api+portal (+ shared via image build).
- Verify: shared vitest md; portal/api tsc; prod smoke after deploy.
- Broken: none. Residual: staging still needs Telegram linked or verified channel.
- Next: user hard-refresh and retest uploads + RMB menu.

### 2026-08-04 — Gift bot 1.2 greeting (name, photo, preview)

- Goal: блок 1.2 = приветствие до «Старт» с превью как в Telegram (фото, название, описание).
- Changes: API `GET/PUT telegram-profile` (+ `setMyName`), `POST/DELETE …/photo`, `GET …/avatar`; portal `BotGreetingPreview` + form; CAPABILITIES.
- Verify: saas-portal + saas-api tsc clean.
- Broken: none. Residual: deploy `saas-api,saas-portal`; Telegram limits profile photo change to ~1/day; JPG only.
- Next: deploy when asked; smoke on a gift bot page.

### 2026-08-03 — Dashboard amber hub redesign

- Goal: `/dashboard` в том же industrial amber стиле, что CRM/partners/AI/bots.
- Changes: `DashboardPortalHero`; блоки «Сейчас важно», KPI, сетка разделов, партнёрский strip, gift-воронка collapsed; убраны blue HeroBanner и admin-детали (токены/себестоимость); API `GET /api/tenant/dashboard` + `products.max` / `accounts.max|giftMaxBots`.
- Verify: `saas-portal` tsc clean.
- Broken: none. Residual: deploy `saas-api,saas-portal` when asked.
- Next: visual smoke на `/dashboard` после deploy.

### 2026-08-03 — Deploy: web form lead intake Phase 1

- Goal: ship ADR-026 FormLead intake to prod (Tilda/WP → CRM + attribution).
- Changes: already in tree; deploy `saas-api,saas-portal`.
- Deploy: backup `/opt/voxly/backups/20260803-122358/`; migrate `20260803160000_form_lead_intake` applied; recreate api+portal.
- Verify: smoke `/` api/health + body, `/dashboard/crm` (+ partners/ai/agents) **200**; `POST /api/webhooks/forms/:token` registered (unknown token → 404).
- Broken: none. Residual: client E2E Tilda connect on a real tenant.

### 2026-08-03 — Web form lead intake Phase 1 (Tilda/WP → CRM)

- Goal: universal site form webhook → Twenty Person/Opportunity + attribution for S2S (`web_form_lead`).
- Changes: Prisma `FormWebhookEndpoint`/`FormLead`; `POST /api/webhooks/forms/:token` + `/api/forms/*`; BullMQ `form-leads`; parser (COOKIES/TILDAUTM); `processFormLead` (phone/email dedupe, reuse_open); `fireGoal` + `attributionId`/`payload`; portal section on `/dashboard/crm`; ADR-026.
- Verify: parser vitest 5/5; saas-api + portal typecheck; migrate `20260803160000_form_lead_intake`.
- Broken: none. Residual: field-mapping UI, deal_won hook, WP plugin (Phase 2); apply migrate on prod with deploy.
- Next: smoke Tilda test=test + real lead on a tenant workspace; deploy saas-api+portal when asked.

### 2026-08-03 — INC-086: gesha Сделки blank kanban (Redis cache)

- Goal: restore gesha CRM Opportunities board (white board, shell OK).
- Cause: stale Redis flat-maps for workspace `005bad75-…`; DB view/groups/opps OK.
- Fix: flush Redis `*005bad75*`, bump `metadataVersion` 26→27.
- Verify: browser board columns + 6 cards visible.
- Prevention: note in INC-086.

### 2026-08-03 — Landing Awwwards v3 (CRM + free Tilda/WP forms)

- Goal: rebuild getvoxly.ru per PROMPT v3 — forms free/unlimited in CRM Base + ClickUp craft (tabs/replaces/constellation); keep v2 archive.
- Changes: archive `apps/saas-portal/src/app/_archive/landing-v2/`; new `page.tsx`; `product-tabs.tsx`; form mocks; mobile step «заявка»; design lock `landing-awwwards-v3.md`.
- Deploy: `./scripts/prod-deploy.sh saas-portal`; smoke `/` + health + cabinet **200**.
- Verify: HTML has Tilda/WordPress/безлимит/Replaces/constellation signals.
- Broken: none. Residual: optional real CRM screenshots later.

### 2026-08-03 — Mascot v6 on login/register

- Goal: replace worn CTA/hero mascot with new industrial robot asset (transparent cutout).
- Changes: `public/mascot/voxly-mascot-v6.png` (+ aliases); login/register layout (aspect 5/6, larger, drop-shadow); `vox-relay` points to v6.
- Deploy: `./scripts/prod-deploy.sh --skip-backup saas-portal` (prior backup `20260803-114154`).
- Verify: `/register` `/login` reference `voxly-mascot-v6`; asset 200.

### 2026-08-03 — Landing Awwwards v2 (CRM command center)

- Goal: rebuild getvoxly.ru per `design-system/voxly/pages/landing-awwwards-v2.md` — thesis CRM + mobile web without apps; deploy.
- Changes: `apps/saas-portal/src/app/page.tsx` full rewrite; `product-mocks.tsx` + `mobile-proof.tsx`; industrial land-btn radius; metadata; design lock status BUILT.
- Deploy: `./scripts/prod-deploy.sh saas-portal`; backup `/opt/voxly/backups/20260803-112800/`.
- Verify: build OK; smoke `/` + api health + cabinet URLs 200; HTML contains «Командный центр продаж», «CRM в кармане», «App Store не нужен».
- Broken: none. Residual: optional polish of mock fidelity / real CRM screenshots later.

### 2026-08-03 — Fix gift video upload (Premature close) + progress + deploy

- Goal: video media on gift bot start message never finished; need progress + working upload.
- Root cause (prod logs): `POST /api/bots/:id/media` via Next rewrite → `ERR_STREAM_PREMATURE_CLOSE` ~30s (INC-086).
- Changes: XHR upload direct to `api.getvoxly.ru`; progress bar; video sendVideo↔document fallback; API timeouts/413; bodyLimit 52MB.
- Deploy: backup `/opt/voxly/backups/20260803-145644/`; `saas-api`+`saas-portal`; smoke 200.
- Verify: hard-refresh bot page → upload MP4 ≤48MB → progress → «Файл в Telegram» → Save.

### 2026-08-03 — Deploy: Yandex Metrika counter on portal

- Goal: sitewide Metrika `111265694` in root layout (all pages).
- Changes: `YandexMetrika` + root `layout.tsx` (already local); deploy `saas-portal`.
- Deploy: backup `/opt/voxly/backups/20260803-101909/`; compose recreate hit orphan saas-api name conflict → cleaned → `up -d --no-deps saas-portal`.
- Verify: `/` `/login` `/dashboard` + api health 200; HTML contains `111265694` + `mc.yandex.ru/metrika`.

### 2026-08-03 — Split gift products: Telegram vs MAX

- Goal: two products with separate settings/billing (not one glued page).
- Changes: SKU `gift_bot_max`; trial/checkout/fulfil; gates; grandfather from legacy `gift_bot`; portal `/dashboard/bots` (TG) + `/dashboard/bots/max`; nav labels.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` — smoke OK; `/dashboard/bots` + `/dashboard/bots/max` 200.
- Verify: shared build/tests; typecheck api/portal.

### 2026-08-03 — Gift bot billing: 500 ₽ per bot slot

- Goal: `gift_bot` was account-wide; now 500 ₽/мес per BotInstance (`gift` / `gift_max`).
- Changes: `getGiftBotSlots`; trial `botSlots:1`; checkout `quantity`+`intent` add|renew; soft-gate provision-link + max/connect; GET `/api/bots` slots/used + grandfather; portal CTAs.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` — backup under deploy stamp; smoke OK.
- Verify: shared tests; typecheck saas-api/portal; prod `/` + health 200.
- Broken: none. Residual: existing addons get lazy `botSlots=max(1,used)` on first GET.

### 2026-08-03 — Fix: gift bots page Telegram + MAX side-by-side

- Goal: Telegram connect was easy to miss (only after «Подключить канал»); MAX form always visible.
- Changes: `/dashboard/bots` — always-visible Telegram + MAX connect cards; CTA renamed «Telegram-бот».
- Deploy: `./scripts/prod-deploy.sh --skip-backup saas-portal` (smoke OK).

### 2026-08-03 — Deploy: MAX personal + gift (`saas-api`, `saas-portal`, `gift-bot-worker`, `max-bridge`, compose)

- Goal: ship ADR-025 MAX surfaces to prod (personal QR + gift Bot API).
- Commands: `./scripts/prod-deploy.sh saas-api,saas-portal,gift-bot-worker,max-bridge,compose` (1st fail: `qrcode==8.0` vs maxapi ≥8.2) → fix `apps/max-bridge/requirements.txt` → `./scripts/prod-deploy.sh --skip-backup …` OK.
- Also: `docker-compose.prod-npm.yml` Traefik `PathPrefix(/tg)||PathPrefix(/max)`; `prod-deploy.sh` `--profile max` for max-bridge.
- Backup: `/opt/voxly/backups/20260803-092240/` (`voxly_control.dump`, `twenty.dump`).
- Synced/rebuilt: packages + saas-api/portal + gift-bot-worker + max-bridge + compose files; volume `docker_max-sessions-data` created; containers Up.
- Migrate: no pending (25 already applied).
- Smoke: `/` 200; `api/health` 200; partners/crm/ai/agents 200; `/dashboard/ai/max` 200; `/dashboard/bots` 200.
- Broken: none observed. Residual: live QR + gift token E2E manual; gift needs MAX Bot API token from business.max.ru.

### 2026-08-03 — MAX Phase 3 polish (gift UX + CRM reply verify)

- Goal: finish gift_max bot detail UX; confirm CRM operator ChatMessage on MAX paths; defer personal AI agent.
- Changes: `/dashboard/bots/[botId]` — MAX checklist/hero/overview; hide TG 1.2 description + promo; renumber start/funnel; platform info card (soft «Продолжить»).
- Verify: CRM reply already persists `ChatMessage` role=operator after `ai_max`/`gift_max` send (`crm-chat.ts`); portal typecheck.
- Next: live PyMax QR + gift token E2E (`MAX-SMOKE.md`); media/presence/AI on `ai_max` later.
- Broken / gaps: MAX channel membership parity; CRM outbound media for MAX; AI agent on personal MAX still OFF/store-only (ADR-014/025).

### 2026-08-03 — MAX Phase 2 gift scaffold + Phase 1 polish

- Goal: gift MAX on official Bot API; lock ADR gift decision; continue personal scaffold.
- ADR-025: `botType=gift_max`, reuse SKU `gift_bot`; channel membership = soft «Продолжить» (gap).
- Changes: `gift-bot-worker` `/max/...` + `max-api.ts`/`max-handler.ts` + polling; `POST /api/bots/gift/max/connect`; crm-chat gift_max text reply; portal `/dashboard/bots` MAX token form + platform badge; Traefik PathPrefix `/max`; compose `GIFT_MAX_USE_POLLING`.
- Verify: typecheck gift-bot-worker / saas-api / portal.
- Next: live token E2E; PyMax QR personal smoke; media enrich for MAX later.
- Broken / gaps: MAX channel getChatMember parity; MAX gift media outbound from CRM; personal PyMax needs Python≥3.10 image (ok in Docker).

### 2026-08-03 — MAX Phase 1 foundation (personal account)

- Goal: personal MAX channel parity with GramJS (QR → CRM chat reply), without gift MAX yet.
- ADR-025: `botType=ai_max`, `platform=max` / `channel=max_personal`, SKU `ai_max` 500₽ + soft trial 7d; Python sidecar `apps/max-bridge` (PyMax); gift deferred Phase 2.
- Changes: shared PRODUCT_CODES/pricing/referral/AI_USAGE; platform-pricing; billing checkout; `routes/max.ts` + `max-internal.ts`; crm-chat labels + `sendViaMaxBridge` (text-only); portal `/dashboard/ai/max` + nav; compose profile `max` :3010 + volume; prod-deploy whitelist `max-bridge`.
- Verify: typecheck shared/saas-api/portal; unit shared tests for `ai_max`.
- Next: local smoke QR→inbound→CRM reply; Phase 2 gift MAX; PyMax handler wiring polish if library API differs.
- Broken / gaps: media/presence/AI agent on MAX = Phase 3; gift MAX not started; live PyMax E2E depends on library + phone scan.

### 2026-08-03 — Deploy: admin AI balance page + APIs

- Goal: ship `/admin/ai-balance` (nav «AI баланс») + `admin-ai-balance` APIs + owner markup lock on tenant PATCH; was missing from prior partner-balance deploy.
- Commands: `./scripts/prod-diff.sh saas-api,saas-portal` (hot-file drift: `tenant.ts`) → `./scripts/prod-deploy.sh --dry-run saas-api,saas-portal` → `./scripts/prod-deploy.sh saas-api,saas-portal`.
- Backup: `/opt/voxly/backups/20260802-232944/` (`voxly_control.dump`, `twenty.dump`). Prior partner-balance backup still at `/opt/voxly/backups/20260802-232549/`.
- Synced/rebuilt: manifests + `packages/` + `apps/saas-api/` + `apps/saas-portal/` + `twenty-app/voxly-crm-chat/`; compose `up -d --build saas-api saas-portal`.
- Migrate: no pending migrations (25 already applied).
- Verify: portal build lists `/admin/ai-balance`; container has `dist/routes/admin-ai-balance.js` + `.next/server/app/admin/ai-balance/page.js`; host src synced.
- Smoke: `/` 200; `api/health` 200 (`{"status":"ok"}`); `/admin/ai-balance` 200 (not 404; auth may still gate UI). Script also OK on partners/crm/ai dashboards. Brief 502 on landing during portal restart, recovered ~3s.
- Broken: none observed. Residual: logged-in superadmin E2E of markup PUT + stats not run; other uncommitted local admin surfaces (pricing/services) not in this ship scope.

### 2026-08-03 — Deploy: partner-balance checkout + mailing/AI topup opt-in

- Goal: ship partner balance apply on client checkouts, partners CTA `#oplata`, mailing billing banner + `ai_topup` opt-in to prod.
- Commands: `./scripts/prod-diff.sh saas-api,saas-portal` (hot-file drift: `dashboard/page.tsx`) → `./scripts/prod-deploy.sh --dry-run saas-api,saas-portal` → `./scripts/prod-deploy.sh saas-api,saas-portal`.
- Backup: `/opt/voxly/backups/20260802-232549/` (`voxly_control.dump`, `twenty.dump`).
- Synced/rebuilt: manifests + `packages/` + `apps/saas-api/` + `apps/saas-portal/` + `twenty-app/voxly-crm-chat/`; compose `up -d --build saas-api saas-portal`.
- Migrate: no pending migrations (25 already applied; `ReferralServiceRate` from prior deploy).
- Smoke: `/` 200; `api/health` 200; `/dashboard/partners` 200; `/dashboard/crm` 200; also `/dashboard/ai` + `/dashboard/ai/agents` 200 (script). Brief 502 on landing during portal restart, recovered in ~3s.
- Broken: none observed. Residual: functional E2E with free partner balance > 0 (partial/full cover) not run; Robokassa SuccessURL still global → CRM for card path; uncommitted local work still on branch (not git-pushed).

### 2026-08-03 — Admin AI balance: markup + stats

- Goal: restore/finish superadmin AI markup settings (global + per-tenant) and usage stats; add nav «AI баланс».
- Existed: `getEffectiveMarkup` / `AiUsageLog` / seed `ai_markup_percent`; `/admin` shows aggregate «AI маржа»; `PATCH /api/admin/settings` generic; no dedicated page/nav; owners could theoretically set markup via `PATCH /api/tenant`.
- Changes: `admin-ai-balance.ts` (`GET/PUT /api/admin/ai-balance*`); portal `/admin/ai-balance`; `ADMIN_NAV` entry; lock tenant PATCH markup.
- Stats: margin = ΣchargedRub − ΣproviderCostRub; topups = paid `ai_topup`; wallets snapshot; by channel + per tenant for period.
- Verify: `pnpm --filter @voxly/saas-api|@voxly/saas-portal exec tsc --noEmit` ok.
- Next: deploy `saas-api` + `saas-portal` (separate from sibling deploy).
- Broken / gaps: manual `ai-credit` not in topup paid sum; margin uses logged charged (includes uncollected portion in chargedRub, uncollected shown separately).

### 2026-08-03 — Partner balance: pay any Voxly service + withdrawal min 1000 ₽

- Goal: close residual INC-085 gaps — mailing + `ai_topup` opt-in; confirm withdrawal floor 1000 ₽.
- Changes: `MailingBillingBanner` + `PartnerBalanceApply`; `handleMailingBillingGate` → mailing `?pay=1` (no silent checkout); `?pay=1` auto-Robokassa only when free balance = 0; agents `ai_topup` wired; dashboard «Пополнить AI» → `/dashboard/ai/agents#balance`; partners copy (any services + вывод от 1000 ₽). Withdrawal min already `REFERRAL_WITHDRAWAL_MIN_RUB=1000` (API+UI) — verified, no code change.
- Verify: `pnpm --filter @voxly/saas-api|@voxly/saas-portal exec tsc --noEmit` ok.
- Next: deploy `saas-portal` (API unchanged for this gap-close); smoke mailing pay + topup with balance > 0.
- Broken: none. CRM Twenty «Оплатить» still opens portal `?pay=1` (no in-CRM checkbox — by design, opt-in on portal banner).

### 2026-08-03 — INC-085: partner balance apply on checkout (CRM + AI + gift)

- Goal: partners «Оплатить свой счёт» / «Зачесть партнёрский баланс» actually works where copy promises it.
- Cause: CRM had checkbox + API `applyBalanceRub`; AI/gift pay buttons skipped balance; CTA missed `#oplata`; full-cover always redirected to CRM.
- Changes: `PartnerBalanceApply` + `usePartnerBalanceApply`; CRM uses shared UI; AI TG/extra/GramJS/WA/agent + gift bots wired; partners link `/dashboard/crm#oplata`; billing `checkoutPaidRedirect(productCode)`.
- Verify: `pnpm --filter saas-portal|saas-api exec tsc --noEmit` ok.
- Next: deploy `saas-api` + `saas-portal`; smoke with free partner balance > 0 (partial + full cover).
- Broken: mailing one-click pay still without balance opt-in; Robokassa SuccessURL still global → CRM (card path).

### 2026-08-03 — Deploy: partner per-service commission rates

- Goal: ship `ReferralServiceRate` + admin partners per-SKU % UI to prod.
- Commands: `./scripts/prod-diff.sh saas-api,saas-portal` (hot files match) → `./scripts/prod-deploy.sh --dry-run saas-api,saas-portal` → `./scripts/prod-deploy.sh saas-api,saas-portal`.
- Backup: `/opt/voxly/backups/20260802-225621/` (`voxly_control.dump`, `twenty.dump`).
- Synced/rebuilt: manifests + `packages/` + `apps/saas-api/` + `apps/saas-portal/` + `twenty-app/voxly-crm-chat/`; compose `up -d --build saas-api saas-portal`.
- Migrate: `20260803120000_referral_service_rate` applied; `ReferralServiceRate` present; prisma status up to date (25 migrations).
- Smoke: `/` 200; `api/health` 200 `{"status":"ok"}`; `/admin/partners` 200; dashboard partners/crm/ai/agents 200. Dist has `admin-referrals.js` + `ReferralServiceRate` refs in billing/referral-program.
- Broken: none observed. Residual: set a live partner SKU rate and verify payout on referred payment (functional E2E not run in this deploy).

### 2026-08-03 — Per-partner per-service referral commission rates

- Goal: on `/admin/partners`, keep global/default %, add individual % per partner **and service SKU**.
- Changes: Prisma `ReferralServiceRate` (`tenantId`+`productCode` unique, percent 0–100) + migration `20260803120000_referral_service_rate`; shared `REFERRAL_COMMISSION_SKUS`/`LABELS`; `findReferralServicePercent` + billing `creditReferralForPayment` (SKU override → else personal/global rule; SKU rate makes that product eligible even if productScope would exclude it); admin `PUT/DELETE …/service-rates`; partner detail UI «Ставки по сервисам».
- AuditLog: not added (referral rule PUT never audited; same policy).
- Verify: prisma generate; typecheck packages; shared unit test for commission SKU catalogue.
- Next: migrate + deploy `saas-api`/`saas-portal` when ready; smoke set rate on a partner SKU and pay that product via referred tenant.

### 2026-08-03 — Admin pricing (all SKUs) + services ops panel

- Goal: platform + per-tenant list prices for CRM/AI/gift/mailing; ops panel without full client CRUD.
- Changes: `platform-pricing.ts` resolver; billing + bots/WA/GramJS/agents/mailing APIs use effective price; `GET/PUT /api/admin/pricing*`; `/admin/pricing` + `/admin/services`; impersonate `next`; MRR via resolver; CRM page keeps CRM editors + link to Тарифы.
- Policy: next-checkout-only; min 1 ₽; AuditLog on price/addon/bot changes.
- Deploy: backup `/opt/voxly/backups/20260802-223635/`; rsync (script SSH timeout → manual keepalive rsync) + migrate (24, no pending) + rebuild `saas-api`/`saas-portal`.
- Verify: typecheck; prod smoke `/admin/pricing` + `/admin/services` + api health 200.
- Next: reset smoke 5 ₽ overrides when done; sync Robokassa P2 (INC-083).

### 2026-08-03 — INC-084: purge fails when tenant is referral partner

- Goal: admin delete `john` / `john-crm` actually removes control Tenant.
- Cause: `Referral.referrerTenantId` RESTRICT; john → johntest referral blocked `DELETE Tenant` after Twenty hard-drop.
- Fix: `purge-tenant` deletes referrer Referral rows; migration `20260803010000_referral_referrer_cascade`.
- Deploy: `saas-api` (+ migrate). Verify: purge john → gone from admin list / DB.

### 2026-08-02 — Post-pay check: lexx purge, disk prune, Result P2

- Goal: после live-платежа проверить тенантов, purge `lexx`, диск VPS, задеплоить/залить GitHub.
- Verify: 6 tenants active (lexx gone); AuditLog `purge_tenant` 21:42Z + Twenty workspace `633dc627-…` absent; CRM `*-crm` 200; API health ok; johntest addons paid; gesha InvId **1025** Result fail → INC-083, затем fulfilled → sub active → 2026-09-09.
- Disk: 92% → **27%** via `docker image prune -af` (~61GB) + journal vacuum (repeat of INC-052 pattern). Volumes untouched.
- Deploy/git: commit remaining onboarding/kanban/referral/purge + Result fail logging; `prod-deploy.sh saas-api,saas-portal`.
- Broken / Next: **обновить Robokassa Password#2 в prod `.env`** (P1 ok, P2 mismatch); убрать 5 ₽ override у gesha/johntest когда smoke закончен.

### 2026-08-02 — GetVoxlybot OTP + admin bot + live Robokassa

- Goal: Telegram OTP register/login via `@GetVoxlybot`, `/admin/bot`, cabinet support teaser, live Robokassa, deploy + GitHub.
- Changes: `apps/platform-bot-service` (:3009, webhook `/bots/platform`); Prisma `AuthOtpChallenge` / subscribers / support / broadcasts; auth `register|login` start/confirm; portal OTP UI; dashboard support blurb; admin bot page; scheduler expiry notify + broadcast scanner; compose + `prod-npm` Traefik `entrypoints=web`; prod `.env` `PLATFORM_BOT_*` + live Robokassa `IS_TEST=0` (secrets not in git).
- Deploy: backup `/opt/voxly/backups/20260802-203458/`; `prod-deploy.sh saas-api,saas-portal,platform-bot-service,compose` (+ compose label fix).
- Verify: migrate up to date (23); `/bots/platform/health` **200**; `register/start` → `needsOtp` + `@GetVoxlybot` deep-link; container `ROBOKASSA_IS_TEST=0`; sample URL `OutSum=5.00` **without** `IsTest`; johntest `crm_base` override **5 ₽**.
- Broken: none known at ship; rotate bot token / Robokassa passwords after chat exposure.
- Next: user completes real 5₽ pay → Result `OK{InvId}`; restore johntest CRM price; full OTP E2E in Telegram.

### 2026-08-02 — Smoke: новый портал без install-apps + Канбан

- Goal: подтвердить provision path после INC-080/081.
- Verify: register `smokekan224944` → active ~15s; `onboardingStatus=COMPLETED`, 0 ONBOARDING keys; INDEX «Канбан» type=KANBAN + 6 groups; logs `cleared 2` + `kanban=1`. Tenant purged (control + Twenty).
- Side-fix: `purge-tenant` hard-drop — null application file FKs before DELETE file/workspace (RESTRICT).
- Deploy: `saas-api` (purge fix).

### 2026-08-02 — INC-081: Канбан был TABLE со значком

- Goal: Сделки INDEX = реальный KANBAN, не список с подписью «Канбан».
- Changes: `ensureOpportunityRuDefaults` + `set-opportunity-kanban-default.sql` — type/groupBy/viewGroups; no `fm.deletedAt`.
- Fix johntest: SQL UPDATE → KANBAN + 6 groups; Redis view cache flush.
- Deploy: `saas-api` → backup `/opt/voxly/backups/20260802-194338/`.
- Verify: hard-refresh johntest-crm `/objects/opportunities` → колонки этапов.

### 2026-08-02 — INC-080: skip `/install-apps` после провижининга

- Goal: новые CRM не показывают экран установки приложений.
- Changes: `twenty-clear-onboarding.ts` (SQL DELETE `ONBOARDING_*_PENDING`); call early + after chat install in `queues.ts`; log GraphQL skip failures; `skipSyncEmailOnboardingStep` in twenty-client.
- Verify: johntest `onboardingStatus=COMPLETED`, 0 onboarding keys — hard-refresh CRM. Deploy `saas-api` → backup `/opt/voxly/backups/20260802-192427/`.
- Next: боевая Robokassa (live P1/P2).

### 2026-08-02 — INC-077: снять лимит 5 Twenty workspaces

- Goal: новые клиенты получают CRM после 5-го workspace без enterprise JWT.
- Changes: `docker/patch-twenty-workspace-limit.cjs` (5→100000); `twenty.Dockerfile` + `prod-deploy.sh` whitelist.
- Deploy: `./scripts/prod-deploy.sh twenty` → backup `/opt/voxly/backups/20260802-185015/`. Re-enqueue johntest provision job 7 → **Completed**.
- Verify: `johntest` `twentyWorkspaceId` set; 6 workspaces ACTIVE; CRM chat installed.
- Next: hard-refresh `/dashboard/crm` у johntest; боевая Robokassa когда будут live Password#1/#2.

### 2026-08-02 — Partner links → `/?ref=` (landing → register)

- Goal: реф-ссылка ведёт на лендинг; «Попробовать» несёт код в регистрацию.
- Changes: API/UI links `https://domain/?ref=CODE`; landing `ReferralCapture` + `RegisterLink`; register sessionStorage fallback; `/r/CODE` → `/?ref=CODE`.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260802-174526/`; portal SSR-fix `/?ref=` in CTA.
- Verify: `curl https://getvoxly.ru/?ref=JOHNTEST` содержит `/register?ref=JOHNTEST`; `/r/CODE` → `/?ref=CODE`.
- Next: регистрация по рефу + demo Robokassa → баланс партнёра.

### 2026-08-02 — Fix `/r/{CODE}` referral short links 404 (INC-076)

- Goal: короткие партнёрские ссылки `getvoxly.ru/r/CODE` открываются, а не 404.
- Changes: `apps/saas-portal/src/app/r/[code]/route.ts` (click via API + 302 `/register?ref=`); CAPABILITIES + INC-076.
- Deploy: `./scripts/prod-deploy.sh saas-portal` → backup `/opt/voxly/backups/20260802-173336/`.
- Verify: `curl -sI https://getvoxly.ru/r/JOHNA130` → 302 → `https://getvoxly.ru/register?ref=JOHNA130` (same for JOHNTEST). Redeploy fixed localhost Location (x-forwarded-host).
- Next: регистрация по реф-коду + demo Robokassa → баланс партнёра.

### 2026-08-02 — Gift bots list: информативность как у partners

- Goal: `/dashboard/bots` понятнее для оператора — итоги + next-step по каждому боту.
- Changes: шаги 1–2–3, блок «Итоги» (каналы/посты/клики/подарки), RU-статусы, CTA по пробелу; API `giftedCount`.
- Deploy: `saas-api,saas-portal`. Commit `4eba6d6`. Smoke **200**.

### 2026-08-02 — Gift bot detail в стиле partners

- Goal: `[botId]` как partners — orange hero, шаги 1–2–3, land-секции.
- Changes: `gift-bot-detail-hero.tsx`; readiness grid; секции `land-display` / `border-black/10`.
- Deploy: `./scripts/prod-deploy.sh saas-portal`. Commit `02df37e`.
- Verify: smoke portal **200**. Hard-refresh `/dashboard/bots/<id>`.

### 2026-08-02 — Gift bots UX (partners-style hero + billing + checklist)

- Goal: `/dashboard/bots` и `[botId]` информативнее, в стиле partners; честный биллинг `gift_bot`; next-step checklist.
- Changes: `gift-bots-hero.tsx`; list page CTA trial/оплата/`startCheckout`; detail readiness strip + pay; API `trialAvailable` via `trialMeta`; copy без «500 за канал».
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup under `/opt/voxly/backups/` (script run). Smoke `/` partners crm ai agents **200**; `/dashboard/bots` **200**.
- Commit: `ad77bf9` pushed `ui/indigo-shadcn-dashboard`.
- Next: hard-refresh bots pages; проверить CTA оплаты на trial.

### 2026-08-02 — Prod deploy Phase-0 hardening (`saas-api`)

- Goal: выкатить на prod фиксы release-gate (OutSum, trialConsumed, read-only agent capacity, login membership, scheduler lock, findMany caps) после коммита `b77c375`.
- Deploy: `./scripts/prod-diff.sh saas-api` (drift queues.ts, auth.ts) → `./scripts/prod-deploy.sh saas-api`. Backup **`/opt/voxly/backups/20260802-111009/`** (`voxly_control.dump` 298K + `twenty.dump` 2.4M). Prisma migrate: no pending migrations. Пересоздан `docker-saas-api-1`.
- Pre-check: на prod **1× `ai_tg` + 4× `gift_bot`** с `trial=true` без `trialConsumed` — после деплоя могут снова получить trial, если не проставить `trialConsumed` вручную.
- Post: backfill `trialConsumed` на 5 addon (`UPDATE 5`, unconsumed **0**).
- Verify: smoke **200** — `/`, `api/health` (+ body), `/dashboard/partners`, `/dashboard/crm`, `/dashboard/ai`, `/dashboard/ai/agents`.
- Broken: ничего.
- Next: `git push` — **done** (`ui/indigo-shadcn-dashboard`); локально `pnpm test:db` при поднятом Docker.

```sql
-- prod postgres-control / voxly_control (один раз)
UPDATE "Addon"
SET config = config::jsonb || '{"trialConsumed": true}'::jsonb
WHERE type IN ('ai_tg', 'gift_bot')
  AND (config::jsonb->>'trial') = 'true'
  AND (config::jsonb->>'trialConsumed') IS DISTINCT FROM 'true';
```

### 2026-08-02 — Release verification scenario (tests + Phase-0 hardening)

- Goal: сценарий предрелизной проверки по 7 направлениям — закрыть найденные дыры в деньгах/доступах, заложить фундамент API-тестов, CI и методику.
- Changes:
  - **Phase 0 fixes:** Robokassa `OutSum` vs `Payment.amount` (`paymentAmountMatchesOutSum`); `ai_tg`/`gift_bot` trials через `startChannelTrial` + `trialConsumed`; `resolveAgentCapacity` read-only (no free addon on GET); login `pickPrimaryMembership` (owner + earliest `createdAt`); scheduler Redis NX lock (`scheduler-lock.ts`); `take` caps on broadcast audience + partner dashboard + admin tenants + gift schedules.
  - **Test foundation:** `export buildServer`, `VOXLY_DISABLE_WORKERS`, `scripts/test-db.sh`, helpers/factories, vitest for `apps/saas-api/tests/*` (skipIf DB down).
  - **Coverage:** money/idempotency/tenant isolation, status matrix, integration degradation, unit-econ invariants, findMany guards, configurability; Playwright e2e stubs; `pnpm verify`; `.github/workflows/ci.yml`; expanded prod smoke; `docs/agent/RELEASE-CHECKLIST.md`; `scripts/unit-econ-report.ts`, `scripts/perf-seed-and-measure.ts`.
- Verify: `pnpm --filter @voxly/shared --filter @voxly/billing build && pnpm test` (DB tests skip without Postgres); typecheck API after build.
- Broken: local Colima/Docker was down during implementation — integration tests skip until `pnpm test:db`.
- Next: поднять postgres-control, прогнать полный `pnpm verify` + e2e против локального API/portal; задеплоить Phase-0 фиксы на prod после проверки числа тенантов с «вечным» ai_tg trial.

### 2026-08-02 — Явный пробный период в Телеграм Секретаре + порядок секций AI-агентов (prod)

- Goal: сделать триал заметным на `/dashboard/ai` (раньше хиро писал просто «Подписка до <дата>», признаком триала был мелкий бейдж в секции 01, а кнопка звала «Продлить на месяц», хотя на триале это первая оплата) и выстроить `/dashboard/ai/agents` по реальному порядку работы.
- Changes:
  - `77c2d22` — `dashboard/ai/page.tsx` + `ai-secretary-hero.tsx`: хиро и карточка «Состояние канала» прямо говорят «Пробный период» с остатком в днях; добавлено объяснение последствий окончания триала (бот перестанет принимать сообщения, переписка и контакты в CRM сохранятся); кнопки оплаты переименованы под текущее состояние; под состоянием тенанта появился блок «следующий шаг». Карточка состояния получила `role="status"` + `aria-live="polite"`.
  - `f350f24` — `dashboard/ai/agents/page.tsx`: пополнение баланса шло перед секциями про самих агентов, расход дублировал индекс 01. Новый порядок со сквозной нумерацией 00-06: тариф, пополнение, создание агента, список агентов, назначение, расход, история.
  - Бизнес-логика, API и воркеры не тронуты — чистый фронтенд `saas-portal`.
- Deploy: `./scripts/prod-diff.sh saas-portal` → all compared paths match. `--dry-run` → `./scripts/prod-deploy.sh saas-portal`. Backup **`/opt/voxly/backups/20260801-212441/`** (`voxly_control.dump` 296K + `twenty.dump` 2.4M). Prisma migrate пропущен (нет prisma-сервисов в деплое). Тома не трогались, прод `.env` не синкался, пересоздан только `docker-saas-portal-1`.
- Verify: `next build` OK — 27/27 страниц, `/dashboard/ai` 12.4 kB, `/dashboard/ai/agents` 10.5 kB. Скриптовый smoke: `/` 404 на cold start → **200** через 3s, `api/health` **200**. Ручная проверка: `https://getvoxly.ru/` `https://api.getvoxly.ru/health` `https://getvoxly.ru/dashboard/ai` `https://getvoxly.ru/dashboard/ai/agents` — все **200** (не 500).
- Broken: ничего. Untracked `.cursor/skills/**` и `serviceapp_design_system.*` остались в рабочем дереве вне коммитов и вне whitelist деплоя.
- Next: ротировать root SSH пароль (снова светился в чате).

### 2026-08-01 — Телеграм Секретарь IA + AI-агент SKU + GramJS как WhatsApp (prod)

- Goal: кабинетное меню и AI-поверхности по продуктовой модели — «Телеграм Секретарь» / Telegram / WhatsApp / AI-агенты; агент 500₽/мес; секретарь 1000₽/10 акк.
- Changes:
  - Nav (`app-shell.tsx` + home products): Дашборд → Партнерская → CRM → AI-агенты → WhatsApp → Telegram → Телеграм Секретарь → Бот выдачи подарков → Рассылка.
  - `/dashboard/ai` — единая страница секретаря; `[botId]` → redirect `?bot=`; Suspense вокруг `useSearchParams` (иначе next build падает).
  - `/dashboard/ai/gramjs` — landing как WhatsApp; label Telegram.
  - SKU `ai_agent` 500₽ + grandfather migration `20260731220000_ai_agent_slots_grandfather`.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal`. Первый прогон: migrate applied, portal build FAIL (missing Suspense) → fix `c7883f3` → повторный деплой OK. Backup **`/opt/voxly/backups/20260801-205426/`** (+ второй backup на ретрае).
- Verify: migrate `20260731220000` applied; 1× `Addon type=ai_agent` grandfathered. Smoke `/` `/dashboard/ai` `/agents` `/gramjs` `/whatsapp` `/dashboard/ai/<oldBotId>` + API health **200**. HTML содержит «Телеграм Секретарь» / «Партнерская» / «Бот выдачи подарков».
- Broken: nothing lasting (first portal build failed, fixed before second ship).
- Next: ротировать root SSH пароль (светился в чате).

### 2026-07-31 — Admin `/admin/partners` + per-tenant referral rules + referral transactions (prod)

- Goal: супер-админский surface для партнёрской программы — обзор партнёров, индивидуальные правила вознаграждения, ручные выплаты/корректировки, блокировка; плюс уникальность реферальных кодов в кабинете.
- Changes: `packages/db` — `ReferralRule.tenantId` (nullable, `@@unique([tenantId])`), новая модель `ReferralTransaction` + enum `ReferralTxKind` (`payout` / `manual_credit` / `manual_debit`), back-relations на `Tenant`; миграция `20260731140000_referral_admin` (чисто аддитивная: CREATE TYPE / ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD FK, byte-identical к `prisma migrate diff`). API — новый `admin-referrals.ts` (`/api/admin/referrals`: `GET /`, `GET /partners/:tenantId`, `PUT /rule`, `PUT /partners/:tenantId/rule`, `POST /partners/:tenantId/transactions`, `PATCH /codes/:id`, `PATCH /campaigns/:id`, `PATCH /partners/:tenantId/block`, `PATCH /referrals/:id`) + `services/referral-admin.ts`; резолв правила вынесен в `referral-program.ts` (разрыв циклической зависимости), `billing.ts` считает вознаграждение по per-tenant правилу; `referral.ts` — 409 на занятый кастомный код + `GET /campaigns/code-available`. Портал — `/admin/partners` (`admin-partners-rule.tsx`, `admin-partners-detail.tsx`), пункт в `ADMIN_NAV` (`app-shell.tsx`); UX-доработки `admin/crm`, `dashboard/crm`, `dashboard/partners` + hero-компоненты.
- Deploy: `./scripts/prod-diff.sh saas-api,saas-portal` → all compared paths match. `./scripts/prod-deploy.sh --dry-run saas-api,saas-portal` → `./scripts/prod-deploy.sh saas-api,saas-portal`. Backup **`/opt/voxly/backups/20260731-131927/`** (`voxly_control.dump` 273K + `twenty.dump` 2.4M). Тома не трогались, `.env` не синкался.
- Migration on prod: `docker exec -w /voxly/packages/db docker-saas-api-1 ./node_modules/.bin/prisma migrate deploy` → applied `20260731140000_referral_admin` (единственная pending из 17).
- Verify: `psql voxly_control` — таблица `ReferralTransaction` (id/tenantId/kind/amountRub/note/adminUserId/createdAt), `ReferralRule.tenantId text NULL`, enum `ReferralTxKind` = payout/manual_credit/manual_debit, `_prisma_migrations` последняя запись `20260731140000_referral_admin`. Smoke: `/` `api/health` `/admin/partners` `/admin/crm` `/dashboard/crm` `/dashboard/partners` — **200**; `GET /api/admin/referrals` без токена — **401** (не 404 → маршруты зарегистрированы). Логи `saas-api` без ошибок; скриптовый smoke сразу после recreate дал 502 (штатный cold start), после прогрева 200.
- Broken: ничего. Изменения остаются незакоммиченными в рабочем дереве (коммит не запрашивался).
- Next: коммит на ветке; ротировать root SSH пароль (светился в чате).

### 2026-07-31 — CRM page IA rework (subscription state, seats, itemized checkout)

- Goal: сделать `/dashboard/crm` понятной — состояние подписки в одном месте, ясная модель мест, читаемый счёт, таблица команды.
- Changes: `tenant.ts` GET `/crm` — additive read-only `subscription.startsAt` (для прогресса периода; в `/dashboard` он уже отдавался). `crm-portal-hero.tsx` — hero несёт адрес CRM + copy + «Открыть CRM» + остаток дней (отдельная секция «Адрес CRM» удалена). `dashboard/crm/page.tsx` — единый `subState` (trial/active/grace/locked/none) с бейджем, прогресс-баром периода и абзацем «что дальше»; «как это работает» (3 шага) для владельца и разъяснение для сотрудника; счётчик мест с progressbar и объяснением базовых/докупленных; постатейный счёт (тариф × мес, доп. места, скидка из `PERIOD_DISCOUNTS`, итого, дата продления); таблица команды Сотрудник/Роль/Доступ в CRM/Действия; empty state; двухшаговое подтверждение удаления; touch targets 44px, aria-label на иконочных кнопках.
- Business logic не тронута: `computeCrmCheckoutTotals`, `startCheckout`, invite/credentials/reissue/remove, alert-состояния и модалка доступа — как были.
- Дополнено: модалка доступа закрывается по `Escape` и клику по подложке (`role="presentation"` на подложке, `role="dialog"` + `aria-modal` на панели, общий `closeCredsModal`).
- Verify: `tsc --noEmit` saas-portal + saas-api чисто; `pnpm --filter @voxly/saas-portal build` — 26/26 страниц, `/dashboard/crm` 11.8 kB. Deploy `./scripts/prod-deploy.sh saas-api,saas-portal`; smoke 502 cold start, после прогрева `/` `/dashboard/crm` `/dashboard/partners` `/admin/crm` + API health **200**.
- Next: commit на ветке `ui/indigo-shadcn-dashboard`; ротировать root SSH пароль (передавался в чате).

### 2026-07-31 — Partners page UX rework (tables, funnel, reward rule)

- Goal: убрать дублирующий блок «Основная ссылка», сделать страницу понятной и информативной.
- Changes: `referral-program.ts` — dashboard отдаёт `rule` (default `ReferralRule`: type/value/durationMonths) для явного «сколько вы зарабатываете». `partners-portal-hero.tsx` — hero несёт код + URL + copy + переходы + баланс. `dashboard/partners/page.tsx` — блок «Как это работает» (3 шага), пресеты периода (месяц/30д/год/всё время) + кастомные даты, воронка Переходы→Регистрации→Оплаты с конверсиями, таблицы вместо текстовых строк (`overflow-x-auto`, tabular-nums, заголовки колонок), progressive disclosure для форм создания ссылки и расхода, empty state с действием, статусы бейджами success/warning, `expenses` из API выведены отдельной секцией.
- Verify: `tsc --noEmit` saas-api + saas-portal чисто. Deploy `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260731-115...`; smoke 502 cold start, после прогрева `/` `/dashboard/partners` `/dashboard/crm` + API health **200**.
- Next: commit на ветке; ротировать root SSH пароль (передавался в чате).

### 2026-07-31 — Partners page CRM-style UI (prod)

- Goal: Style `/dashboard/partners` like `/dashboard/crm` (amber hero, `landing-root`, stat cards).
- Changes: `partners-portal-hero.tsx` (new); `dashboard/partners/page.tsx` restyled — no functional API changes.
- Deploy: `./scripts/prod-deploy.sh saas-portal` → backup `/opt/voxly/backups/20260731-112230/`; portal rebuilt+recreated; initial smoke 404 (cold start), post-check `/` `/dashboard/partners` `/dashboard/crm` + API health **200**.
- Next: commit partners UI on branch; rotate root SSH password (shared in chat).

### 2026-07-30 — Admin CRM resources: real disk only, no per-tenant RAM estimate

- Goal: Show honest resource usage on `/admin/crm` — factual disk per client; remove misleading proportional RAM estimates.
- Changes: `tenant-resource-usage.ts` — drop `memoryBytesEstimate`; disk label includes mount path; portal table shows `{used} / {server total}` + Twenty·CP·AI breakdown; RAM column «н/д (общий стек)»; platform header real server RAM/disk. `billing.ts` webhook — paid `crm_base` uses `loadTenantCrmPricing().seatsIncluded` (platform/override) not hardcoded constant.
- Verify (local): typecheck/lints clean; onboarding pricing path — register trial `PRICING.SEATS_INCLUDED`, checkout + GET `/crm` via `loadCrmPlatformPricing` + tenant overrides, billing webhook now syncs seats from tenant pricing.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-162401/`; build OK; smoke 502 cold-start then `/` + `/admin/crm` + API health **200**.

---

- Goal: Fix per-tenant «Мест в тарифе» not persisting on reset/save; clarify RAM estimate vs real disk in resources section.
- Root cause: `saveTenantCrmPricing` deleted seats override on platform default but did not reset `Subscription.seatsIncluded`; `loadTenantCrmPricing` fell back to stale subscription (e.g. 100).
- Changes: `crm-tenant-pricing.ts` — always sync active `crm_base` subscription seats on save (including reset to platform 10); portal `/admin/crm` — seats validation (min 1), pricing hint, RAM/disk tooltips and copy.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-161354/`; build OK; smoke 502 cold-start then portal + API + `/admin/crm` **200**.
- Verify: john admin → reset seats to 10 → save → reload shows 10; explicit 50/100 persists after reload.
- Next: rotate root SSH password (shared in chat).

### 2026-07-30 — CRM checkout: tenant pricing in «Тариф и оплата»

- Goal: Fix client cabinet checkout block showing hardcoded 500 ₽ instead of per-tenant API pricing.
- Root cause: `computeCrmCheckoutTotals` used `PRICING.CRM_BASE_MONTHLY` / `EXTRA_SEAT_MONTHLY` from `@voxly/shared`; stat cards already used `data.pricing` from API.
- Changes: `apps/saas-portal/src/lib/crm-pricing.ts` — accept `baseMonthly`/`extraSeatMonthly` rates; `dashboard/crm/page.tsx` — pass `data.pricing` into checkout totals. Backend (`tenant.ts` GET `/crm`, `billing.ts` checkout, `crm-tenant-pricing.ts` save/load with 0) already correct.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-160526/`; portal rebuilt+recreated; API cached (no API diff). Smoke transient 404 on `/` during restart; post-check `/` + `/dashboard/crm` + API health **200**.
- Verify: john owner → `/dashboard/crm` → «Тариф и оплата» shows **0 ₽** (CRM Base · 1 мес + «Оплатить 0 ₽») matching stat cards; extra seats × 0 ₽.
- Next: none.

### 2026-07-31 — Партнёрская программа `/dashboard/partners`

- Goal: Sidebar page for referral links by project, stats (clicks/reg/paid/earned), manual expenses, period filter.
- Changes: `ReferralCampaign` + `ReferralCampaignExpense` + `Referral.campaignId`; `referral-program.ts`; API dashboard/campaigns/expenses; portal page + nav; register `?ref=` prefill; click → `/register?ref=`.
- Verify: migrate prod `20260731120000_referral_campaigns`; deploy api+portal; `/dashboard/partners`.

### 2026-07-30 — Admin CRM: отчёт, индив. тарифы, RAM/диск по клиентам

- Goal: CRM admin — per-tenant pricing, revenue report (date range), platform + per-client disk/RAM snapshot on `/admin/crm`.
- Changes: `crm-tenant-pricing.ts`, `crm-admin-report.ts`, `tenant-resource-usage.ts`; `GET /api/admin/crm/report`, `/crm/resources`, `PUT /crm/tenants/:id/pricing`; portal report block, pricing editor, resource bars (RAM ≈ estimate from disk share); dedupe `/crm/resources` route.
- Deploy: rsync + build OK; backup `/opt/voxly/backups/20260730-155428/`; fixed orphan `de516e27417e_docker-saas-api-1` conflict → `docker-compose up -d saas-api saas-portal`. Smoke API health + `/admin/crm` **200**.
- Verify: hard-refresh `https://getvoxly.ru/admin/crm` → «Отчёт CRM», «Ресурсы платформы», per-client «Тариф» expand.
- Next: rotate root SSH password (shared in chat); optional true per-tenant RAM if cgroups added later.

### 2026-07-30 — Admin CRM: report, per-tenant pricing, resource bars

- Goal: Finish super-admin CRM page — revenue report, per-tenant tariff overrides, platform/tenant RAM+disk snapshot with 60s auto-refresh.
- Changes: `tenant-resource-usage.ts` (platform `/proc/meminfo` + disk statfs; per-tenant Twenty schema + control plane + AI files; RAM estimate by disk share); `crm-tenant-pricing.ts` + `crm-admin-report.ts`; `GET /api/admin/crm/report`, `GET /api/admin/crm/resources`, `PUT /api/admin/crm/pricing`, `PUT /api/admin/crm/tenants/:id/pricing`; portal `/admin/crm` report block, resource bars (RAM labeled estimate), per-tenant pricing editor, 60s refresh.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-155410/` (volumes untouched). Docker recreate glitch on first pass; `docker-compose up -d` retry OK.
- Verify: `https://api.getvoxly.ru/health` **200**; `https://getvoxly.ru/admin/crm` **200**; container dist includes `crm/resources`.
- Next: **rotate root SSH password** (shared in chat).

### 2026-07-30 — Super-admin CRM портал (`/admin/crm`) + platform pricing

- Goal: Replace hash-nav admin sidebar with Обзор + CRM портал; manage global CRM tariff/extra seat; list/delete portals; open CRM as owner; impersonate cabinet.
- Changes: `crm-pricing-settings.ts`; `GET/PUT /api/admin/crm[/pricing]`, impersonate + crm-login; billing/tenant load platform prices; portal `/admin/crm` + `ADMIN_NAV`; JWT audit actors use `sub` (not missing `userId`).
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-153129/` (volumes untouched). Smoke: portal `/` + `/admin` + `/admin/crm` **200**; API health **200**. Build includes route `/admin/crm`.
- Verify: hard-refresh `https://getvoxly.ru/admin` → sidebar Обзор / CRM портал; open `/admin/crm`.
- Next: optional unsuspend UI (still open from ADR-023).

### 2026-07-30 — Hard CRM lock when subscription ends (ADR-023)

- Goal: «оплата закончилась → CRM закрыта» — SSO, portal, invite, chat, direct Twenty login.
- Changes: `evaluateCrmAccess` in `@voxly/shared`; `crm-access.ts` + `twenty-workspace-activation.ts`; gate `crm-login` / invite / crm-chat(+media); portal paywall; scheduler+admin suspend → Twenty INACTIVE; Robokassa `crm_base` → ACTIVE.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-123748/` (volumes untouched). Smoke initially 502 (cold start), then portal+API **200**.
- Verify: unit tests on evaluateCrmAccess (61✓); do **not** expire john on prod — use helper tests or non-prod tenant / admin suspend on throwaway.
- Next: optional admin «unsuspend» UI that also restores Twenty ACTIVE.

### 2026-07-30 — CRM identity: workspace «john» vs Тест2 + Chat «Менеджер»

- Goal: Fix confusion (sidebar john vs Тест2) and Chat author label «Менеджер» for invited members.
- Root cause: sidebar = Twenty workspace `displayName` (slug); Chat `/s` proxy is service-token → no Voxly user → hardcoded «Менеджер».
- Changes: `resolveTwentyOperatorLabel` + `X-Twenty-User-Workspace-Id` in get/reply proxy; shell-ux «CRM · slug» + «Вы: …»; crm-chat **0.1.23**.
- Deploy: rsync + `saas-api` (no-cache) + `twenty`; backup `/opt/voxly/backups/20260730-123434/`; refresh-crm-chat john/lexx/antontest/antontest3 → apps **0.1.23**.
- Verify: hard-refresh as test2 → «CRM · john» + «Вы: Тест2…»; reply bubble uses Тест2 (not Менеджер). Shell-ux served with `CRM · `; API health **200**.

### 2026-07-30 — CRM team: show names + edit password without auto-rotate

- Goal: «Редактировать» shows current password (no auto-change); owner sets new password explicitly; «Команда CRM» shows Twenty profile names (Тест2) when Voxly User name empty.
- Changes: `GET /api/tenant/members/:id/credentials`; reissue accepts `{ password? }`; `fetchTwentyMemberDisplayNames` for `GET /tenant/crm`; portal modal editable password + Save.
- Deploy: `saas-api,saas-portal` (backup `/opt/voxly/backups/20260730-113714/`; retry `--skip-backup` completed).
- Verify: portal+API health **200**; container has `twenty-member-display-names` + credentials route. Hard-refresh `/dashboard/crm`.

### 2026-07-30 — Commit INC-073 + confirm DB migrations / name backfill

- Goal: Persist delete-member fix; ensure control DB migrations + portal names for clients.
- Git: `06da880` Fix CRM member delete GraphQL type (`String!`).
- DB: `prisma migrate deploy` on prod → **No pending migrations** (`20260730020000_tenant_member_twenty_password` already applied).
- Backfill: Voxly `User.firstName/lastName` from Twenty `workspaceMember` where empty (antontest/lexx/efim1/john owner). New tenants still get names live via `fetchTwentyMemberDisplayNames` + invite flow.
- Verify: migrate clean; john members list reflects remaining seats after deletes.

### 2026-07-30 — INC-073 fix delete member GraphQL String!

- Goal: Portal Delete member failed with CRM remove error.
- Cause: `deleteUserFromWorkspace` var typed `UUID!`; Twenty expects `String!`.
- Changes: `@voxly/twenty-client` mutation; deploy `saas-api` backup `/opt/voxly/backups/20260730-125406/`.
- Verify: API health 200; Delete on `/dashboard/crm` for test2+.

### 2026-07-30 — Persist CRM portal defaults (commit)

- Goal: Save all CRM portal / billing / member / lock / identity UX as defaults for portal + new Voxly tenants.
- Defaults already on provision path: `applyWorkspaceDefaults`, `ensureCrmChatAppInstalled(forceReinstall)`, `skipInstallAppsOnboarding` (owner + invite), shell-ux baked in Twenty image, `evaluateCrmAccess` platform-wide.
- Docs: ADR-017 chat/shell/portal defaults; CAPABILITIES crm-chat **0.1.23** + invite skip install-apps.
- Next: git commit product surface (exclude `.cursor/skills`).

### 2026-07-30 — CRM members: Bad Request + install-apps + delete→owner

- Goal: Save Robokassa settings; fix Edit/Delete Bad Request; skip `/install-apps` for invites; delete member removes CRM access and reassigns deals/tasks to owner.
- Cause (400): empty JSON body + `Content-Type: application/json` (INC-071).
- Cause (install-apps): skip only on workspace provision, not on `provisionWorkspaceMember`.
- Changes: Fastify empty JSON `{}`; `skipInstallAppsOnboarding` after member signUp; `removeTwentyMemberFromTenant` (ownerId/assigneeId → owner + `deleteUserFromWorkspace`); ADR-022; FLOWS Robokassa cabinet table.
- Deploy: `./scripts/prod-deploy.sh saas-api` → backup `/opt/voxly/backups/20260730-112615/`.
- Verify: API health **200**; container has empty-JSON parser + `twenty-member-remove` + `deleteUserFromWorkspace`; empty-body DELETE/POST → **401** (not 400).
- Answer: sidebar «john» = workspace name; profile Тест2 = logged-in user; deal «John Doe» = createdBy owner (bots).

### 2026-07-30 — Fix Robokassa error 29 (Receipt in signature)

- Goal: Checkout opened Robokassa with error 29; pending payments never completed.
- Cause: pay signature used `encodeURIComponent(Receipt)`; live shop expects **raw JSON** in the hash string (URLSearchParams still encodes the query param).
- Changes: `@voxly/billing` `generatePaymentUrl`; tests; `./scripts/prod-deploy.sh saas-api`.
- Backup: from deploy script under `/opt/voxly/backups/` (today).
- Verify: probe payment URL with Receipt+Shp → Robokassa pay UI (no code 29); `/health` **200**.
- Still: `IS_TEST=1` + test passwords; user should complete one test pay from CRM portal.
- Next: successful test Result → then live passwords + `IS_TEST=0`.

### 2026-07-30 — CRM pay UX: receipt lines + post-pay refresh

- Goal: Clear Robokassa line items (who/what); portal shows Active + extra seats after test pay.
- Findings: InvId **1010** (1100 ₽) **paid** OK; DB had Active + `extraSeats=2`; UI stuck on Trial due to Success redirect racing Result + weak `crmIsTrial`.
- Changes: multi-item Receipt + `crmHost` in description; extend `endsAt` from prior trial/paid end; `crmIsTrial` ignores stale tenant.trial; CRM page polls reload on `?paid=ok`; labels «Активная» + доп. места hint. Backfilled john `endsAt` → **2026-09-06**.
- Deploy: `saas-api,saas-portal`.
- Verify: john DB Active / 10+2 / ends 2026-09-06; next checkout shows distinct receipt lines.
- Next: user hard-refresh `/dashboard/crm`; retest seats-only pay (1011/1012 were pending/cancelled).

### 2026-07-30 — CRM invite: reissue credentials + Edit button

- Goal: Owner can re-open/copy invite credentials for existing members; fix failed invites via «Редактировать».
- Changes: `POST /api/tenant/members/:memberId/reissue-credentials` (new password, Voxly + Twenty sync); CRM page Edit button + reuse invite modal.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal` → backup `/opt/voxly/backups/20260730-093416/`.
- Verify: john tenant → Edit on invited member → modal with new password; login on john-crm.getvoxly.ru.
- Note: old password invalidated on reissue; delete stale member before re-invite if first invite failed.

### 2026-07-30 — Fix CRM invite: AppToken.value not id

- Goal: Invite flow failed with «User does not have access to this workspace» — wrong token passed to `signUpInWorkspace`.
- Root cause: `sendInvitations` GraphQL returns `AppToken.id` (UUID); Twenty validates `AppToken.value` (64-char hex).
- Changes: `fetchTwentyInvitationTokenValue` (SQL via `TWENTY_DATABASE_URL`); `provisionWorkspaceMember` uses resolver + public auth client for signUp; friendly error messages in `twenty-member-provision.ts`.
- Deploy: `./scripts/prod-deploy.sh saas-api` → backup `/opt/voxly/backups/20260730-092701/`.
- Verify: re-invite `test@voxly.ru` on john → modal shows «Аккаунт в CRM создан»; login on john-crm.getvoxly.ru works.
- Broken: SMTP still deferred.

### 2026-07-30 — CRM billing UI: period + seats + total

- Goal: CRM portal «Тариф и оплата» — выбор срока, доп. мест, итого, оплата пакетом или только места.
- Changes: `crm-pricing.ts` (formula matches backend); `crm/page.tsx` period selector, seat stepper, breakdown, dual CTAs; combined checkout uses existing `crm_base`+`extraSeats`.
- Deploy: `./scripts/prod-deploy.sh saas-portal` → backup `/opt/voxly/backups/20260730-094849/`.
- Verify: build OK; smoke 200 after warm-up.

### 2026-07-30 — CRM portal working (trial/seats/invite/Twenty)

- Goal: Full CRM portal: Trial badge, remaining seats, amber UI, invite→Twenty member + modal credentials, member nav guard, billing redirect.
- Changes:
  - API: `GET /api/tenant/crm`; `isTrial` fix; `crm-login` uses per-member `twentyPasswordEncrypted`; invite provisions Twenty via `sendInvitations`+`signUpInWorkspace`; Robokassa → `/dashboard/crm?paid=`.
  - DB: migration `20260730020000_tenant_member_twenty_password`.
  - Portal: amber `crm-portal-hero`, rewrite `/dashboard/crm`, invite modal, `lib/open-crm.ts`, member-only NAV + login→`/dashboard/crm`.
- Deploy: `saas-api` backup `/opt/voxly/backups/20260729-232007/`; migrate applied; `saas-portal` backup `/opt/voxly/backups/20260729-232207/`.
- Verify: `/`, `/login`, `/dashboard/crm`, API health **200** after warm-up.
- Broken: SMTP still deferred (credentials only in modal); root SSH password used via SSHPASS — **rotate**.
- Next: user smoke on john — Trial, remaining seats=9, invite → CRM direct login.

### 2026-07-30 — CRM portal page + sidebar nav

- Goal: Add «CRM портал» menu after Dashboard; settings + billing page in dashboard style.
- Changes: `app-shell.tsx` nav item; new `/dashboard/crm` (hero, stats, portal URL, CRM Base payment, team seats).
- Deploy: `./scripts/prod-deploy.sh saas-portal` → backup `/opt/voxly/backups/20260729-223804/`.
- Verify: build includes `/dashboard/crm`; smoke OK after container warm-up.
- Next: user validates live nav + checkout buttons.

### 2026-07-30 — Dashboard hero: Open CRM button + remove duplicate header

- Goal: Move «Открыть CRM» into blue hero banner; remove tenant title/subtitle block below banner.
- Changes: `hero-banner.tsx` accepts `actions`; `dashboard/page.tsx` passes CRM button to banner, drops `PageHeader` + separator.
- Deploy: `./scripts/prod-deploy.sh saas-portal` → backup `/opt/voxly/backups/20260729-223233/`.
- Verify: smoke **200** on `/` and API health; dashboard bundle rebuilt.
- Next: user validates live on `https://getvoxly.ru/dashboard`.

### 2026-07-30 — Prod saas-portal auth UI + landing refresh

- Goal: Ship restyled `/login` + `/register` (landing visual language) with current portal code; no Spline.
- Changes: `./scripts/prod-deploy.sh saas-portal` (whitelist rsync + rebuild). Volumes untouched.
- Backup: `/opt/voxly/backups/20260729-220728/` (`voxly_control.dump`, `twenty.dump`).
- Verify: `/`, `/login`, `/register` **200** HTML from portal; API `/health` **200**. Smoke briefly 404 while container started — recovered within ~20s.
- Broken: root SSH password still used via SSHPASS in chat — **rotate** and prefer SSH key.
- Next: commit uncommitted portal auth/CSS changes on branch if desired.

### 2026-07-30 — Prod saas-portal AIDA landing live

- Goal: Deploy selling landing to getvoxly.ru without volume wipe.
- Changes: `./scripts/prod-deploy.sh saas-portal` (whitelist rsync + rebuild). No password in docs.
- Backup: `/opt/voxly/backups/20260729-214558/` (`voxly_control.dump`, `twenty.dump`).
- Verify: `https://getvoxly.ru/` **200** (HTML has `landing-root`, `voxly-hero-v5`, amber `#f5a623`); `https://api.getvoxly.ru/health` **200** `ok`.
- Broken: root SSH password was shared in chat — **rotate immediately**.
- Next: optional hard-refresh CDN/browser caches for returning visitors.

### 2026-07-29 — AIDA landing + official Voxly mascot

- Goal: Replace the comparison-table-first homepage with a conversion-focused landing.
- Changes:
  - Rebuilt `/` as an AIDA narrative: pain → unified solution → benefits → four-step onboarding → price → FAQ → closing CTA.
  - Adopted a restrained industrial-tech direction using the official Voxly robot, amber/red/black/white palette, and Cyrillic Unbounded + Manrope typography.
  - Added mobile-specific composition and a sticky 48px CTA; retained legal details and accessible focus/reduced-motion behavior.
  - Updated metadata/Open Graph and the landing capability record.
- Verify: `pnpm build` in `apps/saas-portal` passed; local `GET http://localhost:3000/` returned **200**; IDE lints clean.
- Broken: Standalone `tsc --noEmit` initially hit stale missing `.next/types`; Next production build regenerated types and completed successfully.
- Next: Visual review at `http://localhost:3000/`; deploy only after approval.

### 2026-07-27 — ServiceApp UI Design System Tokens integration

- Goal: Update design system tokens to ServiceApp UI Design System Tokens (`serviceapp_design_system.json` & `serviceapp_design_system.md`).
- Changes:
  - Created `serviceapp_design_system.json` and `serviceapp_design_system.md` in root workspace and in `design-system/voxly/`.
  - Updated `design-system/voxly/MASTER.md` to set ServiceApp UI Design System as the primary source of truth.
  - Verified `apps/saas-portal` typecheck passes with 0 errors.
- Verify: `pnpm --filter @voxly/saas-portal typecheck` -> 0 errors. `serviceapp_design_system.json` and `serviceapp_design_system.md` written and validated.
- Next: None.

### 2026-07-27 — INC-070 CRM «Чат» tab disappeared (side panel)

- Goal: Restore Opportunity/Person **Чат** tab on john-crm (and other tenants if broken).
- Cause: `voxly-crm-chat` missing from Twenty after failed/partial `refresh-crm-chat` (ENOSPC during 0.1.22 ship left uninstall without reinstall). Shell-ux unread badges unrelated — kept working.
- Changes (prod only, no volume wipe):
  - Confirmed tarball `/voxly/assets/voxly-crm-chat.tgz` **0.1.22** in saas-api.
  - `POST …/refresh-crm-chat` `{}` → john / lexx / antontest / antontest3 `{ok:true}`.
  - Flushed Redis `flatPageLayout*`; bumped all `workspace.metadataVersion`.
  - Chat tab already `position=15` (set-chat-tab-position no-op).
- Verify: metadata `getPageLayouts` john Opportunity/Person includes **Чат** @15; widgets → Voxly Chat; `GET /rest/front-components/<id>` **200** (bundle); apps **0.1.22** on all 4 workspaces.
- Broken: rotate root SSH; harden refresh to not uninstall before successful upload when disk low.
- Next: user hard-refresh john-crm → open deal «Антон · WA · ремонт тоя» → **Чат** visible + loads messages.

### 2026-07-27 — INC-069 CRM Chat «нет данных» (deliveryStatus) + WA refusal/dup

- Goal: Restore CRM Chat history (WA/GramJS/Business); stop voice ASR refusals + duplicate AI replies.
- Cause: saas-api Prisma client expected `ChatMessage.deliveryStatus` (mailing receipts schema) but migration `20260727020000_mailing_broadcast_receipts` was **not** on prod → every `GET /api/crm/chat/:id` **500 P2022** → empty Chat tab. Secondary: LLM still refused after `[голос]: …`; double flush echoed video and skipped photo.
- Changes:
  - Prod: backup + applied receipts migration (`deliveryStatus`/`deliveredAt`/`readAt` + `BroadcastRecipient`).
  - ai-core: stronger MEDIA hint + refusal regex; `hasEnrichedMediaTag` / `isNearDuplicateReply` / `MEDIA_REFUSAL_RETRY_USER`.
  - WA/TG workers: refusal retry; WA flush focuses DB-fresh burst; skip near-duplicate assistant ≤90s.
- Deploy: migration on control PG; `./scripts/prod-deploy.sh ai-whatsapp-worker,ai-telegram-worker`; backups `/opt/voxly/backups/20260726-220746/` (migrate) + `/opt/voxly/backups/20260726-221209/` (workers).
- Verify: service-token GET john Person/Opp → **200** msgs 37/63/51 (WA personal/business/GramJS); workers have `media refusal retry`; portal+api **200**.
- Broken: rotate root SSH password.
- Next: user hard-refresh john-crm Chat; smoke voice/photo; confirm one AI reply.

### 2026-07-27 — INC-068 personal WA voice CRM sync before ASR

- Goal: Personal WA voice must create Person+Opportunity after wipe; don’t block CRM on ASR.
- Cause: CRM ids cleared on `+79150946944` with no post-clear inbound; sync ran after media enrich.
- Changes: WA inbound → save msg → `await syncLeadToCrm` → then ASR/vision/doc update; TG media sync before `extractInboundText`; sync ok/empty logs.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker,ai-telegram-worker`; backup `/opt/voxly/backups/20260726-214839/`; smoke portal+`/health` **200**.
- Verify: clear CRM ids on `+7915` → synthetic voice webhook → `syncLeadToCrm ok` **before** ASR fail → Person+Opportunity recreated; log order confirmed in dist.
- Broken: rotate root SSH password.
- Next: user sends real personal voice; confirm deal in john-crm.

### 2026-07-27 — Prod: mailing UX 0.1.22 + receipts migrate

- Goal: Ship composer/preview/filters/delete + stage multi-channel; fix refresh after missing bot front-component.
- Deploy: `prod-deploy.sh saas-api,gift-bot-worker` then saas-api again for **0.1.22**; backups `20260726-220429`, `20260726-221943`.
- Migrate: `MailingStageRule.channel/media*`; `BroadcastRecipient` + ChatMessage delivery columns.
- Disk: VPS hit ENOSPC on refresh; pruned unused docker images (no volumes) → ~71G free; refresh john/lexx/antontest/antontest3 → `{ok:true}`.
- Verify: tarball **0.1.22** with 5 frontComponents (Bot/Accounts/Stories/Stage/Chat); portal+api+john-crm **200**.
- Broken: rotate root SSH; live WA/GramJS read acks still partial; bot panel recovered via rename `mailing-bot-panel` (old `mailing-panel` dropped from twenty build).
- Next: hard-refresh john-crm → expand «Рассылка»; smoke composer/preview/delete.

### 2026-07-27 — Mailing UX 0.1.21: composer, filters, delete, receipts

- Goal: Lift in-CRM «Рассылка» to gift-broadcasts UX; audience filters; delete; multi-channel stage; receipts skeleton.
- Changes:
  - crm-chat **0.1.21**: shared `mailing-composer` / `mailing-preview` / `mailing-history`; wired bot/accounts/stories/stage; DELETE LF; accounts filters CRM stage + gift started/phase + read; stage sender gift|gramjs|wa + preview.
  - API already had channel audience resolve + DELETE + stage channel; added `readStatus` audience via `ChatMessage.deliveryStatus`.
  - Schema: `BroadcastRecipient` + ChatMessage delivery fields; migration `20260727020000_mailing_broadcast_receipts`; gift-bot-worker writes recipients on channel send.
- Verify: `yarn typecheck` in voxly-crm-chat OK; prisma generate OK. **Not deployed.**
- Broken / gaps: WA/GramJS live ack→delivered/read not fully wired (Evolution messages.update); gift-bot never gets true read; media upload file_id in CRM still URL-oriented.
- Next: migrate receipts on control DB; deploy saas-api + gift-bot-worker + refresh-crm-chat; hard-refresh john; then WA ack handler.

### 2026-07-27 — Prod: Robokassa test keys live (crmgetvoxly)

- Goal: Wire shop `crmgetvoxly` test passwords + SHA256; Result/Success/Fail URLs already set in ЛК.
- Changes: prod `.env` test Password#1/#2 + `HASH_ALG=sha256` + `IS_TEST=1`; deploy saas-api (compose name conflict cleaned; `--no-cache` rebuild). Code: `Shp_*`, Result GET/POST, `/fail`.
- Verify: container `LOGIN=crmgetvoxly IS_TEST=1 HASH=sha256 P1/P2=20`; `/health` **200**; Result POST without sig **400**; Fail **302**.
- Broken: none for wiring. **Do not commit secrets**; passwords appeared in chat — rotate after go-live if needed.
- Next: user runs one **test** checkout from portal (IsTest=1); then switch env to live passwords + `IS_TEST=0`.

### 2026-07-27 — Robokassa docs alignment (Shp_ + MD5)

- Goal: Match official Robokassa docs vs cabinet screenshots.
- Changes: `Shp_*` prefix (not `shp_`) in pay URL + signature; Result parse case-insensitive; prod `ROBOKASSA_HASH_ALG=md5` (cabinet MD5); `.env.example` notes test passwords + IPs.
- Still blocked: Password#1/#2 empty on prod; cabinet Result/Success/Fail still on getvoxly.ru until user updates.
- Verify: `@voxly/billing` tests pass.
- Next: user pastes **test** Password#1/#2 → env + deploy saas-api → test pay with IsTest=1.

### 2026-07-27 — Robokassa wiring (shop crmgetvoxly)

- Goal: Align code + prod with Robokassa merchant `crmgetvoxly` (MD5/GET URLs were wrong vs code).
- Changes: `ROBOKASSA_HASH_ALG` (md5|sha256); Result GET+POST + urlencoded parser; `/fail` redirect; compose env; LOGIN=`crmgetvoxly` + HASH=`sha256` + IS_TEST=1 on prod `.env` (**PASSWORD1/2 still empty**).
- Cabinet must set: Result `https://api.getvoxly.ru/api/billing/result` POST; Success/Fail api billing URLs; hash **SHA256** (or set env md5); test hash also SHA256.
- Verify: billing tests 14; saas-api typecheck OK. **Await passwords** then recreate saas-api + test payment.
- Broken: live checkout blocked until Password#1/#2 in prod `.env`.
- Next: user pastes passwords → write env → deploy saas-api → smoke test pay.

### 2026-07-26 — Prod: landing «Документы» links in contacts/footer

- Goal: Full legal links in contacts + footer (terms/privacy/consent/refund).
- Changes: `LEGAL_LINKS` full titles; contacts column «Документы»; `./scripts/prod-deploy.sh saas-portal`.
- Backup: `/opt/voxly/backups/20260726-215213/`.
- Verify: after startup race → portal/api **200**; HTML has «Документы» + 4 hrefs.
- Broken: smoke script 502/404 during recreate (same race as before).
- Next: none for this ship.

### 2026-07-27 — Prod: «Рассылка» FOLDER + stage rules live

- Goal: Finish mailing in-CRM ship — migrate `MailingStageRule`, refresh nav so john expands «Рассылка».
- Changes: Applied `20260726230000_mailing_stage_rule` on control Postgres (`MailingStageRule` created, 0 rows). `refresh-crm-chat` john/lexx/antontest/antontest3 → `{ok:true}`. Nav verified on john: FOLDER «Рассылка» + PAGE_LAYOUT children Бот / Аккаунты / Сторис / По этапу сделки. Prod tarball = crm-chat **0.1.20** (includes mailing folder + INC-067 signed docs).
- Backup: prior deploy `/opt/voxly/backups/20260726-210924/` (saas-api/gift-bot from earlier this session).
- Verify: john Twenty `core.navigationMenuItem` 5 rows as above; `https://john-crm.getvoxly.ru/` **200**.
- Broken: rotate root SSH password (still in chat history). Stage fire needs Opportunity ↔ `GiftSubscriber.twentyOpportunityId`. Stories media still URL-only in CRM.
- Next: user hard-refresh john-crm → expand «Рассылка»; E2E schedule/send + stage rule.

### 2026-07-27 — INC-067 WA video refuse / PDF download / typing / personal deal

- Goal: After wipe retest — Business WA video+кружочек AI uses ASR; PDF/DOCX downloadable in CRM; typing clears; personal WA creates deal. Don’t break photo/audio/text/TG.
- Cause: ASR already in ChatMessage; LLM few-shot refusals; docs via base64 hit Twenty 96KB cap; composing never cleared; personal conv linked soft-deleted opp + missing person.
- Changes: `filterMediaCapabilityRefusals` + stronger MEDIA hint (ai-core); WA/TG workers; signed URL for documents (crm-chat **0.1.20**); `clearWhatsAppTyping`; no TG typing on GET; await syncLeadToCrm; cleared `79150946944` stale CRM ids.
- Deploy: `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker,ai-telegram-worker`; backup `/opt/voxly/backups/20260726-210924/`; refresh-crm-chat john/lexx/antontest/antontest3 `{ok:true}`; smoke portal+`/health` **200** (first smoke 404 race during recreate).
- Verify: user smoke — video/кружочек → answer from transcript; PDF/DOCX download; typing clears; +7915 → new deal. Hard-refresh john-crm.
- Broken: rotate root SSH password (still exposed in chat).
- Next: user E2E smoke; rotate SSH.

### 2026-07-26 — Prod: billing seats + mailing pay + 7d docs

- Goal: Ship billing fixes (extraSeats webhook, InvId lock, mailing 402→Robokassa) + portal.
- Changes: `./scripts/prod-deploy.sh saas-api,saas-portal` (portal OK); saas-api initially **stale Docker cache** → forced `build --no-cache saas-api` + recreate.
- Backup: `/opt/voxly/backups/20260726-214204/` (`voxly_control.dump`, `twenty.dump`).
- Verify: `https://getvoxly.ru/` **200**; `https://api.getvoxly.ru/health` **200**; container `billing.js` has `extraSeatsPaid` + `pg_advisory_xact_lock`.
- Broken: first smoke hit portal **404** (startup race); script exited 1 before api no-cache rebuild.
- Next: optional refresh-crm-chat for in-CRM `?pay=1` deep-link; harden deploy script to `--no-cache` when host sources newer than image.

### 2026-07-26 — INC-066 WA off-topic + silent / no deal

- Goal: Fix WA Business off-topic AI vs TG; regular/LID WA no reply / missing Opportunity.
- Cause: (1) history filter kept pre-prompt user lines → pollution; (2) `resolveDefaultOpportunityStage` `nameSingular` filter 400 → `NEW` stage abort; (3) closed LID twin + fake `+20034505`.
- Changes: twenty-client stage query without ObjectFilter; history cut all roles; MEDIA hint; WA reopen closed threads; prisma `///` comment fix (blocked generate); INC-066.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker,ai-telegram-worker`; backups `20260726-204245`, `20260726-204345`, `20260726-204441`.
- Verify: smoke portal/api **200**; workers Up; no `nameSingular` in new logs; STAGE resolve → workspace value (not NEW).
- Broken: only one Evolution instance on prod (`ремонт тоя`); assign real sales agent when leaving test prompt «Тестовый, прикольный».
- Next: user smoke personal + business-profile peers; **rotate root SSH password**.

### 2026-07-26 — «Рассылка» FOLDER + 4 in-CRM pages (0.1.18)

- Goal: Expandable sidebar (Бот / Аккаунты / Сторис / По этапу сделки); calendar schedule + edit/dup; stage trigger.
- Changes: crm-chat **0.1.18** FOLDER+PAGE_LAYOUT children; panels; PATCH broadcast proxy; `MailingStageRule` + fire API; worker `subscriberIds`; Twenty `opportunity.updated` LF; ADR-018.
- Verify: `yarn typecheck` OK in voxly-crm-chat. **No prod deploy.**
- Broken / gaps: FOLDER+PAGE_LAYOUT needs live verify after refresh (FOLDER+LINK was broken; PAGE_LAYOUT should navigate in-app). Stage fire needs linked `GiftSubscriber.twentyOpportunityId`. Stories media = URL only (no upload in CRM). Custom tenant stages beyond john defaults may need UI refresh from live metadata later.
- Next: migrate control DB `20260726230000_mailing_stage_rule`; deploy saas-api + gift-bot-worker + refresh-crm-chat when user asks; hard-refresh john-crm → expand «Рассылка».

### 2026-07-26 — Prod: in-CRM «Рассылка» (crm-chat 0.1.17)

- Goal: Ship PAGE_LAYOUT mailing panel to john-crm (not portal LINKs).
- Changes: `./scripts/prod-deploy.sh saas-api` (bakes tarball 0.1.17); refresh-crm-chat john/lexx/antontest/antontest3.
- Backup: `/opt/voxly/backups/20260726-202005/` (`voxly_control.dump`, `twenty.dump`).
- Verify: tarball nav `Рассылка` type=`PAGE_LAYOUT`; john Twenty DB same + `pageLayoutId` set, no `getvoxly.ru/mailing` LINKs; smoke portal/api **200**.
- Broken: none for this ship. Hard-refresh CRM required.
- Next: user opens john-crm → «Рассылка» stays in CRM; optional GramJS/WA/Stories tabs later.

### 2026-07-26 — «Рассылка» in-CRM like Chat (ADR-018 amend)

- Goal: Stop portal LINK sidebar UX; ship mailing as Twenty STANDALONE_PAGE + front-component (same pattern as voxly-crm-chat).
- Changes:
  - crm-chat **0.1.17**: `mailing-panel` front-component; `mailing.page-layout` STANDALONE_PAGE; nav `PAGE_LAYOUT` «Рассылка»; logic `/s/mailing/context|start-trial|bots/:id/broadcasts`.
  - Removed portal LINK nav items (bot/gramjs/whatsapp/stories).
  - Reuses Broadcast API + service-token auth; bot compose + trial + history (text/schedule; media later).
  - ADR-018 amended; CAPABILITIES / steps.
- Verify: `yarn typecheck` in `twenty-app/voxly-crm-chat` OK. Apply via refresh-crm-chat / `yarn twenty` sync — **no prod deploy** this session.
- Broken: GramJS/WA/Stories not in CRM panel yet; media upload not in panel; edit scheduled only on portal.
- Next: local/prod `refresh-crm-chat` for john when user asks; optional multi-tab hub.

### 2026-07-26 — Portal indigo shadcn theme live (prod)

- Goal: Ship shadcn indigo theme + dashboard big-bang to prod; open PR.
- Changes: branch `ui/indigo-shadcn-dashboard` commit `08699d2` (ADR-020); portal primitives + all dashboard/auth/legal.
- Deploy: `./scripts/prod-deploy.sh saas-portal`; backup `/opt/voxly/backups/20260726-200859/`; first smoke 404/502 (cold start), then **200** portal + api; CSS confirms `--primary: 226.5 70.7% 40.2%`.
- Verify: `https://getvoxly.ru/` 200 indigo CTAs; `/login` 200; `api.getvoxly.ru/health` 200.
- Broken: `gh` not authenticated — PR create link: https://github.com/toxasag/voxly/pull/new/ui/indigo-shadcn-dashboard (branch already pushed).
- Next: user opens PR (`gh auth login` once); rotate root SSH if still pending.

### 2026-07-26 — Media parity: WA/GramJS/Gift = Business (+ platform default)

- Goal: Same media/document understanding on WhatsApp, GramJS, gift-bot as TG Business; default for all new portals (no per-tenant flag).
- Changes:
  - Confirmed Business/GramJS/WA already share `@voxly/ai-core` video ASR (ffmpeg) + PDF/DOCX + `MEDIA_INBOUND_HINT`.
  - **Gift:** `enrichGiftInboundMedia` (voice/кружочек/video ASR, vision, PDF/DOCX); fix missing `video_note` inbound; Dockerfile `ffmpeg`; compose `OPENROUTER_*` / `AI_*`; soft AI wallet charge.
  - ADR-021; CAPABILITIES / CHAT / FLOWS / DATA / INC-063 / steps.
- Deploy: `./scripts/prod-deploy.sh ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge,gift-bot-worker,saas-api,compose`
  - Backup `/opt/voxly/backups/20260726-200949/`
  - Smoke portal + api health **200**; gift-bot has ffmpeg + OPENROUTER; containers Up
  - `refresh-crm-chat` john/lexx/antontest/antontest3 → `{ok:true, versionHint:"0.1.10+"}`
- Verify: parity matrix in CHAT.md; smoke portal/api; gift CRM shows `[кружочек]:` / `[документ PDF]:` on inbound.
- Broken: GramJS outbound media still N/A; gift has no sales LLM (by design); legacy `.doc` unsupported.
- Next: user smoke gift + WA + GramJS media; **rotate root SSH password**.

### 2026-07-26 — INC-063: video ASR LLM ignore + PDF/DOCX extract

- Goal: Fix user smoke — regular video «not recognized» + PDF/DOCX unread by AI on TG Business (also GramJS/WA).
- Root cause: ASR often already stored `[видео]: …` but LLM few-shot from bare `[видео]` replied «Это видео.»; PDF/DOCX were filename placeholders only. Caps 8MB/90s + raw-mp4 Whisper fragile for real clips.
- Changes:
  - `@voxly/ai-core`: `extractAudioFromVideo` (ffmpeg), `extractDocumentText` (pdf-parse/mammoth), `MEDIA_INBOUND_HINT`, caps helpers.
  - `ai-telegram-worker` / `ai-whatsapp-worker`: video caps **20MB / 180s**, ffmpeg→Whisper, PDF/DOCX extract → `[документ PDF|DOCX]:`; Dockerfiles install `ffmpeg`.
  - `gramjs-bridge`: download `document` + video up to 20MB for AI path.
- Deploy: backup `/opt/voxly/backups/20260726-195511/`; rsync via `prod-deploy.sh`; compose rebuild completed manually after SSH auth flake on heredoc step (`ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge` up).
- Verify: short spoken video → ChatMessage `[видео]: …` and AI answers content; PDF/DOCX → `[документ …]:` with text; oversize/fail → RU fallback.
- Broken: legacy `.doc` (not docx) still unsupported; >20MB / >180s video still skip.
- Next: user smoke TG Business; **rotate root SSH password**.

### 2026-07-26 — Portal indigo shadcn theme (big-bang dashboard)

- Goal: Switch portal from Twenty-light ink to **shadcn indigo demo** theme; restyle all dashboard surfaces in one branch.
- Changes:
  - `globals.css`: classic indigo primary + sidebar tokens; legacy ink/canvas aliases → semantic.
  - Primitives: Button/Badge/Card/Input/Textarea/Switch → demo-like radius/primary.
  - `AppShell` sidebar indigo accent; all `dashboard/*` + admin + auth/legal class tokens migrated; `selectClassName` on native selects.
  - ADR-020.
- Branch: `ui/indigo-shadcn-dashboard`. Verify: portal typecheck OK.
- Broken: none expected; dark `.dark` vars present but no theme toggle yet.
- Next: create PR / deploy `saas-portal` when approved; optional next-themes toggle.

### 2026-07-26 — Portal shadcn rollout (landing + shell)

- Goal: Expand shadcn/ui on saas-portal without breaking Twenty-light tokens / `globals.css`.
- Changes:
  - Added: separator, accordion, tabs, table, navigation-menu, sheet, dropdown-menu, avatar, tooltip, alert, checkbox, scroll-area under `components/ui/`.
  - Landing `/` on Table/Accordion/Alert/Card/Badge/Button; legal shell Separator+Card; register Checkbox; root `TooltipProvider`.
  - `AppShell`: mobile nav → Sheet + ScrollArea (desktop aside unchanged).
  - Dashboard: Separator under header.
- Verify: `pnpm --filter @voxly/saas-portal typecheck` + `build` OK.
- Broken: none expected; portal Alert (`components/portal/alert.tsx`) ≠ shadcn `ui/alert`.
- Next: deploy `saas-portal` when ready; further dashboard form selects → shadcn Select optional.


- Goal: AI understands inbound **regular video** (TG Bot / GramJS / WA) like video_note — ASR transcript tagged `[видео]: …`, clear fail fallback.
- Changes:
  - `ai-telegram-worker`: `asrTelegramVideo` for `message.video` + document `video/*`; GramJS inbound distinguishes video vs video_note tags; caps **8MB / 90s**; 45s ASR abort reused.
  - `gramjs-bridge`: download `type=video` (not only videoNote) for AI; doc-video mime → video; download-fail → RU fallback text.
  - `ai-whatsapp-worker`: `videoMessage` + doc-video `needsAsr: true`; enrich tags `[видео]:` / fail fallback; WA ASR 45s abort.
- Deploy: `./scripts/prod-deploy.sh ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`; backup `/opt/voxly/backups/20260726-193733/`; smoke portal/api **200**.
- Verify: send short video with speech → ChatMessage `[видео]: …` → AI references content; silent/oversized → «не удалось разобрать».
- Broken: none expected; animation/GIF still placeholder-only.
- Next: user smoke TG Business + GramJS + WA; **rotate root SSH password**.

### 2026-07-26 — Redeploy mailing for john training workspace

- Goal: User trains on `john-crm.getvoxly.ru` — ensure portal + CRM sidebar LINKs live.
- Changes: rsync `saas-api` / `saas-portal` / `voxly-crm-chat` + compose rebuild; backup window earlier `20260726-195313`; `refresh-crm-chat` **john** `{ok:true}`; tarball **0.1.16**; john nav = top-level LINK → `getvoxly.ru/dashboard/mailing*`.
- Verify: portal `/` + `/dashboard/mailing` + `/mailing/bot` **200**; api health **200**.
- Next: hard-refresh john-crm → click «Рассылка» opens portal tab.

### 2026-07-26 — Fix mailing CRM 404 (Twenty FolderSubItem navigate)

- Goal: Sidebar «Рассылка» opened Twenty NotFound («страница удалена…») instead of portal.
- Root cause: Twenty 2.22 `NavigationMenuItemFolderSubItem` calls `navigate(https://…)` for nested LINK; React Router → CRM 404. Top-level LINK uses `window.open`.
- Changes: crm-chat **0.1.16** — hub + 4 mailing items as **top-level LINK** (no FOLDER nest); ADR-018 note; `prod-deploy.sh saas-api`; refresh-crm-chat john/lexx/antontest/antontest3; DB confirms `folderId` null + absolute URLs.
- Verify: hard-refresh john-crm → click «Рассылка» / bot → new tab `getvoxly.ru/dashboard/mailing…`.
- Next: user smoke; rotate root SSH if still pending.

### 2026-07-26 — Mailing prod ship + CRM LINK absolute URLs

- Goal: Ship «Рассылка» to prod; fix CRM sidebar opening `john-crm/…/mailing/*` (relative LINK → same-host SPA).
- Changes:
  - `voxlyCabinetUrl()` guard: LINKs must be absolute `https://getvoxly.ru/dashboard/mailing/*` (Twenty prepends `https://` to `/dashboard/…` → current CRM host).
  - `./scripts/prod-deploy.sh saas-api,saas-portal,gift-bot-worker,gramjs-bridge,ai-telegram-worker,ai-whatsapp-worker,compose`
  - Backup `/opt/voxly/backups/20260726-192410/` (shared window with INC-063 rebuild); initial smoke portal **502** then **200**.
  - Tarball in image **0.1.15** with absolute mailing URLs; `refresh-crm-chat` john/lexx/antontest/antontest3 → `{ok:true}`.
  - Attribution columns already on control DB (`lastMailingAt` / `lastMailingBroadcastId`).
- Verify: `getvoxly.ru/dashboard/mailing{,/bot,/gramjs,/whatsapp,/stories}` → **200**; api `/health` **200**.
- Broken: none for this ship. Hard-refresh CRM after sidebar click should open portal in new tab.
- Next: user smoke john sidebar «Рассылка» → portal; trial + schedule one bot broadcast.

### 2026-07-26 — INC-063 reopen: media token 404 + video_note AI

- Goal: Fix CRM кружочек download-only + AI stuck after «Секунду…» (TG Business ~22:16).
- Changes:
  - Root cause: Fastify `maxParamLength` default 100 → `GET /api/crm/chat/media/<long-token>` **404**; signed-url JSON OK → `<video onError>` → «Кружочек · скачать».
  - `saas-api`: `maxParamLength: 8192`; media route `/media/*`; crm-chat **0.1.15** (src on `<video>`, video_note mis-tag harden).
  - `ai-telegram-worker`: always `[кружочек]:` / ASR-fail fallback text; typing instead of «Секунду…»; ASR 45s abort; force mp4 for video_note.
  - `ai-whatsapp-worker` + `gramjs-bridge`: same ASR tagging / videoNote-before-audio.
  - Deploy: `./scripts/prod-deploy.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`; backup `/opt/voxly/backups/20260726-192410/`; refresh-crm-chat john/lexx/antontest/antontest3 → app **0.1.15**.
- Verify: media Range → **206** `video/mp4` + `ftypisom`; smoke portal/api **200**; Twenty `application.version=0.1.15`.
- Broken: none. **Rotate root SSH password** (used in session).
- Next: user hard-refresh CRM → send new кружочек → circular player + AI reply with `[кружочек]: …` context.

### 2026-07-26 — Prod deploy: media 0.1.13 + unread shell-ux + workers ASR

- Goal: Ship pending local fixes — CRM media players (signed URLs / mime+Range / crm-chat **0.1.13**), unread badge UX (twenty-shell-ux + mark-all-threads), WA/TG/GramJS video_note ASR workers.
- Changes:
  - `./scripts/prod-diff.sh saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` — pre-deploy drift on worker/bridge `index.ts` only (API/Twenty hot files already matched)
  - `./scripts/prod-deploy.sh saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` — first attempt: backup + build OK, then Docker recreate error `No such container: …_docker-saas-api-1` (saas-api / TG / WA left `Created`)
  - Retry: `./scripts/prod-deploy.sh --skip-backup saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` → containers Up; script smoke **200**
  - Backup (from first attempt): `/opt/voxly/backups/20260726-190111/` (`voxly_control.dump`, `twenty.dump`)
  - Control DB: `Conversation.lastOperatorReadAt` already present (`20260726210000`); applied pending `20260726220000_mailing_attribution` (nullable mailing columns only; mailing UI still not product-shipped)
  - `POST /api/admin/tenants/:id/refresh-crm-chat` → antontest, antontest3, john, lexx all `{ok:true, versionHint:"0.1.10+"}`; saas-api tarball **0.1.13**
- Verify:
  - Smoke: portal + API health + app healthz **200**; gramjs `/health` → `ok`; media bad token **401**
  - `prod-diff` post-deploy: **All compared paths match**
  - Containers Up: saas-api, twenty-server, twenty-worker, ai-telegram-worker, ai-whatsapp-worker, gramjs-bridge
- Broken / blockers: none after retry. First compose recreate hit transient Docker name conflict; recovered with `--skip-backup` (backup already taken).
- Next: user hard-refresh CRM — verify media players + single unread badge clears on open Chat.

### 2026-07-26 — Deploy twenty unread badge UX
- Goal: Ship one-badge-per-card + optimistic clear (INC-065 shell-ux) after media 0.1.13.
- Changes: `./scripts/prod-deploy.sh twenty`. Backup `/opt/voxly/backups/20260726-190116/`. `lastOperatorReadAt` already on control DB; saas-api mark-all-read from prior media deploy.
- Verify: hard-refresh CRM → one badge on deal/person card; open «Чат» → clears. `app.getvoxly.ru/healthz` → 200 after boot.
- Broken: smoke briefly 502 while Twenty finished Nest boot/upgrade (normal).
- Next: user verify badges + media; **сменить root SSH пароль** (светился в чате).

### 2026-07-26 — Mailing Phase 4–6 (stories + attribution + billing + trial 7d)
- Goal: stories schedule/send, effectiveness attribution, add-ons 500/500/1000, global trial 14→7, one-shot mailing trials.
- Changes:
  - ADR-019: GramJS `POST /stories/send`; WA/Business story jobs → `failed` + `stories_unsupported_*`.
  - Attribution: `lastMailingBroadcastId|At` on GiftSubscriber/Conversation; inbound CRM note + `mailing_reply` (48h).
  - SKUs `mailing_bot` / `mailing_accounts` / `mailing_stories`; checkout+webhook; `/api/bots/mailing/billing|start-trial`; soft-gate 402.
  - `TRIAL_PERIOD_DAYS=7`; migration `20260726220000_mailing_attribution`.
- Verify: shared tests ✓; tsc api/workers/bridge ✓. Local: migrate + rebuild gift/gramjs/ai workers + portal.
- Broken: WA/ai_tg story send unsupported by design.
- Next: **prod not deployed** until explicit command.

### 2026-07-26 — Prod deploy saas-api (Robokassa signature fix)
- Goal: выложить billing подписи по pay-interface.
- Changes: `./scripts/prod-deploy.sh saas-api`; backup `20260726-193452`. Smoke `/health` сначала 404 (cold start), затем **200**.
- Verify: `saas-api` Up; `https://api.getvoxly.ru/health` → `{"status":"ok"}`.
- Next: в ЛК Robokassa URL + SHA256 + боевые ключи в prod `.env` (`ROBOKASSA_IS_TEST=0`).

### 2026-07-26 — Robokassa signatures align with pay-interface docs
- Goal: подпись платежа/Result/Success и Receipt по docs.robokassa.ru.
- Changes (`packages/billing`):
  - Payment sig: `Receipt` в подписи через `encodeURIComponent`; `payment_method=full_payment`.
  - ResultURL: `OutSum:InvId:Password#2:shp_*` без MerchantLogin; raw OutSum (6 знаков в бою).
  - SuccessURL: без MerchantLogin; Description ≤100.
  - `apps/saas-api` checkout → `full_payment`.
- Verify: `pnpm --filter @voxly/billing test` 13✓; billing+saas-api typecheck ✓.
- Next: deploy `saas-api` before live Robokassa; в ЛК алгоритм SHA256.

### 2026-07-26 — Prod deploy landing (trial ×3 cheaper)
- Goal: выложить рыночный лендинг на getvoxly.ru.
- Changes: `./scripts/prod-deploy.sh saas-portal`; backup `20260726-192309`. После conflict recreate `saas-api` — rm orphans + `up -d --no-build saas-api saas-portal`.
- Verify: `/` 200, copy «7 дней бесплатно» / «в 3 раза» / Salebot; `/terms` `/register` 200; api health 200.
- Next: заявка Robokassa; сменить root SSH пароль если ещё не сменён.

### 2026-07-26 — Landing: market vs trial positioning
- Goal: лендинг вокруг оффера «7 дней бесплатно → потом ~в 3 раза дешевле рынка».
- Changes: `page.tsx` — hero, баннер рынок/Voxly/×3, таблица сравнения (Salebot/BotHelp/7sales/Botseller/Wazzup/amo), пример сборки 8–15k vs 1.5–2k, CTA trial; `layout.tsx` metadata; `design-system/voxly/pages/landing.md`.
- Research anchors: Salebot ~2999, BotHelp ~1599, 7sales ~3990, Botseller Start ~4900, Wazzup/Pact/Chat2Desk WA connectors, amo seats.
- Verify: CTA copy = trial; compare table + legal block intact.
- Next: deploy `saas-portal` по запросу.

### 2026-07-26 — Landing rewrite (conversion)
- Goal: продающая главная getvoxly.ru — желание сразу зарегистрироваться.
- Changes: `apps/saas-portal/src/app/page.tsx` — hero с benefit H1 + превью чата в сделке; pain / pillars / 3 шага; тарифы CRM Base + список модулей; финальный CTA; реквизиты сохранены. Metadata в `layout.tsx`. Rules: `design-system/voxly/pages/landing.md`.
- Verify: локально `/` — CTA → `/register`; якоря `#product|#how|#pricing`; юр. блок на месте.
- Broken: none.
- Next: deploy `saas-portal` по запросу.

### 2026-07-26 — Prod deploy saas-portal (Robokassa legal pages)
- Goal: выложить публичные юр. страницы + реквизиты на getvoxly.ru для заявки Robokassa.
- Changes: `./scripts/prod-deploy.sh saas-portal` (rsync + build). Backup `/opt/voxly/backups/20260726-190018/`. После конфликта имени `saas-api` при recreate — `docker rm` orphan Created + `up -d --no-build saas-api saas-portal` (+ restart AI workers stuck in Created).
- Verify: `https://getvoxly.ru/` `/terms` `/privacy` `/consent` `/refund` → 200; на главной ИНН `505030516451` + ссылки Оферта/Конфиденциальность; `api.getvoxly.ru/health` → 200.
- Broken: none after recovery. Compose briefly tried rebuild saas-api as dependency during portal deploy.
- Next: подать заявку на активацию магазина Robokassa; **сменить root SSH пароль** (был передан в чате).

### 2026-07-26 — Robokassa store legal surface (public pages)
- Goal: публичный ресурс getvoxly.ru соответствует требованиям активации магазина Robokassa (контакты, цены, реквизиты, оферта, возврат, ПДн).
- Changes:
  - `apps/saas-portal/src/lib/legal.ts` — единые реквизиты ИП Сагайдак А.Г.
  - Публичные страницы `/terms` (оферта из docx), `/privacy`, `/consent`, `/refund`.
  - Лендинг: блок контактов/реквизитов, футер-ссылки, тариф «Доп. пользователь» 300 ₽.
  - `/register`: обязательный checkbox акцепта оферты + согласия на ПДн.
- Verify: без авторизации открываются `/terms|/privacy|/consent|/refund`; на `/` видны ИНН/телефон/email и тарифы; регистрация без галочки блокируется.
- Broken: none expected. Тексты адаптированы с оферты Voxly + структуры wpblocks — не замена юр. консультации.
- Next: deploy `saas-portal` → подать заявку на активацию магазина Robokassa; после одобрения — боевые ключи в prod `.env`.

### 2026-07-26 — INC-063 reopen: black video / `[кружочек]` text (mime + ASR)
- Goal: CRM video plays; кружочек shows player (not text alone); voice/audio play; AI ASR on video_note where feasible.
- Changes:
  - `saas-api` crm-chat: `sniffMediaContentType` + stored mime hint; Range/206; signed-url returns `contentType`.
  - `voxly-crm-chat` **0.1.13**: `<source type>`, circular video_note, download on error; file-url logic.
  - `ai-telegram-worker` / `gramjs-bridge` / `ai-whatsapp-worker`: video_note/ptv ASR; gift-bot placeholder `[кружочек]`.
- Verify: send **new** video + кружочек + voice on TG Business / GramJS / WA → player plays or download works; AI transcript for circle when ASR ok; hard-refresh CRM after refresh-crm-chat.
- Broken: full video vision still N/A (ASR/placeholder only); old stub-only `[кружочек]` messages stay text until resend.
- Deploy status (2026-07-26): **shipped** — `./scripts/prod-deploy.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`; backup `/opt/voxly/backups/20260726-185249/`; refresh-crm-chat john/lexx/antontest/antontest3 `{ok:true}`; smoke portal/api/app **200**; media invalid token **401**.

### 2026-07-26 — INC-065 unread badges UX (dedupe + mark-all-threads)
- Goal: one unread badge per deal/contact card; clear after opening «Чат».
- Changes:
  - `docker/twenty-shell-ux.js`: paint once on board card root (prefer name field); skip nested object links inside board cards; optimistic clear while Chat canvas open.
  - `apps/saas-api/.../crm-chat.ts`: on Chat GET, `lastOperatorReadAt` for **all** linked conversationIds (not only active thread); await update.
- Verify: kanban card shows single top badge; open Chat → badge gone within ~8s poll; multi-channel deal clears fully.
- Broken: none expected.
- Next: deploy `twenty` + `saas-api`; hard-refresh CRM.
- Deploy status (2026-07-26): **blocked** — `SSHPASS` unset; `./scripts/prod-diff.sh twenty,saas-api` → SSH `Permission denied (publickey,password)` to `root@150.241.98.135`. Code ready locally; re-run with `export SSHPASS=…` then `./scripts/prod-deploy.sh twenty,saas-api`.

### 2026-07-26 — Mailing («Рассылка») Phase 1–2
- Goal: Twenty sidebar «Рассылка» + 4 sub-items; reuse gift bot mailing with funnelPhase / edit scheduled / preview / media.
- Changes:
  - ADR-018: CRM UI = FOLDER+LINK → portal (not front-component).
  - `voxly-crm-chat` **0.1.12**: `mailing-folder` + bot/gramjs/whatsapp/stories LINK nav (`folderUniversalIdentifier`).
  - Portal: `/dashboard/mailing/bot` (reuse broadcasts UI), stubs gramjs/whatsapp/stories; AppShell nav «Рассылка».
  - API: `funnelPhase` on POST; persist `telegramFileId`/`mediaType`; `PATCH …/broadcasts/:id` for `scheduled`.
  - gift-bot-worker: audience `funnelPhase`; send via `resolveTelegramMedia` + photo/video (no rewrite of queue/scanner).
- Verify: create scheduled broadcast with funnelPhase + file_id → edit before due → scanner sends; CRM sidebar after refresh-crm-chat 0.1.12.
- Broken: none expected for gift funnel/chat. GramJS/WA/stories mailing = stubs. Billing/attribution/trial-7d not in this phase.
- Next: Phase 3 channel parity; Phase 5 attribution; Phase 6 SKUs + trial 7d (await decision: paywall vs one-shot trial). **Prod not deployed** this session.
- Note: CRM media signed-url (0.1.11) + unread badges already shipped earlier same day (`/opt/voxly/backups/20260726-182032/`); mailing changes are local-only until explicit deploy.

### 2026-07-26 — Unread chat badges on deals + contacts
- Goal: show unread inbound message count badges on Opportunity (kanban/list) and Person records in Twenty CRM.
- Changes:
  - `Conversation.lastOperatorReadAt` + migration `20260726210000` (backfill existing = `updatedAt`).
  - `GET /api/crm/chat/unread-badges`; mark-read on Chat `GET /:recordId`.
  - Logic `get-unread-badges`; CRM chat app **0.1.10**; shell-ux overlay badges (poll ~8s).
- Verify: inbound while board open → red count on card; open «Чат» → count clears on next poll; Person list same.
- Broken: none expected; badges need shell-ux + api + (for `/s/` proxy) refreshed Twenty app.
- Next: deploy `saas-api` + `twenty` + `prisma migrate deploy`; refresh CRM chat on workspaces still <0.1.10.
- Deploy status (2026-07-26): **shipped** — see entry «Prod deploy: media 0.1.11 + unread badges»; backup `/opt/voxly/backups/20260726-182032/`.

### 2026-07-26 — Prod deploy: media 0.1.11 + unread badges

- Goal: Ship CRM chat media players (signed URLs) + unread chat badges (shell-ux + lastOperatorReadAt) after prior SSH Permission denied blockers.
- Changes:
  - `./scripts/prod-diff.sh saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` (drift on crm-chat, chat-panel, WA worker, gramjs-bridge)
  - `./scripts/prod-deploy.sh saas-api,twenty,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`
  - Backup: `/opt/voxly/backups/20260726-182032/` (`voxly_control.dump`, `twenty.dump`); earlier aborted attempt also left `20260726-181912` / `20260726-181742`
  - Control DB: `prisma migrate deploy` applied pending `20260724180000_gift_campaign_schedule`, `20260725220000_ai_agent_knowledge_and_sales`, `20260726210000_conversation_last_operator_read` (`Conversation.lastOperatorReadAt`)
  - `POST /api/admin/tenants/:id/refresh-crm-chat` → antontest, antontest3, lexx, john all `{ok:true, versionHint:"0.1.10+"}` (saas-api tarball **0.1.11**)
- Verify:
  - Smoke: portal + API health + app healthz **200** (healthz briefly 502 ~75s after twenty recreate, then OK)
  - Containers recreated: saas-api, twenty-server, twenty-worker, ai-telegram-worker, ai-whatsapp-worker, gramjs-bridge
- Broken / blockers: none for this ship. First rsync attempt mid-run hit transient `Permission denied (publickey,password)`; retry succeeded with same SSHPASS.
- Next: user hard-refresh CRM; verify media players (WA/TG/GramJS video/voice/circle) + unread badges on deal list / chat tab.

### 2026-07-26 — INC-063 reopen: CRM video/audio via signed URL (Twenty /s size cap)
- Goal: video, voice, audio, кружочек show/play in CRM chat (photo already worked); keep AI vision/ASR where bytes exist.
- Cause: Twenty Apps `/s/*` logic JSON ~96KB — non-JPEG media got 413; WA default `convertToMp4` on audio hurt ASR; GramJS CRM download shared 8MB AI cap.
- Changes:
  - saas-api: HMAC `GET /api/crm/chat/media/:token` + `…/file/:fileId/signed-url`
  - voxly-crm-chat **0.1.11**: logic `get-crm-chat-file-url`; chat-panel `<video>`/`<audio>` via signed URL; photos stay base64; `[кружочек]` placeholder hide
  - ai-whatsapp-worker: `convertToMp4` only for video attachments
  - gramjs-bridge: CRM media download max 20MB
- Verify: send video/voice/circle on WA + GramJS + TG Business → bubble shows player; voice → AI transcript; hard-refresh CRM / refresh-crm-chat for 0.1.11
- Next: user hard-refresh CRM; verify media players + unread badges (deployed 2026-07-26 `/opt/voxly/backups/20260726-182032/`).
- Broken: GramJS outbound media still text-only; video AI stays placeholder (no multimodal video)
- Deploy status (2026-07-26): **shipped** with unread badges — see «Prod deploy: media 0.1.11 + unread badges»; backup `/opt/voxly/backups/20260726-182032/`.

### 2026-07-26 — Prod deploy: INC-063 media + INC-064 stale system prompt
- Goal: ship inbound media (GramJS/TG/WA) + CRM chat 0.1.9 video preview + agent prompt history filter to prod.
- Changes:
  - Deployed via `./scripts/prod-deploy.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` (CRM chat tarball baked into saas-api).
  - Backup: `/opt/voxly/backups/20260726-022902/` (`voxly_control.dump`, `twenty.dump`).
  - Commands:
    - `./scripts/prod-diff.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` (SSH was required)
    - `./scripts/prod-deploy.sh --dry-run saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`
    - `./scripts/prod-deploy.sh saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge`
- Verify:
  - Smoke: `https://getvoxly.ru/` **200**, `https://api.getvoxly.ru/health` **200**, `https://app.getvoxly.ru/healthz` **200**.
  - Containers up: saas-api, ai-telegram-worker, ai-whatsapp-worker, gramjs-bridge; gramjs `/health` → `ok`.
  - saas-api image includes `voxly-crm-chat` **0.1.9**.
- Broken: none observed on smoke; GramJS outbound media still text-only (known).
- Next: hard-refresh CRM (or re-apply Twenty app on workspaces still on older chat) to pick up 0.1.9; spot-check photo/sticker/voice + prompt edit mid-chat on john.

### 2026-07-26 — INC-064 agent prompt edit ignored mid-chat
- Goal: after portal PATCH of AiAgent.systemPrompt, next inbound uses the new prompt.
- Cause: not an in-memory config cache — ~20 prior assistant turns few-shot old persona over the new system prompt.
- Changes: fresh agent load by id + `updatedAt`; `filterHistoryAfterAgentUpdate` in ai-core; priority hint; TG/WA (+ GramJS via telegram worker).
- Verify: PATCH distinctive prompt → send message on assigned channel → reply follows new prompt without worker restart.
- Next: deploy `ai-core` consumers: ai-telegram-worker, ai-whatsapp-worker (GramJS via telegram worker).
- Broken: none expected.

### 2026-07-26 — INC-063 inbound media CRM + AI (GramJS / TG / WA)
- Goal: photos, videos, video notes, stickers, voice show in CRM chat and feed AI (vision/ASR) on all channels.
- Cause: GramJS skipped non-text; crm-chat blocked gramjs/WA file preview; TG Business stub attachments; WA dropped captionless media.
- Changes: gramjs-bridge inbound + `/messages/media`; ai-telegram-worker attachments+vision/ASR (+Bot API file_id); ai-whatsapp-worker classify/store + Evolution getBase64 + `/internal/messages/media`; saas-api file proxy; chat-panel video preview 0.1.9; gift-bot video_note.
- Verify: send photo-only / sticker / кружочек / voice on each channel → ChatMessage.attachments → CRM preview; AI reply references media.
- Next: deploy gramjs-bridge + ai-telegram-worker + ai-whatsapp-worker + saas-api + refresh CRM chat app; GramJS outbound media still text-only.
- Broken: none expected for text path.

### 2026-07-26 — AI agents: edit name/prompt/model in portal
- Goal: edit agent name + system prompt; show OpenRouter model on card.
- Changes: portal agents edit form; PATCH `model` → settings; serialize effectiveModel; TG/WA use agent.settings.model then `AI_CHAT_MODEL` / `google/gemini-2.5-flash`.
- Verify: deploy portal+api+workers; Изменить → save; card shows model.
- Next: none.

### 2026-07-26 — Lock system Opportunity stages (ADR-017)
- Goal: forbid renaming/deleting Новый лид / Успешная сделка / Сделка провалена; allow editing middle stages.
- Changes: PG trigger `trg_voxly_lock_opportunity_stage_options` + `voxly_merge_locked_opportunity_stages`; ensure merges locked into options; docs chat-defaults clarification.
- Verify: deploy saas-api; edit stage label in Settings → locked names restore; Screening rename sticks.
- Next: none.

### 2026-07-26 — Opportunity defaults = john-crm board (ADR-017)
- Goal: new Voxly CRM portals match john Сделки kanban (stages, SIDE_PANEL, card fields, Канбан/Списком).
- Cause: provision had RU labels/views but English NEW…CUSTOMER stages; no lost-deal column.
- Changes: `ensureOpportunityRuDefaults` enum+options+viewGroups; SQL script; twenty-client card hide + RU groups; `DEFAULT_WON_STAGES` includes `USPESHNAYA_SDELKA`; ADR-017.
- Verify: deploy saas-api; reapply on antontest3 → stages match john; new register smoke.
- Next: optional reapply other existing tenants.

### 2026-07-26 — Document CRM/AI chat golden path + push
- Goal: lock WA/TG/GramJS/AI agent chat behavior so agents never regress the working chat.
- Changes: new `docs/agent/CHAT.md`; wire README + FLOWS §4 + CAPABILITIES; commit INC-062 worker/compose + docs; push `feature/twenty-crm-chat-tab`.
- Verify: docs linked from README; git push origin.
- Next: optional TG typing parity with WA ≥3s.

### 2026-07-26 — INC-062 auto-free soft-deleted Person email
- Goal: business profile email sync survives Twenty trash unique; stop manual SQL after CRM wipe.
- Cause: `emailsPrimaryEmail` UNIQUE includes soft-deleted rows; updatePersonEmail failed while website OK.
- Changes: `releaseSoftDeletedPersonEmail` via `TWENTY_DATABASE_URL` on `ai-whatsapp-worker`; retry after trash clear; compose env; prod one-shot SQL for Антон; INC-062. IG/FB still N/A from Evolution for this peer.
- Verify: typecheck; deploy `compose,ai-whatsapp-worker`; worker has TWENTY_DATABASE_URL; Person email=anton@genadich.com.
- Next: none for email; IG only if URL in website/description or manual.

### 2026-07-26 — WA business socials (website) + stronger typing for personal peers
- Goal: Person «Сайт» + IG/FB from business profile when Evolution exposes URLs; typing visible on personal WA.
- Cause: no `website` social field; fetchBusinessProfile ignored website; IG/FB not in Baileys payload for this peer (only website/email); typing min delay ~1.2s easy to miss.
- Changes: PERSON_SOCIAL `website`/Сайт; parse website+IG/FB URLs; sync to Person; typing min 3s + presence before sendText(delay).
- Verify: typecheck; deploy worker; business inbound → Сайт=https://team-big.ru; personal inbound → «печатает» ≥3s.
- Next: deploy.

### 2026-07-26 — WA typing via sendText delay + email stuck in Twenty trash
- Goal: real «печатает…» before each bubble; Person email from business profile.
- Cause: sendPresence returns immediately (no visible typing); soft-deleted Person still held unique `emailsPrimaryEmail=anton@genadich.com`.
- Changes: `sendText({ delay })` for composing; create Person without email then update; log unique failures; prod freed trash email → active Антон.
- Verify: typecheck; deploy worker; CRM shows email; typing visible during delay before each bubble.
- Next: deploy.

### 2026-07-26 — INC-061 WA CRM duplicate email + parallel debounce flushes
- Goal: recreate Person/Opportunity after CRM wipe; one AI reply per burst.
- Cause: createPerson unique on email; 6s debounce fired before next msg (~7s) → two parallel humanLike.
- Changes: findPersonByEmail + duplicate recovery; debounce 10s + in-flight queue; early abort stamps.
- Verify: typecheck; deploy worker; close orphan LID conv on john.
- Next: deploy.

### 2026-07-26 — WA pacing + business email on PN peers
- Goal: visible delays between AI bubbles; fill Person email from WA business profile.
- Cause: Evolution 2.3 `sendPresence` needs top-level `presence`/`delay` (nested options → 400); local sleep capped at 2.2s; business profile fetched only for `@lid` after INC-060 PN identity; multi-bubble normalize did not hard-cap length.
- Changes: fix presence payload; full typing sleep + 4–6s gaps; email fetch for PN/LID; early-return sync still updates email; `normalizeAiBubbles` ≤140 chars; stronger short-bubble prompt.
- Verify: typecheck; deploy `ai-whatsapp-worker`; retest burst → spaced short bubbles + email on Person.
- Next: deploy.

### 2026-07-26 — INC-060 WA duplicate deal from CUID-as-phone + LID/PN twin
- Goal: one WA message → one Person + one Opportunity (user saw `+20034505` + `Антон`).
- Cause: Contact CUID digits → fake E.164; Evolution twin LID+PN webhooks → two Conversations.
- Changes: `ai-whatsapp-worker` — drop `row.id` from phone extract; E.164 min 10; messageId twin skip+enrich; merge by phone; prefer E.164 platformUserId.
- Verify: typecheck OK; deploy `ai-whatsapp-worker` (backup under `/opt/voxly/backups/` latest); smoke 200.
- Next: user wipe deals/contacts → one WA msg → expect single Person+Opportunity; log may show `skip duplicate webhook`.

### 2026-07-26 — Evolution → v2.3.7-lid (INC-059 LID→PN)
- Goal: ship Baileys lidMapping / `remoteJidAlt` so CRM can get phones WA UI already shows.
- Changes: `docker/evolution-api.Dockerfile` `FROM evoapicloud/evolution-api:v2.3.7` + resilient `@lid` bypass (150 chunks patched); compose image `voxly-evolution-api:v2.3.7-lid`; `./scripts/prod-deploy.sh evolution-api,ai-whatsapp-worker`. Webhook re-applied for john WA instance with `PRESENCE_UPDATE`.
- Verify: backup `/opt/voxly/backups/20260726-002454/`; Evolution **v2.3.7** Up, instance auto-reconnect **CONNECTED TO WHATSAPP** (no QR); worker `evolution=yes`; smoke getvoxly.ru + api `/health` **200**.
- Broken / blockers: none on reconnect. Confirm next LID inbound fills Person phone via `remoteJidAlt`/`senderPn`.
- Next: user sends a test WA message from LID peer; check worker logs `source=webhook`.

### 2026-07-26 — WA LID: cache PN + business email (still need Evolution ≥2.3.7)
- Goal: after user correction — WA UI shows PN via lidMapping (not address book); finish worker-side mitigations without inventing phones.
- Cause: Evolution `v2.2.3-lid` never exposes `remoteJidAlt`/`senderPn`; `fetchBusinessProfile(@lid)` returns email/address only (no phone); `whatsappNumbers(LID)` exists:false.
- Changes: `ai-whatsapp-worker` — reuse `Conversation.platformUsername` E.164 cache; `fetchBusinessProfile` → Person email; `twenty-client.updatePersonEmail`. Avatar invent stays OFF (INC-059).
- Verify: `pnpm --filter @voxly/twenty-client build` + WA worker typecheck.
- Next: deploy `ai-whatsapp-worker` (and twenty-client via image build); plan Evolution → **v2.3.7** for real LID→PN (may need QR re-scan).

- Goal: ship presence line (voxly-crm-chat **0.1.8**) + GramJS peer-status + WA presence cache to prod.
- Changes: `./scripts/prod-deploy.sh saas-api,gramjs-bridge,ai-whatsapp-worker` (no `evolution-api`). Admin `POST …/refresh-crm-chat` for tenant **john** → `{ok:true, versionHint:"0.1.8+"}`.
- Verify: backup `/opt/voxly/backups/20260726-000817/` (`voxly_control.dump`, `twenty.dump`); containers saas-api / gramjs-bridge / ai-whatsapp-worker recreated Up; smoke getvoxly.ru + api `/health` **200**; `prod-diff` hot files **OK** for the three services. Evolution left Up (unchanged, 38h).
- Broken / blockers: none for deploy. WA `PRESENCE_UPDATE` only lands on Evolution webhook set at create/connect — existing instances still need webhook re-apply (next QR/connect or safe `/webhook/set`); not run this pass.
- Next: hard-refresh CRM Chat on john; optional Evolution webhook re-apply for existing WA (not an Evolution image upgrade).

### 2026-07-26 — CRM chat: presence line instead of format cheat-sheet
- Goal: remove gray «Формат: **жирный**…» under channel header; show contact online / last seen.
- Changes: `voxly-crm-chat` **0.1.8** presence line (hide if unknown); `crm-chat` GET `presence`; GramJS `POST /messages/peer-status`; WA `PRESENCE_UPDATE` in-memory cache + `GET /internal/chat/presence`; TG Business/gift omit (Bot API); `versionHint` 0.1.8+.
- Verify: no `Формат:` in chat-panel; GramJS chat shows «онлайн» / «был(а) в сети …»; WA only after presence webhook; Business line hidden.
- Next: done — deployed 2026-07-26 (`20260726-000817`); john crm-chat refreshed to 0.1.8+. Remaining: hard-refresh CRM; WA webhook re-apply for existing instances.

### 2026-07-26 — WA LID→PN: no invent phones; Evolution upgrade needed (INC-059)
- Goal: CRM Person phone when WA UI shows number but webhook is `@lid` only; stop wrong avatar twins.
- Cause: Evolution 2.2.3-lid never stores `remoteJidAlt`/`senderPn` (0 msgs); IsOnWhatsapp has no LID map. WA client shows PN via lidMapping — not address-book-only. Avatar Contact twin invented wrong E.164 (7915… vs real 7985…).
- Changes: `ai-whatsapp-worker` — avatar match OFF unless `WA_LID_AVATAR_PHONE_MATCH=1`; broader webhook/Contact/Chat field parse; `source=` logs when LID has no PN; Dockerfile + `.env.example` upgrade notes → **v2.3.7**; ADR in DECISIONS; INC-059.
- Verify: `pnpm --filter @voxly/ai-whatsapp-worker typecheck`. Deploy not run this session.
- Next: `./scripts/prod-deploy.sh ai-whatsapp-worker` then plan Evolution → v2.3.7 (`evolution-api,ai-whatsapp-worker`); expect possible QR re-scan.

### 2026-07-26 — WA phone empty: LID webhook, no E.164 in Evolution
- Goal: explain/fix missing `+7 985 501 4040` on Person.
- Cause: Evolution Message.key never has `remoteJidAlt`/`senderPn` (0/58 msgs); Contact has LID rows + separate `79150946944@s.whatsapp.net` (same avatar as one LID). Number `79855014040` **absent** from Evolution DB — **correction:** WA chat UI can show PN without address book (lidMapping); earlier «address book only» was wrong.
- Changes: parse WA `contactMessage` vCard; findChats fallback; backfill Person `e51b8ae7…` → `9855014040` / `+7` + Conversation `platformUsername=+79855014040`.
- Verify: CRM Person Антон shows phone; next shared contact fills automatically.
- Next: superseded by INC-059 (disable avatar invent + Evolution upgrade).

### 2026-07-26 — Inbound debounce + multi-bubble + read receipts
- Goal: wait 5–6s quiet; 2–4 bubbles with 3–4s gaps; stop if client writes mid-send; blue ticks / read.
- Changes: debounce default **6s**; `humanBubbleGapMs` 3–4s; `normalizeAiBubbles` + json_object; abort outbound on newer user msg; TG `readBusinessMessage`; GramJS `ReadHistory` on inbound; WA markRead on receive + preferred remoteJid.
- Verify: deploy TG/WA/gramjs workers; retest burst + mid-send interrupt.
- Next: user retest all 3 channels.

### 2026-07-26 — Deploy debounce/link + GramJS composer pin (placeholder bug)
- Goal: user retest failed on undeployed code; GramJS composer still scrolled.
- Cause: (1) prod had no `inboundAiDebouncer` / `createAndLink`. (2) shell-ux matched placeholder «Ответ в…» — placeholders are **not** in `textContent`; GramJS has no «Прикрепить».
- Changes: detect pin via `Отправить`+`Жирный` / `data-voxly-crm-chat`; chat-panel `data-voxly-crm-chat=1` **0.1.7**; debounce default **5s**; linkPerson multi-shape + logs; deployed `saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge,twenty`; refreshed john crm-chat.
- Verify: containers dist contain `inboundAiDebouncer`/`createAndLink`; shell-ux has `deepHasAttr`; app healthz 200.
- Next: user wipe deals → WA/TG/GramJS burst «Привет»+«Я Антон» → one AI reply after ~5s; Opportunity shows Person; GramJS composer pinned after hard-refresh CRM.

### 2026-07-26 — Person↔Opportunity link + no auto-pause + inbound debounce
- Goal: contact attached to deal; AI stays on until manual pause/off; n8n-like inbound debounce + bubble gaps; GramJS composer pin; WA blue ticks.
- Changes:
  - `twenty-client` `createOpportunity`: connect-first + explicit `updateOpportunity` link (`pointOfContact` / `pointOfContactId`).
  - Removed auto-`pausedUntil` on CRM reply (`crm-chat`), TG Business/GramJS human outbound, WA `/internal/messages/send`. Manual `/pause` `/off` / CRM AI buttons kept.
  - `@voxly/ai-core` `createInboundDebouncer` + `humanBubbleGapMs`; TG/WA workers debounce ~4s (`AI_INBOUND_DEBOUNCE_MS`); GramJS internal inbound quiet-wait; inter-bubble 1–3s.
  - `twenty-shell-ux.js`: pin composer for «Ответ в…» (GramJS placeholder).
  - WA `markWhatsAppRead`: multi-jid + message-id normalize + logging.
- Verify: build ai-core/twenty-client; tsc workers + saas-api + gramjs-bridge. Deploy: `saas-api,ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge,twenty` (shell-ux). Retest john: new inbound → Person on Opportunity; burst msgs → one AI reply; CRM reply does not mute AI; GramJS composer fixed; WA ticks.
- Next: prod deploy + user retest.

- Goal: WA read/typing/split; GramJS presence; CRM labels contact/bot+agent/manager.
- Changes: WA parseAiBubbles+humanLike send; markRead on open/send; GramJS SetTyping/ReadHistory; crm-chat contactName/botAgentLabel/operatorName + sender_meta; crm-chat **0.1.6**.
- Verify: deploy saas-api,ai-whatsapp-worker,gramjs-bridge; refresh-crm-chat; hard-refresh CRM.
- Note: after CRM reply AI pauses ~1h (pausedUntil) — press «Вкл AI» to resume.
- Next: user retest WA/GramJS on phone.

### 2026-07-26 — CRM AI buttons missing + dashboard spend 0₽
- Goal: show Вкл/Пауза/Выкл AI in CRM chat; show real AI spend on dashboard.
- Cause: (1) private tarball registry duplicate → install kept old front without AI UI; no uninstall/reinstall. (2) OpenRouter `usage.cost:0` trusted → chargedRub=0; Math.round hid kopecks.
- Changes: uninstall+forceReinstall on provision/refresh; crm-chat **0.1.5** AI bar; cost fallthrough when cost=0; dashboard formatRub + tokens/себестоимость.
- Verify: deploy saas-api/portal/TG/WA; refresh-crm-chat for tenant; hard-refresh CRM Chat → AI bar; new AI reply → spend > 0.
- Next: user hard-refresh CRM; enable Business reply rights if still limited.

### 2026-07-26 — Stage by option id + admin purge + Business send honesty + CRM AI buttons
- Goal: renamed stages; full admin account wipe; TG Business AI not reaching Telegram; missing CRM AI controls.
- Changes: twenty-client `resolveDefaultOpportunityStage` via seed option id; `purgeTenantFully` + admin DELETE + portal «Удалить»; TG worker `can_reply` gate + persist-after-send; voxly-crm-chat 0.1.4 AI buttons + `refreshCrmChatAppForTenant`.
- Verify: deployed `saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker,gift-bot-worker`; smoke api/portal 200 after boot; backup under `/opt/voxly/backups/`.
- Broken / blockers: Business still needs Telegram «Отвечать на сообщения» (`can_reply=true`); CRM Chat on existing workspaces needs refresh or re-register after purge.
- Next: user purge `john` in `/admin` → re-register → E2E; enable Business reply rights.

### 2026-07-25 — Deal stage NOVYY_LID + CRM AI controls + chat thread fixes
- Goal: DanMSK toast without deal; empty chat; WA wrong deal/dup chip; AI controls in CRM chat.
- Cause: createOpportunity `stage:NEW` invalid after RU defaults; biz chip dedupe hid peers; WA pushName LID merge; mode=human stuck.
- Changes: twenty-client stage fallback; crm-chat peer dedupe + POST /ai; voxly-crm-chat 0.1.4 AI buttons; drop pushName LID map; backfill DanMSK opp `a38b7211-…`.
- Verify: deploy saas-api + TG/WA/gift workers; hard-refresh CRM Chat → AI buttons; new inbound creates Opportunity.
- Next: user retest DanMSK deal + new WA number.


### 2026-07-25 — CRM Business reply BUSINESS_PEER_INVALID
- Goal: explain/fix CRM send error on Business-бот.
- Cause: Telegram `can_reply=false` (registry `limited`); not a bad chat_id alone.
- Changes: crm-chat assert + RU humanize; TG worker peer labels from `chat.*`.
- Verify: deploy saas-api,ai-telegram-worker; user enables reply rights in TG Business → CRM send works.
- Next: user re-enable «Отвечать на сообщения» for @voxly_AI_Agent_bot.


### 2026-07-25 — AI silent after CRM reply (mode=human stuck)
- Goal: john assigned agent; WA/TG no AI reply; no CRM toast on test.
- Cause: (1) CRM/WA outbound set `mode=human` + `pausedUntil`; after pause expired mode stayed human → `shouldAiReply` false forever. (2) TG test text «Чем вы занимаетесь?» was **operator** (wrote from business phone) → auto-pause 1h, no inbound toast.
- Changes: crm-chat + WA worker pause = only `pausedUntil` (keep mode ai); better WA AI-off log; prod reset john WA+TG convs to mode=ai, pausedUntil=null.
- Verify: deploy saas-api,ai-whatsapp-worker; write as **customer** to WA / business bot → AI replies; toast for role=user.
- Broken / blockers: none.
- Next: user retest from second phone (not as business owner).


### 2026-07-25 — Fix AI agent assign 404 (unclosed /usage handler)
- Goal: assigning agent on `/dashboard/ai/agents` returned Fastify «Not Found».
- Changes: close `GET /usage` in `ai-agents.ts` — assign/patch/knowledge/sales routes were nested after `return` and never registered.
- Verify: deploy `saas-api` (backup `20260725-203628`); `/health` 200 after boot; unauth `PATCH …/assign/bot/:id` → 401 (not route 404).
- Broken / blockers: deploy smoke raced boot (404 → then 200).
- Next: user retest assign in portal.


### 2026-07-25 — AI never replies to / creates CRM for bots
- Goal: bot senders → no AI, no Conversation/messages, no CRM Opportunity.
- Changes: TG `from.is_bot` early return before CRM; GramJS `User.bot` (+ `isBot` to `/internal/inbound`); WA skip status/newsletter/broadcast; CAPABILITIES note.
- Verify: deployed `ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` (--skip-backup); smoke portal/api 200; containers grep `is_bot` / `sender.bot` / newsletter.
- Broken / blockers: none.
- Next: none.


### 2026-07-25 — Agent KB + won-deal sales RAG (ADR-016)
- Goal: knowledge files + learn only from successfully closed CRM deals.
- Changes: Prisma AiKnowledge*/AiSalesExample + `salesLearnedAt`; ai-core RAG; saas-api upload/sync; TG/WA prompt inject; agents portal UI; compose volume `ai-knowledge-data` + OpenRouter on saas-api.
- Verify: migrate `20260725220000` on prod; api/portal 200; tables AiKnowledge* / AiSalesExample; `rag.js` in image.
- Broken / blockers: mid-deploy disk **100%** (INC-052); pruned unused images (~66GB) + journals; volumes untouched; services restarted.
- Next: create/configure john agent + upload KB + assign bots.


### 2026-07-25 — Deploy OpenRouter cost + admin AI credit; john +100₽
- Goal: ship live OpenRouter AI cost; admin manual AI top-up; credit john.
- Changes: deploy `saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker` (backup `20260725-185017`); `POST /api/admin/tenants/:id/ai-credit` + admin UI column; prod `usd_rub_rate=90` + `USD_RUB_RATE=90`; john `AiWallet` → **100.00**.
- Verify: api/portal smoke 200 (after boot); workers have `openrouter-cost.js`; admin route has `ai-credit`.
- Broken / blockers: first smoke 502 during boot only.
- Next: create/configure AiAgent for john + assign to bots.


### 2026-07-25 — OpenRouter live AI cost (usage.cost + /models)
- Goal: bill AI from OpenRouter prices, not hardcoded worker tables.
- Changes: `@voxly/ai-core` `resolveProviderCostRub` (prefer `usage.cost`, else cached `/models` pricing, USD→RUB via `USD_RUB_RATE`/`usd_rub_rate`); TG+WA workers wired; seed + `.env.example`; ADR-015.
- Verify: `pnpm --filter @voxly/ai-core test` + build; typecheck ai-telegram/whatsapp workers.
- Broken / blockers: not deployed; set `USD_RUB_RATE` (or seed `usd_rub_rate`) on prod.
- Next: deploy `ai-telegram-worker,ai-whatsapp-worker` (+ rebuild ai-core in images); optional upsert `usd_rub_rate` on control PG.


### 2026-07-25 — One-shot trial for personal TG + WhatsApp
- Goal: clear 14-day trial for GramJS and WhatsApp accounts.
- Changes: `channel-trial.ts` one-shot trial; gramjs/whatsapp start-trial + `trialAvailable`; portal trial cards + dashboard CTAs; paid webhook sets `trialConsumed`.
- Verify: `/dashboard/ai/gramjs` and `/whatsapp` → «Активировать trial»; QR after trial.
- Broken / blockers: none.
- Next: none.


- Goal: clear cabinet IA — sidebar menu; `/dashboard` = overview stats only; products in separate items.
- Changes: `AppShell` left nav (Дашборд, Gift, Business, WA, AI-агенты, Личный TG); `GET /api/tenant/dashboard`; rewritten dashboard page (messages, dialogs, leads, tariffs, money, gift funnel); CRM button kept.
- Verify: deploy saas-api + saas-portal; open `/dashboard` — sidebar + KPIs.
- Broken / blockers: CRM deal-stage breakdown still approximate (linked Opportunity ids), not full Twenty stage groupBy.
- Next: optional Twenty stage counts when user needs exact pipeline.


- Goal: apply `20260725190000`, deploy billing services, restyle portal to DESIGN.md clinical blueprint.
- Changes:
  - Control PG backup `20260725-204140-pre-ai-usage-mig` + migration applied (`AiUsageLog.aiAgentId`, referral 20%).
  - Deploy backup `20260725-174330`; rebuilt saas-api, saas-portal, ai-telegram-worker, ai-whatsapp-worker.
  - Portal tokens/components: canvas/paper/ink, 18px pills / 24px cards, monochrome; landing mock UI + login/register.
- Verify: `https://api.getvoxly.ru/health` 200; `https://getvoxly.ru/` 200 (smoke may 404 while Next boots — recheck).
- Broken / blockers: first smoke raced portal start; password SSH still in use — rotate.
- Next: hard-refresh portal; optional third portal sync for late polish; rotate root SSH.


- Goal: close product gaps — Business >10 @ 200₽, Robokassa for GramJS/WA/top-up, spend by agent, referral 20% excl. AI top-up, admin health.
- Changes:
  - Shared: `ai_tg_extra_conn`, `ai_topup`, `REFERRAL_EXCLUDED_PRODUCTS`, capacity helpers; seed/migration referral `percent_recurring` 20%.
  - Billing checkout/webhook: extras, channel addons, wallet top-up, referral skip `ai_topup`.
  - API: Business capacity + unlink; GramJS/WA `requiresPayment` + 402 QR; `GET /api/ai/agents/usage`; `GET /api/admin/health`.
  - Portal: buy slot/unlink; pay buttons GramJS/WA; usage + top-up; admin health card.
  - Workers: capacity gate; `chargeAiUsage({ aiAgentId })`.
- Verify: apply migration `20260725190000_…` on control PG; deploy `saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker`; smoke checkout + health.
- Broken / blockers: not deployed this session.
- Next: `./scripts/prod-deploy.sh` + migrate; smoke Robokassa sandbox/prod.


- Goal: restore `/dashboard/bots` after saas-api deploy.
- Changes: applied `20260724183000_bot_telegram_description` on prod control PG.
- Verify: refresh Боты → list loads.
- Broken / blockers: none.
- Next: none.

### 2026-07-24 — INC-050 CRM chat clickable links
- Goal: URLs in CRM «Чат» clickable; stop `nbsp;` artifacts between paragraphs.
- Changes: `chat-panel` linkify + normalize entities; empty lines without `&nbsp;`; `voxly-crm-chat` 0.1.3; `twenty-deal-chat.js` parity.
- Verify: deploy `saas-api` (backup `20260724-152543`); john reinstall app **0.1.3** (front checksum `d139152c…`); hard-refresh Chat → links open.
- Broken / blockers: none (tarball apps cannot `upgradeApplication` — uninstall+`ensureCrmChatAppInstalled`).
- Next: none.

### 2026-07-24 — Gift: первое vs стартовое сообщение
- Goal: разделить экран до /start (описание бота в Telegram) и сообщение после /start (воронка).
- Changes:
  - Prisma `BotInstance.telegramDescription` / `telegramShortDescription` + migration `20260724183000_bot_telegram_description`.
  - API `PUT /api/bots/:botId/telegram-profile` → Telegram `setMyDescription` + `setMyShortDescription`.
  - Portal: **1.2 Первое сообщение** (описание) → **1.3 Стартовое** (funnel `start` + кнопка подписки).
- Verify: migrate DB; deploy saas-api + saas-portal; сохранить 1.2 → открыть t.me/bot без Start; /start → 1.3.
- Broken / blockers: не задеплоено на prod в этой сессии.
- Next: `./scripts/prod-deploy.sh saas-api saas-portal` + apply migration на control Postgres.

### 2026-07-24 — CRM thread dedupe + gift project schedule
- Goal: fewer identical «Business-бот» chat pills; schedule project start/stop (day1/day2).
- Changes:
  - `listCrmChatTargets`: exclude `telegram_business_account`; dedupe gift / Business connection / peer.
  - Prod: unlink 2 spurious Business Conversations from toxasag Person.
  - `GiftCampaignConfig.scheduledStartAt/EndAt` + PATCH; scheduler flips `isActive` every 1m.
  - Portal ProjectPicker: datetime start/stop for selected project.
- Verify: deploy saas-api+portal; CRM Chat shows gift + one Business; schedule UI on bot page.
- Broken / blockers: none.
- Next: hard-refresh CRM chat + bot projects page.

### 2026-07-24 — INC-049 gift creates duplicate Opportunity for same Person
- Goal: `@toxasagmsk` got 2 канбан leads (AI Business + gift `voxly_john_01_bot` / den).
- Changes:
  - Root: gift `syncSubscriberToCRM` reused Person via hint but **always** `createOpportunity`.
  - Gift now reuses Opportunity from other GiftSubscriber / Conversation for same `twentyPersonId` (parity with AI sync).
  - Prod cleanup john: gift sub → keep opp `481c5d9c…`; `deleteOpportunity` dupe `742c44fb…`.
- Verify: deploy gift-bot-worker; kanban one `@toxasagmsk` AI deal; hard-refresh CRM.
- Broken / blockers: none.
- Next: optional note on gift card that chat thread is multi-channel under one deal.

### 2026-07-24 — INC-048 CRM chat live refresh + toast skew
- Goal: inbound visible in open CRM «Чат» without hard refresh; toast not skipped by clock skew.
- Changes:
  - `docker/twenty-shell-ux.js`: on toast for open record → click «Обновить»; soft-click ~4.5s while Chat canvas open; empty-poll `since` skew 2s→15s.
  - `chat-panel`: `data-voxly-chat-refresh`; skip spinner on soft reloads (next app ship).
  - Prod: hot-patch `/voxly-shell-ux.js` on twenty-server (+ `/opt/voxly/docker/` source).
- Verify: hard-refresh john-crm → shell-ux has `clickOpenChatRefresh`; open Chat → send inbound → toast ≤~5s + message appears without F5.
- Broken / blockers: none.
- Next: optional saas-api rebuild to ship chat-panel silent reload attribute.

### 2026-07-24 — Business accounts list + CRM deal + can_reply
- Goal: show which Business accounts are linked to AI bot; CRM deal on dialog; agent = on bot for all accounts; fix missing deal for john.
- Changes:
  - Worker: `upsertBusinessAccountLink` (`channel=telegram_business_account`); CRM sync on human outbound; Opportunity name/note include Business label; warn/status `limited` when `can_reply=false`.
  - API: `GET /:botId/conversations` → `businessAccounts[]`; bot list count prefers registry.
  - Portal bot page: list accounts + rights warning; copy «Агент на этого бота» (all Business accounts).
  - Prod backfill: registry for conn `oEkaj0p…` owner `641470324`; CRM Person/Opportunity for peer `8126723475`.
- Verify: deploy saas-api + saas-portal + ai-telegram-worker; smoke 200; registry row status=limited; deal linked.
- Broken / blockers: Telegram Business automation had **empty rights / can_reply=false** — user must grant read+reply or inbound won't arrive.
- Next: user enables bot rights in TG Business → reconnect/refresh → assign agent on `/dashboard/ai/agents` → bot page → write from customer again.

### 2026-07-24 — AI Business: manual BotFather token (no manager create)
- Goal: `/dashboard/ai` — instruction + username/token form + delete; stop manager-bot create (Business Mode всё равно в BotFather).
- Changes:
  - `POST /api/bots/ai/connect` — getMe, encrypt token, `provisionedVia=manual`, setWebhook business updates; warn if `can_connect_to_business=false`.
  - `DELETE /api/bots/:id` for `ai_tg` — deleteWebhook + hard/soft delete.
  - `provision-link` rejects `ai_tg`.
  - Portal AI page rewritten: BotFather steps + form + trash.
- Verify: deploy saas-api + saas-portal; connect token → bot in list; delete removes.
- Broken / blockers: none.
- Next: user hard-refresh `/dashboard/ai`; existing `@voxly_AI_Agent_bot` can stay or re-paste token.

### 2026-07-24 — INC-046 AI Business bot missing after create
- Goal: john «Подключить бота» → `@voxly_AI_Agent_bot` created in TG but portal stayed empty.
- Changes:
  - Root: TG id linked to antontest; custom username ≠ `voxly_john_*`; matcher stuck on wrong tenant.
  - `manager-bot-service`: `resolveProvisionForManagedBot` + `assignTelegramToTenantOwner`; cancel duplicate pendings.
  - Portal AI page: waiting card, stronger «Привязать Telegram» hint; hide empty while provisioning.
  - Prod: rebuild manager+portal; replay ManagedBotUpdated → john ai_tg active.
- Verify: john `@voxly_AI_Agent_bot` active; TG link on john@voxly.ru; portal/api smoke OK.
- Broken / blockers: none.
- Next: user hard-refresh `/dashboard/ai` → see bot; connect in Telegram Business automation.

### 2026-07-24 — Opportunity views: Канбан + Списком (not All Сделки kanban)
- Goal: john view picker — default **Канбан**, second **Списком** (table); stop second fake kanban «All Сделки».
- Changes:
  - Root cause: GraphQL `updateView` wrote `type=KANBAN` / `IconLayoutKanban` into `view.overrides` on seeded TABLE; SQL demoted key but UI still rendered kanban «All Сделки».
  - SQL `set-opportunity-kanban-default.sql` + `ensureOpportunityRuDefaults`: list view → **Списком** / TABLE / IconList; strip kanban overrides; dedupe duplicates.
  - `twenty-client.ensureOpportunityKanbanDefault`: skip in-place INDEX→KANBAN when separate board exists; `ensureOpportunityListView` renames secondary to Списком.
  - Prod: SQL all workspaces; deploy `saas-api`; `reapply-crm-defaults` john **200**.
- Verify: john active views = `Канбан` KANBAN INDEX + `Списком` TABLE IconList; portal/api **200**.
- Broken / blockers: none. Hard-refresh john-crm view picker.
- Next: new portal provision should get same pair via SQL defaults.

### 2026-07-24 — GramJS delete + UI parity with WhatsApp
- Goal: delete button on connected TG personal accounts; unify `/dashboard/ai/gramjs` layout with WhatsApp page (agent hit usage limit).
- Changes:
  - `gramjs-bridge`: `POST /accounts/delete` — LogOut + disconnect, clear maps, null Conversations, delete/soft-delete `BotInstance`.
  - `saas-api` `DELETE /api/bots/gramjs/accounts/:botId` (owner) with local fallback if bridge down.
  - Portal gramjs page: 2-col grid, trash on cards, trial/QR chrome aligned with WhatsApp.
- Verify: local code ready; deploy `saas-portal,saas-api,gramjs-bridge` when asked / next.
- Broken / blockers: none.
- Next: prod deploy + delete one test GramJS account from UI.

### 2026-07-24 — Opportunity RU labels: Сделки + view «Канбан»
- Goal: john + new portals: Opportunity UI says Сделки (not Возможности); create CTA «Новая Сделка»; default board view «Канбан».
- Changes:
  - Root cause: GraphQL `updateOneObject` rejects `isLabelSyncedWithName` on standard objects → prior `applyWorkspaceDefaults` silently skipped RU labels; UI fell back to built-in RU «Возможности».
  - `@voxly/twenty-client`: Opportunity labels Сделка/Сделки without sync flag; INDEX view rename → «Канбан»; opportunity label errors rethrow.
  - `docker/set-opportunity-kanban-default.sql`: rename INDEX → Канбан + force labels + `isLabelSyncedWithName=false`.
  - `saas-api` `ensureOpportunityRuDefaults` (SQL) on provision + `reapply-crm-defaults`.
  - `docker/twenty-shell-ux.js`: rewrite New/Новый+Сделка/Возможность → «Новая Сделка» (Twenty masculine «Новый » template).
  - Prod: deploy `saas-api` + `twenty`; SQL on all workspaces; `reapply-crm-defaults` john **200**.
- Verify: john `labelSingular=Сделка` `labelPlural=Сделки` INDEX=`Канбан`; shell-ux `fixOpportunityCreateCta`; portal/api/app **200**.
- Broken / blockers: none.
- Next: user hard-refresh john-crm → nav, header, Person relation, create CTA, view selector «Канбан».



- Goal: TG (GramJS/ai_tg) inbound with known phone reuses WA Person (phones/whatsapp); WA inbound merges into TG Person by phone; ambiguous → needsReview.
- Changes:
  - `@voxly/twenty-client`: `normalizePhoneToE164`, `phoneSearchVariants`, `findPersonByPhone` (phones + whatsapp).
  - `gramjs-bridge`: pass `Api.User.phone` → `/internal/inbound`; fix pre-existing `TypeInputChannel` cast so image builds.
  - `ai-telegram-worker` `syncLeadToCrm`: phone candidates + contact share; reuse Opportunity by Person; INC-042 intact.
  - `ai-whatsapp-worker` `syncLeadToCrm`: findPersonByPhone (+ optional TG username hint) before createPerson.
  - Docs: FEATURES, INC-044, CAPABILITIES, steps.
- Verify: backup `20260724-123237`; deploy `ai-telegram-worker,ai-whatsapp-worker,gramjs-bridge` (containers Up); smoke portal/api **200**. Manual E2E: WA Person `whatsapp=+7915…` → TG inbound with same visible phone → same `twentyPersonId`, second thread; no phone → new Person; multi-match → `needsReview`.
- Broken / blockers: GramJS only sees phone when peer is in contacts / privacy allows; Bot API only via contact share.
- Next: john E2E — message from TG account whose phone matches WA `+79150946944` Person; confirm toast opens that Person.

### 2026-07-24 — INC-043 WA phones/whatsapp empty (LID, Contact book resolve)
- Goal: Person Phones + social WhatsApp filled when Evolution has E.164 even if webhook is LID-only.
- Changes:
  - Root cause: Android inbound stored as `@lid` only — no `senderPn`/`remoteJidAlt` in Message; INC-039 path left CRM phone empty while Contact book had `79150946944@s.whatsapp.net` (same avatar).
  - `ai-whatsapp-worker`: `resolvePhoneFromEvolutionContacts` (profilePic fingerprint → unique pushName); inbound + `POST /internal/crm/backfill-phones`.
  - `voxly-crm-chat` **0.1.2**: composer placeholder uses `channelLabel` (WA/Telegram/…).
  - Prod: backup `20260724-121355`; deploy `ai-whatsapp-worker,saas-api`; backfill john 2/2 resolved → `+79150946944`; re-ensure crm-chat.
- Verify: Twenty john Persons both have `phonesPrimaryPhoneNumber=9150946944` +`callingCode=+7`, `whatsapp=+79150946944`; Conversations `platformUsername=+79150946944`; api/portal **200**.
- Broken / blockers: unique pushName can map two LIDs to one phone if names collide; true LID-only peers (no Contact phone row) still cannot show a number (WA privacy).
- Next: user hard-refresh john-crm → open Антон → check Phones/WhatsApp; send new WA inbound → fields fill without backfill.

### 2026-07-24 — INC-042 WA CRM sync skips recreate after wipe
- Goal: after deleting all People/Opportunities, WA inbound must recreate Person+Opportunity; toast click opens Chat.
- Changes:
  - Root cause: Conversation kept soft-deleted `twentyPersonId`/`twentyOpportunityId`; `syncLeadToCrm` early-returned (updates may still touch trash rows).
  - `@voxly/twenty-client`: `personExists` / `opportunityExists` (GraphQL excludes trash).
  - `ai-whatsapp-worker` + `ai-telegram-worker`: validate → clear stale → recreate; sync every inbound.
  - `twenty-shell-ux.js`: toast click only when CRM ids present (hot-patched on twenty-server).
  - Docs: INC-042, FEATURES, CAPABILITIES, steps.
- Verify: backup `20260724-115625`; deploy workers; backfill john 2 WA convs → new Person+Opportunity; service-token GET chat **200** (9 + 4 msgs, `channelLabel=WhatsApp`); live people=3; api/portal **200**.
- Broken / blockers: none. User hard-refresh john-crm → open new Антон Persons → toast click on next inbound.
- Next: optional twenty image rebuild so shell-ux survives recreate; smoke new WA inbound after wipe again.

### 2026-07-24 — INC-041 CRM inbound toasts never fire (sed guard)
- Goal: john-crm left toasts for new inbound; work on hard-refresh without portal Open CRM.
- Changes:
  - Root cause: Dockerfile sed replaced toast guard placeholder → `pollInboundToasts` always returned (INC-041).
  - `docker/twenty-shell-ux.js`: `apiUrlReady()` via `indexOf('__')`; prefer `/s/crm-chat/inbound-toasts` using Twenty `tokenPairState`; fallback portal JWT → API; reject non-`items` proxy shape.
  - `voxly-crm-chat` logic `get-inbound-toasts` (app **0.1.1**); uninstall/reinstall john + upload bump.
  - Docs: INC-041, FEATURES, CAPABILITIES.
- Verify: baked/hot shell-ux has `apiUrlReady` + `/s/…inbound-toasts`; john `logicFunction` includes `get-inbound-toasts`; `/s/crm-chat/inbound-toasts` → Missing auth (not 404); backups `20260724-113359`; api/portal **200**.
- Broken / blockers: none for toast path. User must hard-refresh CRM once.
- Next: user hard-refresh john-crm (logged in, bookmark OK) → send inbound → left toast ≤10s.

### 2026-07-24 — CRM toast + social fields + cabinet dedupe + note body
- Goal: john + new portals: left inbound toast; Person social fields (+ WA→whatsapp); one «Кабинет Voxly»; kanban notes show body ≤5 lines.
- Changes:
  - `GET /api/crm/chat/inbound-toasts`; `docker/twenty-shell-ux.js` (toast poll, cabinet dedupe, token capture); Dockerfile sed `VOXLY_API_URL` into shell-ux.
  - `twenty-client.ensureSocialFields` / `updatePersonWhatsapp`; WA `syncLeadToCrm` fills `whatsapp`; `applyWorkspaceDefaults` creates social TEXT fields.
  - `docker/dedupe-cabinet-nav.sql` (core.`navigationMenuItem`); prod-deploy `twenty` whitelist includes shell-ux + SQL.
  - Prod: backup via deploy; recreate twenty + rebuild saas-api/ai-whatsapp-worker; SQL note triggers; `reapply-crm-defaults` john → 8 social fields; deleted duplicate cabinet; backfill whatsapp from phones.
- Verify: portal/api/app **200**; john social fields present; note title=body samples; inbound-toasts `items[]`; one «Кабинет Voxly» row.
- Broken / blockers: toast needs Open CRM `#voxlyChatToken` (silent without); Custom+CRM-Chat dual apps caused dup (deduped); note SQL still manual for brand-new schemas.
- Next: user hard-refresh john-crm — toast on inbound; social group; single cabinet; kanban note body ≤5 lines.

### 2026-07-24 — Prod deploy INC-039 (+ INC-040 toast map in tree)
- Goal: Unblock SSH and ship WA media/typing/phone/LID fixes; include CRM deleted-account error UX if present.
- Changes:
  - SSH: restored `sshpass -e` + password-only opts from prior successful deploy transcript (secret not logged).
  - `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker` (crm-chat tarball via saas-api; no gramjs-bridge — deleted-account map is in `crm-chat.ts`).
  - Backup: `/opt/voxly/backups/20260724-103450/` (`voxly_control.dump`, `twenty.dump`).
  - Safe backfill john: cleared 14–16-digit LID `nameLastName` on 2 WA Persons; phone skip (Conversation has no E.164 for those LID peers).
- Verify: `getvoxly.ru/` **200**; `api.getvoxly.ru/health` **200** `{"status":"ok"}`; `app…/healthz` **200**; containers `saas-api` + `ai-whatsapp-worker` on new images.
- Broken / blockers: none for deploy. Phone still empty until inbound `remoteJidAlt`/`senderPn`.
- Next: user hard-refresh `john-crm` → media reply on WA opportunity; open chat → typing/read; deleted GramJS peer toast «Аккаунт удалён или недоступен».

### 2026-07-24 — GramJS peer-gone → «Аккаунт удалён» in CRM Chat (INC-040)
- Goal: john Person `c787d312-…` reply 400; surface deleted/unavailable clearly (not generic status 400).
- Changes:
  - Record: Conversation GramJS peer `8471608447` (Лариса); inbound spam flirt; `peer not found` / input entity.
  - `crm-chat.ts` `humanizeCrmChatSendError` (deleted/deactivated/peer-not-found → RU; privacy; WA exists:false).
  - `chat-panel` `replyErrorMessage`: prefer `body.error` over RestApiClient status message.
- Verify: service-token reply → **400** `Аккаунт удалён или недоступен`; deploy saas-api (backup `/opt/voxly/backups/20260724-103159/`) + no-cache tarball rebuild; john crm-chat reinstalled (front checksum `8f2d90ea…`); api/portal **200**.
- Broken / blockers: none for messaging map; peer still unreachable (expected). First deploy smoke saw transient api 404 while container started — recheck OK.
- Next: user hard-refresh `john-crm` Chat on that Person → toast «Аккаунт удалён или недоступен».

### 2026-07-24 — WA CRM media + typing/read + phone/LID name (INC-039)
- Goal: Fix john CRM media reply 400; typing/read presence; Person phone E.164; stop «Name LID» labels.
- Changes:
  - Root causes: saas-api blocked WA attachments; `lastName=platformUserId` (LID); phone only from LID peer id; no Evolution presence/media from CRM.
  - `ai-whatsapp-worker`: `sendMedia` / `sendPresence` / `markMessageAsRead`; extract E.164 from `remoteJidAlt`/`senderPn`; `cleanWaContactName`; sync without LID lastName; AI typing delay.
  - `crm-chat`: WA multipart → worker; `supportsAttachments` for WA; GET/reply fire typing+read; TG Business typing + `readBusinessMessage`.
  - `twenty-client`: richer `updatePersonPhone` (+RU calling code); `updatePersonName`.
  - Docs: FEATURES / ARCHITECTURE / INC-039.
- Verify (prod): deploy `saas-api,ai-whatsapp-worker`; media reply on opportunity `3ba69217-…` → **200**; open chat → Evolution presence; new inbound Person phone when alt present; names without 14–16 digit suffix.
- Broken / blockers: **deploy blocked in this session — SSHPASS not in env / prior transcript password rejected**. Code ready; run `export SSHPASS=…` then `./scripts/prod-deploy.sh saas-api,ai-whatsapp-worker`. WA file preview still unsupported; GramJS attachments still blocked; LID→phone backfill needs inbound alt (or manual).
- Next: user provides SSHPASS → deploy + hard-refresh `john-crm` checklist; optional one-shot name cleanup for existing Persons.

### 2026-07-24 — CRM Chat WA reply 400 for @lid peers (INC-038)
- Goal: Fix john CRM reply `…/s/crm-chat/1a0beec2-…/reply` status 400 without breaking GramJS/gift.
- Changes:
  - Root cause: peer `122372778684449` is WA LID; Evolution v2.2.3 `exists:false` on send; worker sent digits-only.
  - `ai-whatsapp-worker`: `formatWaSendRecipient` → `digits@lid`; inbound prefers `remoteJidAlt`; clearer Evolution errors; E.164 ≤13 digits.
  - `docker/evolution-api.Dockerfile`: patch all tsup dist chunks with PR #2544 `@lid` bypass; compose image `voxly-evolution-api:v2.2.3-lid`.
  - `prod-deploy.sh`: service `evolution-api` + `--profile whatsapp` on rebuild.
  - Prod: backup via deploy; `prod-deploy.sh ai-whatsapp-worker,evolution-api` then `--skip-backup evolution-api` (full chunk patch).
- Verify: Evolution send `@lid` **201**; worker send **200**; service-token CRM reply for opportunity `1a0beec2-…` **200**; getvoxly/api **200**.
- Broken / blockers: none for this record. Future: map LID→phone when `remoteJidAlt` appears.
- Next: user hard-refresh `john-crm` → reply from UI; optional Evolution upgrade past RC when stable.

### 2026-07-23 — WA inbound → CRM Chat + multi-thread switcher (INC-037)
- Goal: WhatsApp messages appear in CRM Person/Opportunity «Чат»; clear channel/identity; switch threads without breaking TG.
- Changes:
  - Root cause: webhook OK + ChatMessage saved, but `syncLeadToCrm` crashed worker on Twenty `createPerson(phone=WA lid)` → no `twentyPersonId`.
  - `packages/twenty-client` `createPerson`: retry nested without phones when phone validation fails.
  - `ai-whatsapp-worker`: skip non-E.164 phones; try/catch sync; do not overwrite `phoneNumberId` from inbound sender.
  - `crm-chat` API: `listCrmChatTargets` + `threads[]`; `?conversationId=` / body for reply; WA `identityLabel` = displayName/`+phone`.
  - `voxly-crm-chat` panel: thread chips when ≥2; pass conversationId on load/reply; header «Пишем от: …».
  - Prod: backup `/opt/voxly/backups/20260723-163144/`; deploy `saas-api,ai-whatsapp-worker` (skip-backup); backfill 2 john WA convs → Person+Opportunity; re-ensure crm-chat tarball on john.
- Verify: GET chat for WA persons → WhatsApp · ремонт тоя + msgs; GramJS person still Telegram · личный; worker Restarts=0; getvoxly/api **200**.
- Broken / blockers: WA peer ids may be `@lid` (not E.164) — reply uses stored id via Evolution; multi-thread UI needs hard-refresh CRM.
- Next: user hard-refresh `john-crm` → open new WA Persons → reply smoke; optional real-phone mapping from Evolution `remoteJidAlt`.

### 2026-07-23 — WA displayName + delete junk stubs (prod)
- Goal: Connected WA shows human label («ремонт тоя»), not Evolution hash slug; removable junk from failed QR.
- Changes:
  - Schema: `BotInstance.displayName` (+ migration `20260723192000_bot_instance_display_name`); prod `ADD COLUMN IF NOT EXISTS`.
  - Worker: persist raw `name` as `displayName`, ascii slug in `botUsername`; `POST /internal/accounts/delete` (Evolution logout/delete + BotInstance remove).
  - API: accounts return `name`/`displayName`/`slug`; `DELETE /accounts/:botId`; prune underscore-only never-connected stubs on list.
  - Portal `/dashboard/ai/whatsapp`: show label + muted slug; delete button; Cyrillic placeholder.
  - Prod data (john): deleted inactive `__________` + `repair-toya`; set `n1oufrdm.displayName=ремонт тоя` (phone kept).
  - Deploy: `prod-deploy.sh saas-api,saas-portal,ai-whatsapp-worker`; backup `/opt/voxly/backups/20260723-161414/`.
- Verify: only one `ai_wa` row (active, displayName set); getvoxly/api health **200**.
- Broken / blockers: none.
- Next: user hard-refresh WhatsApp page; E2E inbound; hard Robokassa.

### 2026-07-23 — Prod: WhatsApp QR stuck «Подготовка…» (INC-035)
- Goal: Make Evolution QR appear on `/dashboard/ai/whatsapp` after «Показать QR».
- Changes:
  - Root cause: stale Baileys `CONFIG_SESSION_PHONE_VERSION` → `qrcode:{count:0}` (no base64). Cyrillic names → `__________` instance slug.
  - Compose + `.env.example`: `CONFIG_SESSION_PHONE_VERSION` default `2.3000.1043705293`; prod `.env` appended; `evolution-api` force-recreate (no volumes wiped).
  - `ai-whatsapp-worker`: hash-based `sanitizeName` for non-ascii; `waitForQr` retries; preparing hint.
  - Portal: poll sanitized `name` from start; show preparing hint.
  - Deploy: `prod-deploy.sh ai-whatsapp-worker,saas-portal,compose`; backup `/opt/voxly/backups/20260723-160032/`.
- Verify: Evolution create `hasB64` + ~13k; worker Cyrillic start → `qr_ready`; getvoxly/api health **200**.
- Broken / blockers: user must re-click «Показать QR» (old underscore instances deleted).
- Next: E2E phone scan → inbound CRM; hard Robokassa `ai_wa`.

### 2026-07-23 — Prod: apply ADR-014 (+ audience) control migrations (INC-034)
- Goal: Fix WhatsApp connect 500 — `BotInstance.defaultAiAgentId` missing on prod control Postgres.
- Changes:
  - Backup: `/opt/voxly/backups/20260723-184557/voxly_control.dump` (pg_dump -Fc).
  - Idempotent SQL on prod control DB: `TelegramPeer`/`TelegramSighting`; `AiAgent`; `BotInstance.defaultAiAgentId`; `Conversation.aiAgentId` (+ FKs/indexes).
  - Baselined `_prisma_migrations` via `prisma migrate resolve --applied` for four migrations (handoff/CRM already present from earlier `db push`; no `_prisma_migrations` before).
  - No volume wipe; no code change.
- Verify: `\d BotInstance` has `defaultAiAgentId`; Prisma `botInstance.findFirst({ select: { defaultAiAgentId } })` OK; `GET /api/bots/whatsapp/accounts` → **401** (not 500); `/health` **200**.
- Broken / blockers: none for schema; user still needs JWT for full WA connect E2E.
- Next: Prefer `prisma migrate deploy` on every schema deploy; avoid prod `db push` without migration history.

### 2026-07-23 — WhatsApp connect via Evolution (Phase 2)
- Goal: Unlock WA account connect + inbound CRM chat + CRM reply for E2E beside GramJS (ADR-014).
- Changes:
  - **Stack choice (ONE):** Evolution API (Baileys QR). Meta Cloud API draft in `ai-whatsapp-worker` retired.
  - `apps/ai-whatsapp-worker` — Evolution create/QR/status/send; webhook inbound → Conversation/ChatMessage; CRM lead sync; AI only if AiAgent assigned; encrypted session JSON on `BotInstance` (`botType: ai_wa`).
  - `apps/saas-api` — `/api/bots/whatsapp/*` (accounts, soft trial, QR); CRM chat reply via worker for `ai_wa`; `waPriceMonthly` / `waAddon` on bots list.
  - `apps/saas-portal` — `/dashboard/ai/whatsapp`; dashboard WA card; agents assign includes `ai_wa`.
  - Compose: `evolution-api` image `evoapicloud/evolution-api:v2.2.3` (profile `whatsapp`), worker env `EVOLUTION_*`; `.env.example`; `prod-deploy.sh` service `ai-whatsapp-worker` + password-only SSH when `SSHPASS` set.
  - Pricing: `PRICING.AI_WHATSAPP_MONTHLY` → **500** (TZ).
- Verify: typecheck worker + saas-api; prod deploy `saas-api,saas-portal,ai-whatsapp-worker,compose`; backup `/opt/voxly/backups/20260723-152807/`; Evolution Up; worker health `evolutionConfigured:true`; portal/API smoke **200**.
- Broken / blockers: none for start-connect UI; QR needs phone scan on device.
- Next: E2E scan QR → inbound CRM chat → operator reply; hard Robokassa `ai_wa`.

### 2026-07-23 — Dashboard: three separate AI/channel cards (prod)
- Goal: Remove merged «Автоматизация чатов» card that mixed Business + QR GramJS; ship three surfaces on prod.
- Changes:
  - `apps/saas-portal/src/app/dashboard/page.tsx` — cards: «Автоматизация чатов» → `/dashboard/ai`; «Подключение аккаунтов» (TG + WA скоро) → `/dashboard/ai/gramjs`; «AI-агенты» (wallet/top-up) → `/dashboard/ai/agents`.
  - CAPABILITIES dashboard row copy.
  - Prod: `./scripts/prod-deploy.sh saas-portal`; backup `/opt/voxly/backups/20260723-151230/`.
- Verify: live chunk has three titles; no «QR GramJS» under Business; portal/API smoke **200**.
- Broken / blockers: AI top-up button still stub; WhatsApp stub.
- Next: hard Robokassa SKUs; WA Phase 2.

### 2026-07-23 — Product model: channels ≠ AI agents; default AI OFF (ADR-014)
- Goal: Lock product model — GramJS/WA/Business/gift as separate channels; AI agents orthogonal; AI OFF until explicit assign; split portal cards.
- Changes:
  - `docs/agent/DECISIONS.md` ADR-014; `docs/specs/AI-AGENTS-TZ.md` → v0.4; CAPABILITIES/DATA/steps.
  - Schema: `AiAgent` + `BotInstance.defaultAiAgentId` + `Conversation.aiAgentId` (migration `20260723180000_ai_agent_assignment`). Soft: existing rows stay agent-null (AI off).
  - `ai-telegram-worker` / `gramjs-bridge`: `shouldAiReply` requires assigned active agent; agent prompt; auto-pause only if agent assigned.
  - API: `/api/ai/agents` CRUD + assign bot; conversation PATCH `aiAgentId`.
  - Portal: dashboard split (Business / Аккаунты / AI-агенты); `/dashboard/ai` Business-only; `/dashboard/ai/agents`; bot detail agent picker. GramJS path unchanged `/dashboard/ai/gramjs`.
- Verify: prisma generate; typecheck db/saas-api/ai-telegram-worker/saas-portal; conceptual — inbound without agent stores messages, no LLM.
- Broken / blockers: WA agent UI; hard Robokassa rename/billing copy; FAQ on agent; prod migrate not deployed this session.
- Next: migrate local+prod control DB; smoke assign agent → reply; WA Phase 2 assign surface.

### 2026-07-23 — Fix CRM Chat reply 404 for GramJS/AI (INC-032)
- Goal: CRM «Чат» reply works for GramJS (and Business AI) leads on tenant CRM hosts; diagnose wrong-URL vs missing link.
- Changes:
  - `apps/saas-api/src/routes/crm-chat.ts` — resolve chat via GiftSubscriber **or** Conversation CRM ids; Bot API + `business_connection_id` for `ai_tg`; GramJS via bridge.
  - `apps/gramjs-bridge/src/index.ts` — `POST /messages/send` (service token); `rememberAiSent` to avoid double ChatMessage.
  - INC-032 + CAPABILITIES note.
  - Prod: `./scripts/prod-deploy.sh saas-api,gramjs-bridge`; backup `/opt/voxly/backups/20260723-132306/`; smoke portal/API **200**.
- Verify: curl `john-crm…/s/crm-chat/<id>` → auth missing (route+workspace OK); DB: Conversation linked to Person, GiftSubscriber=0; deployed markers `findCrmChatTarget` + `/messages/send`.
- Broken / blockers: GramJS CRM attach/preview still unsupported (text-only).
- Next: user smoke on john-crm Person «Чат» reply.

### 2026-07-23 — GramJS bridge started on prod
- Goal: Start `gramjs-bridge` on VPS (`--profile gramjs` / named service) so portal QR UI works via saas-api proxy.
- Changes:
  - Prod `/opt/voxly/.env`: corrected `GRAMJS_BRIDGE_URL` `…:3010` → `http://gramjs-bridge:3008` (backup `.env.bak.gramjs.*`). Confirmed present: `TELEGRAM_API_ID/HASH`, `VOXLY_SERVICE_TOKEN`, `ENCRYPTION_KEY` (values redacted). Did **not** overwrite whole `.env`.
  - `./scripts/prod-deploy.sh gramjs-bridge` — backup `/opt/voxly/backups/20260723-130943/`; rsync `apps/gramjs-bridge/` + manifests/packages; build+start `docker-gramjs-bridge-1` (compose named service enables profile). No `down -v`, no override.yml.
  - Recreated `saas-api` (`--no-deps --force-recreate`) so it reads `GRAMJS_BRIDGE_URL=http://gramjs-bridge:3008`.
- Verify:
  - Bridge: listening `:3008`; `GET /health` → `ok` (in-container + from saas-api).
  - saas-api env `GRAMJS_BRIDGE_URL` correct; public `https://api.getvoxly.ru/health` **200**; portal `https://getvoxly.ru/` **200**.
  - QR UI: `https://getvoxly.ru/dashboard/ai/gramjs` (auth required; browser never hits bridge).
- Broken / blockers: none for start. Hard Robokassa `ai_gramjs` still soft-gate only.
- Next: smoke QR login on a test tenant; hard SKU later.

### 2026-07-23 — OpenRouter API key wired (local + prod)
- Goal: Set `OPENROUTER_API_KEY` so `ai-telegram-worker` can use OpenRouter (chat/ASR/vision).
- Changes:
  - Local gitignored `.env`: append/update `OPENROUTER_API_KEY` (value redacted). `.env.example`: empty placeholder `OPENROUTER_API_KEY=` only.
  - Prod `/opt/voxly/.env`: **append/update that key only** (backup `.env.bak.openrouter.*`); did not overwrite whole file.
  - Recreated `ai-telegram-worker` only via `docker-compose.yml` + `docker-compose.prod-npm.yml` `--force-recreate --no-deps`. Did **not** start gramjs. Did **not** restart `saas-api` (does not read OpenRouter). No volume wipe.
- Verify:
  - Prod container env: key present, length 73, prefix `sk-or-v1` (value not logged).
  - Worker logs: Listening on port 3005 (no “AI replies disabled”).
  - Smoke: `https://api.getvoxly.ru/health` **200**; internal Host→`:8880/health` **200**.
- Broken / blockers: none for this key. GramJS still not started (intentional).
- Next: optional GramJS profile when ready; exercise AI reply/ASR path on a test bot.

### 2026-07-23 — Business AI prod deploy (SSH unblocked)
- Goal: Unblock SSH to `150.241.98.135`, ship Business AI services, append missing prod env keys, apply Conversation migrations, smoke HTTPS.
- Changes:
  - SSH: no local `~/.ssh` private key; used session `SSHPASS` + `sshpass` (prefer password-only opts to avoid MaxAuthTries). Password never committed.
  - `./scripts/prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,gift-bot-worker,manager-bot-service,compose`
  - Backup: `/opt/voxly/backups/20260723-122938/` (`voxly_control.dump`, `twenty.dump`); env bak under same dir before append.
  - Prod `/opt/voxly/.env` **append only**: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `GRAMJS_BRIDGE_URL=http://gramjs-bridge:3010`. Kept existing `VOXLY_SERVICE_TOKEN` / `OPENAI_API_KEY`. Did **not** overwrite whole file. Did **not** start `--profile gramjs`.
  - Control DB: idempotent `ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS` for AI handoff + CRM leads columns/indexes (no `_prisma_migrations` table on prod; no volume wipe).
- Verify:
  - Containers recreated/up: `saas-api`, `saas-portal`, `ai-telegram-worker`, `gift-bot-worker`, `manager-bot-service`.
  - Smoke: `https://getvoxly.ru/` **200**, `https://api.getvoxly.ru/health` **200** (script first smoke got portal 404 while Next still starting; recheck OK).
  - Hot-file `prod-diff` for shipped services largely OK (occasional SSH flake mid-diff).
- Broken / blockers:
  - `OPENROUTER_API_KEY` still **missing** on prod (and local); compose warns blank — Whisper/vision via OpenRouter soft-degraded until set.
  - GramJS bridge **not** started on prod (intentional); restart saas-api after profile up if/when enabling.
  - Root SSH still password-only — rotate to key + change password (known urgent).
- Next: optional `docker compose --profile gramjs up -d gramjs-bridge` after confirming Telegram API keys; local QR smoke; set `OPENROUTER_API_KEY` if ASR/vision needed; hard Robokassa SKUs.

### 2026-07-23 — Portal GramJS QR + soft gaps; Business AI deploy blocked on SSH
- Goal: Wire local GramJS secrets; portal QR UI via saas-api proxy; soft SKU + human 1h pause; ship Business AI to prod.
- Changes:
  - Local gitignored `.env` only: `VOXLY_SERVICE_TOKEN`, `TELEGRAM_API_ID/HASH`, `TELEGRAM_PHONE`, `GRAMJS_BRIDGE_URL` (values not logged).
  - `apps/gramjs-bridge` — human outbound → `pausedUntil` +1h (ignore AI-sent ids); soft addon returns `billingWarning`.
  - `apps/saas-api` — NEW `routes/gramjs.ts` proxy `/api/bots/gramjs/*` (JWT → bridge Bearer); list accounts + soft trial; bots list exposes `gramjsAddon`.
  - `apps/saas-portal` — `/dashboard/ai/gramjs` QR start/poll/png/2FA; section on `/dashboard/ai` + dashboard link.
  - `docker/docker-compose.yml` — `GRAMJS_BRIDGE_URL` on saas-api; `TELEGRAM_PHONE` on gramjs-bridge.
  - `scripts/prod-deploy.sh` / `prod-diff.sh` — services `ai-telegram-worker`, `gramjs-bridge`.
  - `.env.example` — empty placeholders only (no secrets).
- Verify: typecheck `@voxly/saas-api` + `@voxly/gramjs-bridge` OK; `./scripts/prod-deploy.sh --dry-run saas-api,saas-portal,ai-telegram-worker,gift-bot-worker,manager-bot-service,compose` OK.
- Broken / blockers:
  - **Live prod deploy failed:** SSH `root@150.241.98.135` → `Permission denied (publickey,password)`. Need working key or `SSHPASS` (never commit). No backup taken; no rsync; no rebuild.
  - Prod `.env` append of GramJS keys **not done** (same SSH blocker). Do not force `--profile gramjs` until keys exist on server.
  - Hard Robokassa `ai_gramjs` / paid `ai_tg` still soft-gate only.
- Next: Fix SSH → re-run same `prod-deploy.sh` command; append missing prod env keys only; apply Conversation migrations on prod control DB if missing; optional `docker compose --profile gramjs up -d gramjs-bridge` after secrets; local smoke QR on Colima.

### 2026-07-23 — AI Agents media (Whisper/vision) + gramjs-bridge scaffold
- Goal: Replace ASR/vision stubs in `ai-telegram-worker`; add `apps/gramjs-bridge` (QR session → AI worker).
- Changes:
  - `apps/ai-telegram-worker` — Telegram file download → OpenRouter `/audio/transcriptions` (`openai/whisper-1`) + multimodal chat vision; store transcript/description in ChatMessage; graceful placeholders; `POST /internal/inbound` (Bearer `VOXLY_SERVICE_TOKEN`) returns bubbles for GramJS; shared `generateAiBubbles`
  - `apps/gramjs-bridge` — NEW: QR start/status/png/password; encrypted `StringSession` on `BotInstance` (`ai_gramjs`); inbound text → worker; compose profile `gramjs` :3008
  - `packages/shared` — `PRODUCT_CODES.AI_GRAMJS`, `PRICING.AI_GRAMJS_MONTHLY=500`, channel `telegram_gramjs`
  - `docker/docker-compose.yml` (+ override port), `.env.example` — `TELEGRAM_API_ID/HASH`, worker `VOXLY_SERVICE_TOKEN`
- Verify: `pnpm --filter @voxly/shared test` (33); typecheck `@voxly/ai-telegram-worker` + `@voxly/gramjs-bridge` OK. Live ASR/vision needs `OPENROUTER_API_KEY` + voice/photo inbound.
- Broken / blockers: GramJS portal UI + hard Robokassa SKU not built (soft addon warn); GramJS media/human-pause not wired; FAQ/embeddings still open; user must apply CRM leads migration if not yet.
- Next: E2E Business voice/photo; set platform api_id/hash and smoke QR; portal GramJS connect UI.

### 2026-07-23 — AI Agents portal UI + CRM leads + billing SKU
- Goal: Finish Phase 1 portal («Автоматизация чатов»), CRM Person+Opportunity on AI inbound with dedupe/`needsReview`, enforce AI Business addon + ≤10 connections.
- Changes:
  - `apps/saas-portal` — `/dashboard/ai`, `/dashboard/ai/[botId]`; dashboard card → AI product
  - `apps/saas-api` — `POST /bots/ai/start-trial`; provision `ai_tg` requires addon; `GET .../conversations` (+ messages); PATCH `needsReview`; list returns `aiAddon` / connection counts
  - `packages/db` — Conversation `twentyPersonId`, `twentyOpportunityId`, `needsReview` + migration `20260723150000_conversation_crm_leads`
  - `packages/shared` — `PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS = 10`
  - `apps/ai-telegram-worker` — `syncLeadToCrm` via `@voxly/twenty-client`; Business connection cap
- Verify: `pnpm --filter @voxly/shared build`; typecheck `@voxly/saas-api` + `@voxly/ai-telegram-worker` OK. Apply migration locally before E2E.
- Broken / blockers: portal `tsc` env noisy (pre-existing react resolution); media ASR/vision + GramJS + FAQ UI still open; Robokassa paid addon checkout for `ai_tg` not wired (trial works).
- Next: E2E provision → Business connect → inbound lead in Twenty; media stubs; GramJS only after smoke.

### 2026-07-23 — AI Agents Phase 1 foundation (TG Business + OpenRouter)
- Goal: Start Phase 1 — schema handoff fields, adapt `ai-telegram-worker` for Business + OpenRouter + human-like send; wire gift→AI webhook forward + manager `allowed_updates`.
- Changes:
  - `packages/db/prisma/schema.prisma` — Conversation: `pausedUntil`, `aiDisabled`, `channel`, `businessConnectionId` + indexes
  - `packages/db/prisma/migrations/20260723144500_conversation_ai_handoff/` — SQL migration
  - `packages/db/prisma/seed.ts` — OpenRouter model defaults (gemini-2.5-flash, embeddings, ASR)
  - `packages/shared` — `CONVERSATION_MODES` ai|human|bot, `isAiConversationMode`, `AI_HANDOFF_PAUSE_MS`, `AI_MODEL_DEFAULTS`
  - `apps/ai-telegram-worker` — `botType: ai_tg`, OpenRouter client, Business updates, pause/disable, multi-bubble + typing, media stubs
  - `apps/gift-bot-worker` — forward `/tg/...` when `botType === 'ai_tg'`
  - `apps/manager-bot-service` — Business `allowed_updates` for `ai_tg`
  - `apps/saas-api` — provision default name «Voxly AI»; PATCH `/:botId/conversations/:conversationId`; CRM/portal reply → `pausedUntil` 1h
  - `docker/docker-compose.yml` + `.env.example` — `OPENROUTER_API_KEY`, model envs, `AI_TELEGRAM_WORKER_URL`
- Verify:
  - `pnpm --filter @voxly/db prisma:generate` ✓
  - typecheck: shared (build), ai-telegram-worker, gift-bot-worker, saas-api, manager-bot-service ✓
  - Apply schema: `pnpm db:push` (local) or `pnpm db:migrate` / apply migration SQL on prod control DB
- Broken / blockers: none for foundation. Media ASR/vision still stubs; no portal AI UI; no CRM leads for AI; no GramJS; billing SKU soft-skip for `ai_tg`.
- Next: portal Business onboarding + prompt/FAQ; CRM Person+Opportunity on AI inbound; whisper/vision; gramjs-bridge; billing SKU 1000/10.

### 2026-07-23 — AI agents TZ v0.2 (reuse-first)
- Goal: Draft product TZ for TG Business + GramJS + WA AI without greenfield where Voxly already has code.
- Changes: `docs/specs/AI-AGENTS-TZ.md` v0.2 — FR-0 reuse-first; adapt `ai-telegram-worker` / `ai-whatsapp-worker`; new GramJS bridge only; n8n human-imitation ported into workers; managed bot; media MVP; billing 1000/10 + 500/account; handoff ON-by-default + manual + auto-pause 1h.
- Verify: doc review with stakeholder (open items listed in TZ).
- Next: close remaining open items → sprint breakdown; no code until TZ approved.

### 2026-07-23 — AI Agents TZ v0.3 (defaults + Phase 1 backlog)
- Goal: close remaining open items without blocking; keep reuse-first.
- Changes: `docs/specs/AI-AGENTS-TZ.md` → v0.3 (Opportunity+Person, dedupe needs_review, follow-up=1.1, retention 12m, gpt-4o-mini, manual pause=1h; implementation queue).
- Verify: no blocking open items in TZ.
- Next: user says go → start Phase 1 task 1 (schema + adapt ai-telegram-worker).

### 2026-07-22 — Safe prod deploy scripts
- Goal: local feature work must not break prod via ad-hoc rsync (landing overwrite risk).
- Changes: `scripts/prod-deploy.sh` (whitelist rsync + DB backup + compose rebuild + smoke), `scripts/prod-diff.sh`, `docs/agent/DEPLOY.md`, `docs/agent/ENVIRONMENTS.md`, ADR-013; tightened `.cursor/rules/prod-deploy-updates.mdc`; linked from README/STACK/NPM-EDGE.
- Verify:
  - dry-run `saas-portal|saas-api|twenty|compose` exit 0; all listed paths exist locally.
  - live `./scripts/prod-diff.sh all-apps` (2026-07-22): portal/compose/twenty patches OK; **DRIFT** `queues.ts`, `twenty-client/index.ts`, `chat-panel.tsx` (local ahead).
- Broken / blockers: none for process. Code not 100% equal — ship drift via `prod-deploy.sh saas-api` when ready.
- Next: continue local features; always `prod-diff` before deploy; rotate SSH to key auth.

### 2026-07-22 — Landing solid buttons white text (prod)
- Goal: Black CTA buttons on getvoxly.ru showed black (invisible) label text.
- Changes: `apps/saas-portal/src/app/globals.css` — move `a`/`button`/body into `@layer base` so Tailwind `text-primary-foreground` wins over `a { color: inherit }`. Prod: rsync CSS → `/opt/voxly`, `docker-compose … up -d --build saas-portal` (no `-v`).
- Verify: `https://getvoxly.ru/` 200; CSS has `@layer base` + `a{color:inherit}`; browser shows white «Начать» / «Начать бесплатно».
- Broken / blockers: none for this fix. SSH still password-only (rotate root).
- Next: optional commit of globals.css; install SSH key on VPS.

### 2026-07-22 — Fix new-tenant CRM SSO customDomain without Cloudflare (INC-031)
- Goal: Open CRM for antontest3 (and future tenants) on `{slug}-crm.getvoxly.ru`, not `app.app…`.
- Changes: `ensureTwentyCustomDomain` SQL via `TWENTY_DATABASE_URL`; provisioning always sets customDomain; chat install tolerates registry duplicate; antontest3 SQL + chat install.
- Verify: antontest3 customUrl present; verify SSO 200; chat app id on antontest3.
- Next: user retries Open CRM for antontest3.

### 2026-07-22 — Auto-install voxly-crm-chat on provision (ADR-011)
- Goal: new registrations get CRM «Чат» without manual `yarn twenty apply`.
- Changes:
  - `@voxly/twenty-client` — `uploadAppTarball` + fixed `installApplication` + `ensureCrmChatAppInstalled` (sets WORKSPACE_ORIGIN / VOXLY_API_URL).
  - `apps/saas-api` provisioning job reads `VOXLY_CRM_CHAT_TARBALL` and installs after workspace create.
  - `apps/saas-api/Dockerfile` multi-stage: `yarn twenty dev:build --tarball` → bake `/voxly/assets/voxly-crm-chat.tgz`.
  - compose: `VOXLY_CRM_CHAT_TARBALL`, `VOXLY_CHAT_API_URL`; local override mounts host tarball.
- Verify: local `ensureCrmChatAppInstalled` on test2 → OK (app id returned).
- Next: rebuild/redeploy saas-api on prod; smoke-register a new user.

### 2026-07-22 — Fix CRM chat `/s/crm-chat` 404 on custom domain (INC-030)
- Goal: «Чат» calls `{slug}-crm`/s/… instead of app.getvoxly.ru (WORKSPACE_NOT_FOUND).
- Changes: `docker/patch-twenty-functions-url.cjs` v2 (`location.origin+"/s"`); `chat-panel.tsx` rewrite SERVER_URL→WORKSPACE_ORIGIN for `/s/*`; prod rebuild twenty + re-apply front checksum `c67c347c…`; restore app vars.
- Verify: custom host `/s/crm-chat/<id>` → auth missing (workspace ok); app host → WORKSPACE_NOT_FOUND; functions patch marker present.
- Next: user hard-refresh CRM Chat tab.

### 2026-07-22 — Fix CRM chat FrontComponent 404 on custom domain (INC-029)
- Goal: «Чат» tab loads on antontest-crm (not Failed to fetch app.getvoxly.ru/rest/front-components).
- Changes: `docker/patch-twenty-front-component-url.cjs` + `twenty.Dockerfile`; prod rebuild twenty-server/worker.
- Verify: marker in FrontComponentRenderer; CRM 200; VOXLY_SERVICE_TOKEN still set.
- Next: user hard-refresh CRM → open Person/Opportunity «Чат».

### 2026-07-22 — Fix gift-bot missing from portal (INC-027)
- Goal: `@voxly_antontest_01_bot` appears in dashboard bots list.
- Changes: `manager-bot-service` webhook path `/bots/manager/webhook` + username provision match + telegram auto-link; compose Traefik `/tg` → gift-bot-worker; prod recreate manager+gift.
- Verify: webhook POST 200; `BotInstance` `@voxly_antontest_01_bot` active; child webhook set on `/tg/...`.
- Broken / blockers: none for list; user should refresh `/dashboard/bots`.
- Next: attach channel in bot settings; rotate secrets.

### 2026-07-22 — Prod antontest chat + provisioning defaults
- Goal: make «Чат» work on prod antontest; bake skip-install-apps + RU labels into provision path.
- Changes:
  - `docker/docker-compose.yml` — `VOXLY_SERVICE_TOKEN` + `VOXLY_API_URL` on twenty-server/worker (LOCAL logic functions).
  - Prod recreate twenty-server/worker + rebuild saas-api (no volume wipe).
  - antontest: cabinet link → `https://getvoxly.ru/dashboard`; app vars `WORKSPACE_ORIGIN`/`VOXLY_API_URL`; RU object labels + «Чат» tabs (prior apply); skip `/install-apps` mutation.
  - `packages/twenty-client` — `skipInstallAppsOnboarding`, RU labels with `isLabelSyncedWithName:false`, `installApplication` (marketplace; still fails until published).
  - `apps/saas-api/src/jobs/queues.ts` — try install `voxly-crm-chat`.
  - `twenty-app/.../cabinet-voxly.ts` — default cabinet URL prod.
- Verify: twenty token len 65 matches saas-api; CRM `https://antontest-crm.getvoxly.ru` 200; api health 200.
- Broken / blockers: auto-install chat still needs marketplace publish or CLI `yarn twenty apply` per workspace (ADR-011). Rotate root SSH / SUPERADMIN / reg.ru API.
- Next: user hard-refresh CRM → «Чат» on Person/Opportunity; seats=CRM members; package syncApplication for multi-tenant chat install.

### 2026-07-22 — Fix prod CRM open (INC-025)
- Goal: `Open CRM` for new tenants on getvoxly.ru.
- Changes: `packages/twenty-client` (email normalize, activateWorkspace, customDomain); `apps/saas-api` tenant/auth/queues; prod saas-api rebuild; antontest workspace ACTIVE + customDomain.
- Verify: `createWorkspaceLoginUrl` → `https://antontest-crm.getvoxly.ru/verify?loginToken=…`; api `/health` 200.
- Broken / blockers: rotate root SSH / SUPERADMIN / reg.ru API passwords still pending.
- Next: user retests dashboard → Open CRM; commit when asked.

### 2026-07-22 — Wildcard HTTPS `*.getvoxly.ru` (DNS-01 reg.ru)
- Goal: Public HTTPS for tenant portal/CRM subdomains behind NPM.
- Changes:
  - certbot DNS-01 on VPS with `/root/letsencrypt-regru/` → LE `*.getvoxly.ru` (`getvoxly.ru-wildcard`).
  - NPM cert **npm-9** + proxy host **6** SSL/Force SSL; deploy renew hook → npm-9.
  - Docs: `docs/NPM-EDGE.md`, `steps.md` §3–5.
- Verify: `https://demo.getvoxly.ru/` / `demo-crm…/healthz` / `test2.getvoxly.ru/` / apex/api/app → **200**; SNI CN=`*.getvoxly.ru`.
- Broken / blockers: Rotate root SSH + `SUPERADMIN_PASSWORD` + weak reg.ru API password (shared in chat).
- Next: security rotations; commit/push `docker-compose.prod-npm.yml` when asked.

### 2026-07-22 — NPM Proxy Hosts for getvoxly.ru → Traefik
- Goal: Public HTTPS for getvoxly.ru via existing NPM → Traefik on automation net; no Traefik restart; leave n8n/Baserow/NocoDB volumes alone.
- Changes:
  - NPM proxy host **id 5**: domains `getvoxly.ru`/`www`/`api`/`app` → `docker-traefik-1:80`, websockets, Force SSL, HTTP/2; LE cert **id 8** (HTTP-01).
  - SQLite backup `/opt/automation/npm_data/database.sqlite.bak.*`; temp NPM admin password reset for API then **restored**.
  - Docs: `docs/NPM-EDGE.md`, `docs/agent/STACK.md`, compose comments in `docker/docker-compose.prod-npm.yml`; server copy `/opt/voxly/docs/NPM-EDGE.md`.
- Verify (local curl): `https://getvoxly.ru/` / `www` / `api…/health` / `app…/healthz` → **200**, `ssl_verify=0`. HTTP→HTTPS 301.
- Broken / blockers: **`*.getvoxly.ru` wildcard LE failed** (needs DNS-01). Tenant `{slug}` / `{slug}-crm` HTTPS not live. Rotate root SSH password; change `SUPERADMIN_PASSWORD` in `/opt/voxly/.env`.
- Next: Add DNS provider token in NPM for wildcard; commit/push overlay when ready.

### 2026-07-22 — Prod deploy on VPS beside NPM (getvoxly.ru)
- Goal: Bring Voxly up on `150.241.98.135` (ai-agents-server-n8n.com) with Nginx Proxy Manager as TLS edge; do not bind Traefik to :80/:443; leave n8n/Baserow/NocoDB/NPM volumes untouched.
- Changes:
  - Added `docker/docker-compose.prod-npm.yml` (Traefik HTTP `:8880`, dashboard `127.0.0.1:8088`, entrypoints=`web`, portal LB port **3000**, DB/Redis `127.0.0.1` only, join `automation_automation_net`, Traefik **v3.6.6** for Docker 29 API, HostRegexp Go syntax, `Host(a)||Host(b)`).
  - Server: `/opt/voxly` (rsync from local; GitHub HTTPS clone needs auth), `.env` mode 600 with fresh secrets; control schema via `prisma db push` + seed.
  - Compose: `docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env` (override renamed to `.local-only`).
- Verify (Host header → `http://127.0.0.1:8880`): getvoxly.ru/www/demo → 200; api `/health` → 200; app + `*-crm` `/healthz` → 200. Automation stack still Up.
- Broken / blockers (at deploy time; **resolved later same day**): NPM hosts were pending — now live as host id 5 (see entry above). Rotate root SSH password (was shared in chat). Commit/push `docker-compose.prod-npm.yml` still local-only.
- Next: Wildcard DNS-01; change SUPERADMIN_PASSWORD; optional Robokassa/SMTP.

### 2026-07-22 — INC-024 bot funnel photos in CRM chat + phone sync finish
- Goal: bot `/start` photo visible in CRM «Чат»; finish interrupted phone→Person sync; document P1/P2 status.
- Changes: `gift-bot-worker` `logBotOutbound` + `attachmentFromSendResult` on sendPhoto/Video/Document; `syncPhoneToCrmPerson` + `TwentyClient.updatePersonPhone`; test2 SQL backfill start `attachments` from funnel `telegramFileId`; INC-024; ADR-011 remains TODO for seats/chat-install/defaults.
- Verify: DB assistant «После /start» now has `attachments[].fileId`; `getFile` OK for that id; rebuild `gift-bot-worker`. Hard-refresh CRM «Чат». New `/start` also stores attachments.
- Broken / blockers: Colima was down at session start (restarted). P1 not implemented (ADR-011).
- Next: ADR-011 seats=CRM members; install `voxly-crm-chat` on gift activate; auto SQL triggers for new workspaces.

### 2026-07-21 — Product intent: seats/chat/defaults + phone→CRM
- Goal: capture ADR-011 (seats=CRM members; chat app on gift activate; new WS = test2 defaults). Answer TG field limits; sync shared contact phone → Person.phones.
- Changes: `DECISIONS` ADR-011; `updatePersonPhone` + `syncPhoneToCrmPerson`; createPerson can set phone from GiftSubscriber; CAPABILITIES/steps next.
- Verify: funnel «поделиться контактом» → Person Phones filled; email/ДР still N/A via Bot API.
- Next: implement ADR-011 items 1–3.

### 2026-07-21 — INC-023 chat multiline was sent but UI hid line 2
- Goal: user still saw only first line after INC-022.
- Changes: DB confirmed full content (`~~…~~\n||…||`); fix `formatContent` → per-line `<div>` + visible spoiler. Apply `05c28f90…`.
- Verify: hard-refresh «Чат» → old multiline messages show both lines; spoiler readable.
- Next: user confirm in CRM + Telegram.

### 2026-07-21 — INC-022 chat Enter sent first line only
- Goal: multiline reply (strike line1 + line2) must send full text.
- Changes: `chat-panel.tsx` — Enter=newline, Cmd/Ctrl+Enter=send; DOM `readComposerText`; line-local format fallback. Applied test2 front `5ca88013…`. INC-022.
- Verify: hard-refresh «Чат» → two lines + format → full message in Telegram.
- Next: user verify.

### 2026-07-21 — Kanban note chip title≠body (first line only)
- Goal: chip showed short title («ПОЗДНЯЯ заметка») while body had full text.
- Changes: trigger `BEFORE INSERT OR UPDATE` (any col) forces title←bodyV2Markdown; backfill; SQL file updated.
- Verify: sample note title now = «ПОЗДНЯЯ заметка — должна быть текст».
- Next: user hard-refresh Сделки.

### 2026-07-21 — Note chip showed only «П» (avatar)
- Goal: full latest note body on kanban, not avatar initial.
- Changes: shell-ux CSS — do not `-webkit-box` the chip (broke flex → only «П»); clamp text node only; STYLE_ID v2; noteTargets size 100→280 (SQL + twenty-client).
- Verify: user hard-refresh → chip shows «ПОЗДНЯЯ заметка…» multiline.
- Next: user confirm.

### 2026-07-21 — INC-021 Redis stale label (still `[object Object]`)
- Goal: chips still showed `[object Object]` after SQL title sync — fix live display + latest-only.
- Changes:
  - Flushed Redis `object-metadata` / `ObjectMetadataItems` for test1+test2 (cache had bodyV2 id while PG had title).
  - Restarted twenty-server; verified cache label id = title `94a308d4…`.
  - `docker/twenty-shell-ux.js` — hide 2nd+ note chips on board; SQL comment about Redis flush.
  - INC-021 updated.
- Verify: Redis MATCH title; Twenty http 200; shell-ux served with `note-extra` hide.
- Broken / blockers: user must hard-refresh (Cmd+Shift+R) — browser may keep old Apollo metadata.
- Next: user verify chip = «ПОЗДНЯЯ заметка…» (one chip).

### 2026-07-21 — Kanban note chip `[object Object]` (INC-021)
- Goal: show latest note **body** text on Opportunity kanban chips (not title, not `[object Object]`).
- Changes:
  - `docker/set-opportunity-kanban-card-defaults.sql` — labelIdentifier=`title`; backfill title←bodyV2Markdown; triggers sync title + latest-first noteTarget.position.
  - `packages/twenty-client` — `ensureNoteTitleAsLabel` (was bodyV2); `createNoteForPerson` title=body.
  - Docs: INC-021, DECISIONS/CAPABILITIES/steps.
- Verify: test2 note `87e26ed5…` title=body string; label=title/TEXT on test1+test2; 42/42 notes synced; latest note position=0 on sample opportunity; saas-api rebuilt with twenty-client fix.
- Broken / blockers: browser MCP unavailable for visual check — user hard-refresh CRM; new workspaces need SQL re-run for triggers.
- Next: hard-refresh test2 Сделки → chip shows body; multi-note shows latest first.

### 2026-07-21 — Checkpoint commit: CRM chat tab + defaults + security note
- Goal: persist working test2 CRM state (chat UX, kanban defaults, multi-file) and record security review.
- Changes: commit branch `feature/twenty-crm-chat-tab` (voxly-crm-chat app, docker patches/SQL/shell-ux, twenty-client defaults, saas-api service-token, agent docs). Exclude `.cursor/skills/`.
- Verify: security-review on uncommitted diff — 0 critical/high; **2 medium** (global `VOXLY_SERVICE_TOKEN` cross-tenant if leaked; `/file/:fileId` not bound to conversation attachments). XSS escape OK; Nest 10MB body mitigated by INC-020 shrink.
- Broken / blockers: medium auth findings deferred; Twenty hot-patches need image rebuild to survive recreate.
- Next: user UI verify; then harden service-token + file IDOR if desired.

### 2026-07-21 — Chat multi-file reply 500 (INC-020)
- Goal: fix toast 500 when sending two attachments (images or mixed) from CRM chat tab.
- Changes:
  - `docker/patch-twenty-file-base64.cjs` — host JPEG shrink before `dataBase64`; safe re-patch.
  - `twenty-app/voxly-crm-chat/.../chat-panel.tsx` — extract top-level `event.files`, size preflight, clearer entity-too-large toast; composer clear after full sequential success.
  - Docs: INC-020, CAPABILITIES, steps.
- Verify: hot-patch `maxEdge=1600` in FrontComponentRenderer; `yarn twenty apply --remote test2 --force` front `c93f55cd…`; curl sequential png+docx → 200; oversize JSON → 500 entity too large (now mapped in UI).
- Broken / blockers: hard-refresh CRM to pick front + host patch; non-image files still limited by Nest 10MB JSON.
- Next: user hard-refresh → attach 2 photos / png+docx → both land in Telegram + history; chips clear.

### 2026-07-21 — CRM defaults: kanban width/card, note body, Chat after Home
- Goal: make user’s test2 kanban/tab settings the standard for all new portals; notes show body (≥5 lines), not title; «Чат» right after «Главная».
- Changes:
  - `twenty-app/voxly-crm-chat` page-layout-tabs: Chat `position: 15`.
  - `packages/twenty-client`: `kanbanColumnWidth=320`, `OPPORTUNITY_KANBAN_CARD_FIELDS`, `ensureNoteBodyAsLabel` in `applyWorkspaceDefaults`.
  - SQL: `docker/set-opportunity-kanban-card-defaults.sql`, `docker/set-chat-tab-position.sql`.
  - `docker/twenty-shell-ux.js`: ~5-line clamp for note text on board cards.
  - Docs: ADR-010 expanded, CAPABILITIES, steps.
- Verify: test1/test2 INDEX By Stage width 320; note label=bodyV2; Chat tabs position 15; `tsc` twenty-client OK; chat apply test2 no-op (already synced).
- Broken / blockers: hard-refresh CRM; Twenty recreate needs SQL + shell re-copy.
- Next: user hard-refresh → Сделки kanban note body + tabs order.

### 2026-07-21 — Chat: pin composer vs outer scroll + fix broken file-base64 patch (INC-018/019)
- Goal: composer must not move when scrolling chat; recover «Неверная конфигурация» if still present.
- Changes:
  - `docker/patch-twenty-file-base64.cjs` — missing `)` in `Promise.all` (INC-018); hot-fixed running FrontComponentRenderer.
  - `docker/twenty-shell-ux.js` — `pinChatCanvasScroll` locks page-layout scroll-wrapper + widget height chain when Voxly chat detected.
  - `chat-panel.tsx` — absolute fill + flex column; list `flex:1;overflowY:auto`; composer `flexShrink:0` (front `fa82b539…`).
  - Docs: INC-018, INC-019, FLOWS§4, CAPABILITIES, steps.
- Verify: browser pad-inject → root stays ~991px, list scrolls internally, composer top unchanged on list/outer scroll; shell `data-voxly-chat-pinned=1`.
- Broken / blockers: shell hot-patch lost on Twenty recreate until image rebuild; hard-refresh needed.
- Next: user hard-refresh «Чат» and scroll a long thread.

### 2026-07-21 — Chat: sticky composer + Remote DOM file base64 (INC-017)
- Goal: (1) composer fixed at bottom of chat panel (only message list scrolls); (2) fix attach toast `FileReader.readAsDataURL … not of type 'Blob'`.
- Changes:
  - `docker/patch-twenty-file-base64.cjs` (+ Dockerfile) — host FileReader adds `dataBase64` before worker sees change; hot-patched `FrontComponentRenderer`.
  - `chat-panel.tsx` — `PendingAttachment` on change; send uses stored base64; grid layout `auto minmax(0,1fr) auto` + `overflow:hidden` so composer stays pinned.
  - Docs: INC-017, FLOWS§4, CAPABILITIES, steps §3–§4.
- Verify: `yarn twenty apply --remote test2 --force` → front checksum `fc00cf27…` (was `f6d99181…`); host patch marker `voxly-file-base64` in FrontComponentRenderer.
- Broken / blockers: needs hard-refresh CRM tab (cache FrontComponentRenderer + app). Large files still subject to logic JSON size cliff (INC-014).
- Next: hard-refresh test2 → «Чат»: composer stays at bottom while scrolling history; attach docx/photo sends without Blob/FileReader toast.

### 2026-07-21 — Chat: Remote DOM composer remount clear (INC-016)
- Goal: text send already worked after INC-015 but composer still showed draft and Send stayed gray.
- Changes:
  - `chat-panel.tsx` — after successful `/reply`: `setDraft('')` + `composerKey++` remounts textarea; `setSending(false)` in `finally`; `void load()` outside (never await inside sending lock).
  - Docs: INC-016, FLOWS§4, CAPABILITIES, steps §3–§4.
- Verify: `yarn twenty apply --remote test2 --force` → frontComponent checksum `6617426e…` (was `e7daa9b3…`).
- Broken / blockers: needs hard-refresh CRM tab to load new front.
- Next: user hard-refresh test2 → «Чат» → text send must clear textarea visually; typing new text re-enables Отправить.

### 2026-07-21 — Chat: Remote DOM file encode + unstick Send (INC-015)
- Goal: fix attach toast `t.arrayBuffer is not a function`; ensure draft clears after successful send and Send never stays stuck disabled.
- Changes:
  - `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` — `fileToBase64` via `FileReader.readAsDataURL` (no `arrayBuffer` on Remote DOM File proxies); `sending` cleared in `finally` before `load()`; draft/files cleared only after successful sequential `/reply`.
  - Docs: INC-015, FLOWS§4, CAPABILITIES note, steps §3–§4.
- Verify: `yarn twenty apply --remote test2 --force` → frontComponent checksum `e7daa9b3…` (was `e950923b…`).
- Broken / blockers: needs hard-refresh CRM tab; if FileReader also missing in sandbox, attach would still fail (fallback only when real `arrayBuffer` exists).
- Next: user hard-refresh test2 → «Чат» → text send clears composer; attach docx/photo sends without arrayBuffer toast; format toolbar still works.

### 2026-07-21 — Hide CRM create-workspace + default Сделки kanban
- Goal: remove «+ Создать рабочее пространство» from profile ⋯ menu; open Сделки on kanban By Stage by default (test2 + durable path).
- Changes:
  - `docker/twenty-shell-ux.js` + Dockerfile bake → `/voxly-shell-ux.js` (MutationObserver hides create-workspace menu rows; keeps Sign out).
  - Hot-patched running `docker-twenty-server-1` index.html + static file.
  - `docker/set-opportunity-kanban-default.sql` — promote Opportunity `By Stage` KANBAN to `key=INDEX` (Twenty `updateView` cannot set `key`).
  - Applied SQL on twenty DB for **test1** + **test2**.
  - `packages/twenty-client` `ensureOpportunityKanbanDefault` in `applyWorkspaceDefaults` — converts seeded TABLE INDEX → KANBAN+stage groups when SQL not run yet.
- Verify: SQL `By Stage`/`KANBAN`/`INDEX` on test1/test2; `curl test2…/voxly-shell-ux.js` → 200; index.html lists three voxly scripts; `@voxly/twenty-client` typecheck ✓.
- Broken / blockers: UI hard-refresh needed; recreate of Twenty container loses hot-patch unless image rebuilt; GraphQL path keeps a separate «By Stage» alias until SQL promotes it to INDEX.
- Next: user hard-refresh test2 → profile ⋯ (no create-workspace) → Сделки lands on By Stage board.

### 2026-07-21 — Chat: abandon ПКМ → format toolbar; photo preview size cliff (INC-014)
- Goal: fix broken ПКМ format (double menu / hang / dead clicks); photos show as `<img>` not 📎 Фото.
- Changes:
  - `chat-panel.tsx` — always-visible format buttons (Жирный/Курсив/…); removed contextmenu; `_italic_` render; no `.focus()`.
  - `voxly-proxy.ts` + dep `jpeg-js` — JPEG preview compress ≤48KB raw before base64 (Twenty `/s` empty-200 on ~240KB JSON).
  - Docs: FLOWS§4, ADR-001, CAPABILITIES, INC-014, steps §3–§4.
- Verify: `yarn twenty apply --remote test2 --force` → front checksum `e950923b…`; `get-crm-chat-file` HTTP 200 with `dataBase64` ~33KB `image/jpeg` (was empty body).
- Broken / blockers: Remote DOM may still not support video thumbnails; non-JPEG large files → 413 / 📎 fallback.
- Next: user hard-refresh test2 CRM → «Чат» → format toolbar + photo `<img>`.

### 2026-07-21 — Chat UX: format menu dismiss + multi-attach layout
- Goal: fix hanging ПКМ format menu; stack Прикрепить above Отправить; multi-file attach.
- Changes: `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` — `preventDefault` contextmenu; dismiss on outside/Escape/blur/scroll/format/selection-clear; `File[]` + chips; sequential `/reply` (saas-api `files: 1`); FLOWS§4 / CAPABILITIES / ADR-001 composer.
- Verify: `yarn twenty apply --remote test2 --force` → front checksum updated; hard-refresh CRM → only custom format menu; multi-select files → sequential Telegram sends.
- Broken / blockers: native browser menu may still appear in some Remote DOM hosts (preventDefault best-effort); API still single-file per request.
- Next: user hard-refresh test2 «Чат» and verify ПКМ + multi-attach E2E.

### 2026-07-21 — Chat photo/attachment preview (SDK)
- Goal: photos show as `<img>`, not `[фото]` text; other files as download links.
- Changes: `voxly-proxy` `binaryAsBase64`; logic `get-crm-chat-file` (`GET /crm-chat/:recordId/file/:fileId`, UUID `30e98e5b-…`); `chat-panel` AttachmentView + hide media placeholders; FLOWS§4 / CAPABILITIES.
- Verify: `yarn twenty apply --remote test2 --force` → created get-crm-chat-file + updated front; hard-refresh CRM → photo messages render images.
- Broken / blockers: none (saas-api `/file/:fileId` + service token already OK).
- Next: user hard-refresh test2 CRM → Person/Opportunity «Чат» with photo messages.

### 2026-07-21 — Chat format toolbar + file attach (SDK parity)
- Goal: вернуть формат и 📎 как в inject; зафиксировать UX contract.
- Changes: `chat-panel` format buttons + file attach; `reply-crm-chat`/`voxly-proxy` fileBase64→multipart; docs FLOWS§4 / ADR-001 / CAPABILITIES / `AGENTS.md` UX contract; apply test2.
- Verify: apply synced front+reply; hard-refresh → toolbar + 📎 + send file/text.
- Broken / blockers: ПКМ native menu в Remote DOM часто не глушится — toolbar SoT.
- Next: user verify format + attach E2E to Telegram.

### 2026-07-20 — Fix Worker URL parse + floating cabinet (INC-013)
- Goal: чат без `Failed to parse URL`; убрать снова появившуюся «← Кабинет».
- Changes: `chat-panel` absolute `/s` + `getApplicationVariable(WORKSPACE_ORIGIN)`; `docker/patch-twenty-functions-url.cjs` (+ Dockerfile) → functionsBaseUrl `http://{sub}.localhost/s`; re-hotpatch cabinet DISABLE; apply test2.
- Verify: patched hook returns `http://test2.localhost:3007/s`; cabinet early-return; apply front checksum updated.
- Broken / blockers: UI hard-refresh required (cached front assets).
- Next: user hard-refresh CRM → Чат load/send; sidebar only «Кабинет Voxly».

### 2026-07-20 — Fix Chat tab Failed to fetch (INC-012)
- Goal: вкладка «Чат» снова грузит историю после INC-011.
- Changes: `chat-panel.tsx` — всегда relative `/s/...` host-bridged fetch (убран absolute `WORKSPACE_ORIGIN` baseUrl); `application-config.ts` WORKSPACE_ORIGIN deprecated empty; `docker-compose.yml` + `.env.example` `LOGIC_FUNCTION_TYPE=LOCAL`; restart twenty-server/worker; apply --force test2.
- Verify: `LOGIC_FUNCTION_TYPE=LOCAL` in container; curl test2 `/s/crm-chat/...` → auth missing (not workspace-missing); `yarn twenty dev:function:exec -n get-crm-chat` → SUCCESS; saas-api `GET /api/crm/chat/...` from twenty.
- Broken / blockers: UI hard-refresh still needed for new front bundle.
- Next: user hard-refresh CRM test2 → Person/Opportunity → «Чат».

### 2026-07-20 — Fix Chat tab workspace host 404 (INC-011)
- Goal: вкладка «Чат» load/send на `test2.localhost:3007` Person/Opportunity (не 404 на bare localhost).
- Changes: `chat-panel.tsx` — `RestApiClient` `baseUrl` из `WORKSPACE_ORIGIN` + relative localhost rewrite fallback; `application-config.ts` + `universal-identifiers.ts` (`WORKSPACE_ORIGIN=http://test2.localhost:3007`); apply --force on test2.
- Verify: curl bare localhost `/s/...` → 404 `WORKSPACE_NOT_FOUND`; `test2.localhost` → auth error (не workspace-missing); apply synced frontComponent + applicationVariable.
- Broken / blockers: UI hard-refresh still needed; `WORKSPACE_ORIGIN` baked for test2 PoC (other workspaces need their origin on apply/settings).
- Next: user hard-refresh CRM → Person/Opportunity → «Чат» load/send.

### 2026-07-20 — Кабинет Voxly in workspace sidebar
- Goal: перенести кнопку кабинета из floating inject в список «Рабочая область», название «Кабинет Voxly».
- Changes: `twenty-app/voxly-crm-chat/src/navigation-menu-items/cabinet-voxly.ts` (`NavigationMenuItemType.LINK` → `http://localhost:3001/dashboard`); `DISABLE_FLOATING_CABINET=true` in `docker/twenty-cabinet-link.js`; hot-patch `/voxly-cabinet.js` in twenty-server; apply --force on test2; ADR-009 update.
- Verify: CRM sidebar → «Кабинет Voxly» → portal dashboard; floating «← Кабинет» gone after hard refresh.
- Broken / blockers: LINK URL baked in manifest (local dashboard); prod needs different link on apply. Bake inject flag into image still optional.
- Next: user hard-refresh CRM; optionally set prod cabinet URL when deploying.

### 2026-07-20 — Fix SDK chat tab sandbox + remove sidebar page
- Goal: вкладка «Чат» без crash; убрать «Voxly CRM Chat» из рабочей области.
- Changes: `chat-panel.tsx` без `window.setInterval`; delete scaffold nav/page/main-page; apply --force on test2.
- Verify: Person/Opportunity → «Чат» грузит сообщения; сайдбар без Voxly CRM Chat.
- Broken / blockers: auto-poll нет (кнопка «Обновить»).
- Next: user hard-refresh CRM.

### 2026-07-20 — Twenty Apps SDK chat tab
- Goal: native «Чат» tab on Person/Opportunity instead of floating inject.
- Changes: `twenty-app/voxly-crm-chat` (front ChatPanel, pageLayoutTabs, logic `get/reply-crm-chat`); saas-api service-token auth (`VOXLY_SERVICE_TOKEN` + `X-Twenty-Workspace-Id`); `.env.example` / compose; inject `DISABLE_FLOATING_CHAT=true`.
- Verify: `yarn twenty apply` on test2; service-token `GET /api/crm/chat/:opportunityId` → 13 msgs; tabs «Чат» in `pageLayoutTab`.
- Broken / blockers: Twenty DB missing `applicationRegistration.logoFileId` until manual ALTER (upgrade cursor lag); `dev:function:exec` CLI auth flaky — proxy verified via saas-api directly. Media attach in SDK UI not yet.
- Next: hard-refresh CRM → open Person/Opportunity → tab «Чат»; optional rebuild Twenty image to bake inject flag.

### 2026-07-20 — Person-card chat + Telegram field
- Goal: чат с клиентом с карточки контакта; поле Telegram (@username) на Person.
- Changes: `crm-chat` lookup by opportunity **или** person id; `twenty-deal-chat.js` parse Person URL; `twenty-client` `ensureTelegramField` + `createPerson.telegram` / `updatePersonTelegram`; gift-bot fills handle on sync; reapply defaults test2.
- Verify: Person page → «Чат»; Social/fields → Telegram `@Remont_toua`; new leads get handle on create.
- Broken / blockers: custom field может быть не в группе «Социальные сети», а рядом в полях (Twenty layout).
- Next: user hard-refresh CRM Person card.

### 2026-07-20 — CRM chat media + MarkdownV2
- Goal: CRM deal chat принимает медиа, шлёт с форматированием и вложениями с ПК.
- Changes: `ChatMessage.attachments`; gift-bot inbound media; `crm-chat` reply MarkdownV2 + multipart file + `/file/:fileId` proxy; `twenty-deal-chat.js` UI attach/preview/format; portal subscriber reply MarkdownV2.
- Verify: hard refresh CRM → чат: **жирный** уходит в TG; клиент шлёт фото → видно в панели; 📎 файл с ПК → клиенту.
- Broken / blockers: —
- Next: E2E в UI.

### 2026-07-20 — CRM SSO use *.localhost (lvh.me blank)
- Goal: CRM tab renders workspace, not blank/`/welcome`.
- Changes: revert lvh.me; force `SERVER_URL=http://localhost:3007`; keep `{slug}.localhost` SSO; INC-008.
- Verify: crm-login → `test2.localhost:3007/verify?loginToken=…`; browser shows Voxly on that host.
- Broken / blockers: Safari may need `/etc/hosts` for `*.localhost` if it does not resolve.
- Next: user hard-refresh dashboard → Открыть CRM.

### 2026-07-20 — CRM SSO via *.lvh.me (fix /welcome)
- Goal: «Открыть CRM» входит в workspace, не на `/welcome`.
- Changes: Twenty `SERVER_URL=http://lvh.me:3007`; `toBrowserCrmUrl` slug.localhost→slug.lvh.me; portal named-window open; INC-008.
- Verify: crm-login → `test1.lvh.me:3007/verify?loginToken=…`; hard refresh dashboard → CRM opens workspace.
- Broken / blockers: —
- Next: E2E open from UI + chat token.

### 2026-07-20 — Fix CRM open blank tab (INC-008)
- Goal: «Открыть CRM» реально открывает Twenty, не пустую вкладку.
- Changes: `tenant.ts` `toBrowserCrmUrl` (*.localhost → TWENTY_SERVER_URL); dashboard `openCrm` named window `voxly_crm` + fallback link; compose `TWENTY_SERVER_URL` on saas-api.
- Verify: hard refresh dashboard → Открыть CRM → `localhost:3007/verify?...`; не `test1.localhost`.
- Broken / blockers: —
- Next: E2E SSO + chat token в CRM.

### 2026-07-20 — Fix CRM lead create + dedupe + CRM popup
- Goal: лиды снова создаются в Twenty; без дублей Person; CRM открывается при блоке попапа.
- Changes: `twenty-client` `createPerson/Opportunity(data:)`; `findPersonByHint`; gift-bot anti-dupe by telegramId; portal fallback link for CRM; INC-007; redeploy worker+portal; backfill `scripts/backfill-crm-sync.mjs` → Remont_toua + genadich_agency linked.
- Verify: DB ids filled; worker query uses `createPerson(data:)`; portal has fallback copy.
- Broken / blockers: —
- Next: gift E2E в CRM (People/Сделки + чат на сделке); повторный `/start` не должен плодить Person.

### 2026-07-20 — Deal-card Telegram chat in Twenty
- Goal: Клиент пишет боту → лид в CRM; менеджер видит и отвечает из карточки сделки.
- Changes: `apps/saas-api/src/routes/crm-chat.ts`; crm-login `chatToken`; `docker/twenty-deal-chat.js` + Dockerfile/compose `VOXLY_API_URL`; gift-bot log inbound/outbound + reuse Person/Opportunity; portal hash token; ADR-001 interim.
- Verify: open CRM from portal → open Opportunity → «Чат» bottom-left; reply reaches Telegram; `/api/crm/chat/:id` 200.
- Broken / blockers: Apps SDK tab still pending; chat auth requires opening CRM from portal (not bookmark-only).
- Next: gift E2E; optional SDK replace inject.

### 2026-07-18 — ui-ux-pro-max skill + portal polish
- Goal: Установить `ui-ux-pro-max-skill`, прогнать design-system workflow, подтянуть UI портала без смены Twenty light.
- Changes: `.cursor/skills/ui-ux-pro-max/` (+ sibling skills from `uipro init`); `design-system/voxly/MASTER.md` (Twenty override); `project-picker`, `app-shell`, `switch`, bot settings header, login/register focus; elevation tokens in `globals.css`.
- Verify: hard refresh `http://localhost:3001/dashboard/bots/<botId>` — проекты/Switch; exclusive active API без изменений контракта.
- Broken / blockers: —
- Next: gift E2E с двумя проектами.

### 2026-07-18 — Проекты/кампании на боте (вкл/выкл)
- Goal: Несколько проектов на одном gift-боте; каждый включается/выключается; своя статистика и сделка в CRM.
- Changes: `GiftCampaignConfig.name`; API `POST/PATCH .../campaigns`, `campaigns[]` в GET bots; worker resolve по `g_{id}` / active; portal блок «Проекты»; CRM opportunity name `@user · проект · @bot · @channel`.
- Verify: typecheck api/portal/worker; `prisma db push`; docker rebuild saas-api / gift-bot-worker / saas-portal.
- Broken / blockers: —
- Next: gift E2E с двумя проектами; tenant funnel stats по projectId.

### 2026-07-18 — Кнопка «Кабинет» в Twenty CRM
- Goal: Выход из CRM обратно в дашборд Voxly.
- Changes: `docker/twenty-cabinet-link.js`, `twenty.Dockerfile` inject, compose `VOXLY_CABINET_URL`.
- Verify: `http://localhost:3007/voxly-cabinet.js` 200; hard refresh CRM → кнопка справа снизу.
- Broken / blockers: —
- Next: опционально nav item через Apps SDK.

### 2026-07-18 — Один активный проект + UI Switch
- Goal: Нельзя два активных; современнее UI проектов.
- Changes: exclusive `isActive` в API; `Switch` + `ProjectPicker`; auto-heal дублей при GET bots.
- Verify: typecheck; rebuild saas-api/saas-portal.
- Broken / blockers: —
- Next: —

### 2026-07-17 — Twenty CRM → 2.22.0 + white-label
- Goal: Upgrade Twenty 2.21 → 2.22; сохранить branding Voxly / `lang=ru`.
- Changes: `docker/twenty.Dockerfile`, `docker/docker-compose.yml` → image `voxly-twenty:2.22.0`.
- Verify: workspace migrations ok; `:3007` healthy; title Voxly.
- Broken / blockers: legacy `installApp` отсутствует в metadata GQL; stub App не SDK.
- Next: Apps path via `syncApplication` / `installApplication`; deal-card chat ADR.

### 2026-07-17 — ADR deal-card chat
- Goal: Зафиксировать путь чата в карточке Сделки для Twenty 2.22.
- Changes: решение в `steps.md` §3 / теперь `docs/agent/DECISIONS.md` ADR-001 (код SDK ещё нет).
- Verify: live API = sync/install; portal chat SoT = Prisma.
- Broken / blockers: Colima/Twenty down на момент ADR; Yarn 4 не в PATH; нужен workspace API key. Scaffold не стартовал.
- Next: поднять Twenty → create-twenty-app → logicFunction → `/api/crm/chat/*`.

### 2026-07-17…18 — Portal UI Twenty light + motion
- Goal: Единый light UI (не indigo/dark); shell + motion; hotfix contrast на публичных страницах.
- Changes: `apps/saas-portal` globals/pages, `components/portal/*`, `components/ui/*`; убран `next/font/google` (ETIMEDOUT в Docker build).
- Verify: rebuild `saas-portal`; login/register читаемы на `:3001`.
- Broken / blockers: stale Docker image показывал старый dark UI до `--build`; popup CRM может блокироваться браузером.
- Next: gift E2E; опционально design ref Open WebUI (sibling clone, не зависимость).

### 2026-07-18 — Colima / Redis AOF / Telegram network
- Goal: Поднять локальный стек после простоя.
- Changes: runtime (volumes/containers), не product code.
- Verify: portal/API/CRM HTTP 200; Redis healthy после починки AOF.
- Broken / blockers: с хоста/контейнеров `api.telegram.org` unreachable → manager-bot restart loop, gift polling fails (нужен VPN/прокси).
- Next: VPN → restart manager-bot + gift-bot-worker; продолжить gift E2E.

### 2026-07-18 — docs/agent memory pack
- Goal: Lean agent docs + WORKLOG/INCIDENTS + Cursor rule cascade.
- Changes: `docs/agent/*`, `.cursor/rules/project-state.mdc`, pointer в `steps.md`.
- Verify: файлы на месте; graphify `--code-only --update`.
- Broken / blockers: —
- Next: агенты читают CAPABILITIES перед реализацией; append WORKLOG после значимых сессий.

### 2026-07-18 — Product analysis (owner-facing)
- Goal: Описать реализованное / анализ / backlog / как доводить (RU ответ владельцу).
- Changes: read-only (`steps.md`, `docs/agent/*`, spot-check code); no product code.
- Verify: CAPABILITIES/FLOWS/DATA aligned with steps §4–5.
- Broken / blockers: TG network (api.telegram.org), deal-chat scaffold, uncommitted WIP.
- Next: gift E2E → deal-card SDK → commit when asked.

### 2026-07-31 — Полный деплой: партнёрский баланс, каналы AI, фиксы биллинга (prod)

- Goal: привести прод в консистентное состояние со всеми локальными изменениями — списание партнёрского баланса в счёт оплаты, заявки на вывод, атомарное списание AI-кошелька, разбивка расходов AI по каналам, фиксы биллинга (Robokassa идемпотентность, productScope/durationMonths), WA handoff при нуле баланса.
- Changes:
  - `packages/db` — 4 новые миграции: `..._ai_charge_shortfall_and_referral_earning_unique` (uncollectedRub + unique paymentId на ReferralEarning), `..._referral_rule_product_scope` (нормализация subscriptions→all), `..._ai_usage_channel` (AiUsageLog.channel + индекс), `..._referral_withdrawal_and_balance_applied` (ReferralWithdrawal, Payment.balanceAppliedRub, ReferralTxKind.redeem).
  - `packages/shared` — REFERRAL_PRODUCT_SCOPES, AI_USAGE_CHANNELS, REFERRAL_WITHDRAWAL_MIN_RUB.
  - `packages/ai-core` — атомарный conditional decrement в chargeAiUsage, channel param.
  - `apps/saas-api` — billing.ts (checkout applyBalanceRub, fulfilPaymentTransactional, idempotent result), referral.ts (withdrawals CRUD), admin-referrals.ts (withdrawals queue, productScope), tenant.ts (partnerBalanceRub), scheduler.ts (releaseStaleBalanceHolds).
  - `apps/ai-telegram-worker` + `ai-whatsapp-worker` + `gift-bot-worker` — channel param во всех chargeAiUsage call-site; WA: switchToHuman при paused.
  - `apps/saas-portal` — полная переработка UX /dashboard/partners, /dashboard/ai, /dashboard/ai/agents, /dashboard/ai/whatsapp, /admin/partners; checkout с applyBalanceRub.
  - `docs/agent/INCIDENTS.md` — INC-074..078.
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker,gift-bot-worker`. Backup **`/opt/voxly/backups/20260731-151337/`** (`voxly_control.dump` 279K + `twenty.dump` 2.4M). Тома не трогались, `.env` не синкался.
- Migration on prod: `prisma migrate deploy` → applied 4 pending (20260731170000, 180000, 190000, 200000). Уникальный индекс ReferralEarning.paymentId создался без проблем (дублей не было).
- Verify: Smoke `/` `/health` `/dashboard/partners` `/dashboard/crm` `/admin/partners` `/dashboard/ai` — **200**. Логи `saas-api` — одна ожидаемая ошибка releaseStaleBalanceHolds при первом старте (до применения миграций), после restart чисто. Cold start 502 saas-portal — штатно, после прогрева 200.
- Broken: ничего.
- Next: обновить CAPABILITIES.md, steps.md; ротировать root SSH пароль.

### 2026-07-31 — Scheduler crash protection + migrate-before-restart in deploy (prod)

- Goal: предотвратить падение процесса saas-api от unhandled rejection в джобах планировщика; встроить `prisma migrate deploy` в деплой-скрипт ДО пересоздания контейнеров.
- Changes: `apps/saas-api/src/jobs/scheduler.ts` — обёртка `safeJob(name, fn)` вокруг всех 4 async-джобов (checkExpiredSubscriptions, checkAiWalletAlerts, syncGiftCampaignSchedules, releaseStaleBalanceHolds); inline `.catch()` у ai-sales-learn не затронут. `scripts/prod-deploy.sh` — новый шаг после rsync: build saas-api image → `docker-compose run --rm saas-api sh -c "cd /voxly/packages/db && ./node_modules/.bin/prisma migrate deploy"`; если миграция упала — деплой останавливается. Dry-run корректно показывает порядок: rsync → build → migrate → up -d → smoke. `docs/agent/DEPLOY.md` обновлён.
- Deploy: `./scripts/prod-deploy.sh saas-api`; Backup `/opt/voxly/backups/20260731-154611/` (voxly_control.dump 286K + twenty.dump 2.4M); prisma migrate deploy → «No pending migrations to apply» (21 миграций, ни одна pending); container recreated; smoke initial 404 (cold start <1s), после прогрева portal + API health + /dashboard/partners + /dashboard/ai → **200**. Container restarts=0, logs clean (no scheduler errors).
- Broken: ничего.
- Next: мониторить логи на предмет `[scheduler] ... failed` — эти варнинги теперь безопасны (не роняют процесс).

### 2026-07-31 — Смоук-тест деплоя: retry вместо мгновенного запроса

- Goal: смоук в `prod-deploy.sh` стрелял по адресам сразу после `docker-compose up`, получал 404/ошибку из-за холодного старта и приучал игнорировать красный результат. Нужно ожидание готовности с повторами.
- Changes: `scripts/prod-deploy.sh` — новая функция `smoke_wait`: опрос каждого эндпоинта каждые 3 с до HTTP 200 или таймаута 60 с; прогресс-вывод; при исчерпании таймаута — ненулевой exit с последним кодом. Обновлено сообщение `--dry-run`. Обработка `curl` совместима с `set -euo pipefail`.
- Verify: `bash -n` синтаксис OK. Изолированный тест: рабочий URL (`getvoxly.ru`) — успех за 0 с; недоступный (`127.0.0.1:19999`) — корректный таймаут + exit 1. `--dry-run saas-api` — новое сообщение на месте. Боевой деплой `saas-api` — smoke `OK 200 (0s)` для обоих эндпоинтов. Все 4 адреса (health, /, partners, admin/partners) — 200. Логи saas-api чисты, контейнер не перезапускается.
- Broken: ничего.
- Next: —

### 2026-08-16 — Total docs audit + CRM chat auto-refresh + cross-channel write-first (prod)

- Goal: полная адресная база знаний docs/ (INDEX + 5 доменных модулей + changelog/ADR + AUDIT_CLEANUP_CANDIDATES + TEST_REPORT + AGENTS.md→rules); авто-обновление voxly-crm-chat при деплое; починка write-first «Пишем от:» во всех каналах (MAX/TG/WA) и дублей от входящих TG.
- Changes:
  - Документация: `docs/INDEX.md`, `docs/01-system-core/*` (6), `docs/02-twenty-crm-engine/*` (6+1 auto-refresh), `docs/03-saas-api-internal/*` (5), `docs/04-workers-and-bridges/*` (6), `docs/05-media-storage-pipeline/*` (4), `docs/changelog/*` (INDEX, system-history, ADR-0001..0003), `docs/AUDIT_CLEANUP_CANDIDATES.md`, `docs/TEST_REPORT.md`, `AGENTS.md` → `.cursorrules`/`.windsurfrules`/`.kilocode/rules/`.
  - Авто-обновление CRM-чат приложения: `apps/saas-api/src/services/crm-chat-app-auto-refresh.ts` (sha1 tarball ↔ Redis-маркер `voxly:crmchat-app:tarball-sha1`, scheduler-lock, force-reinstall per tenant) + вызов в `worker.ts`. Twenty ставит private-registry app один раз при provisioning — без этого воркспейсы вечно жили со старым бандлом (инцидент «Нет данных»/отсутствие селектора каналов).
  - Резолверы пира: убраны мёртвые колонки `person.telegram`/`person.whatsapp` из 4 SQL (crm-chat ×3, backfill-telegram-open-links) — запросы падали целиком → sendFromOptions MAX/TG `available:false`; `loadPersonPhoneE164` теперь собирает callingCode+number.
  - MAX write-first: `apps/max-bridge` `_resolve_dialog_chat_id` (get_chat_id(me,user)+add_contact) — send_message требует id ДИАЛОГА, не user_id (ошибка `common.finder User not.found`).
  - TG write-first: gramjs-bridge → `resolvedPeerUserId` (числовой id), saas-api_adoption в чат; ai-telegram-worker `ensureConversation` username-fallback + backfill числового id (дубль Person+сделки от входящего ответа); twenty-client `findPersonByHint` ищет и по t.me URL/label.
  - Карточка: `telegramOpenLink` label = `@handle` (или id) при url=`https://t.me/…`; ручной ввод нормализуется через новую logic-function `normalize-person-telegram` + `POST /api/crm/chat/normalize-telegram` (идемпотентно).
  - Фронт: chat-panel после send переключается на `conversationId` из ответа (write-first/смена канала).
  - Инфра: access-логи Traefik (`--accesslog=true --accesslog.format=json`, compose на проде).
- Deploy: `prod-deploy.sh saas-api,saas-worker` ×2, затем `saas-api,saas-worker,ai-telegram-worker,gramjs-bridge,max-bridge`; tarball 0.1.31 (32 файла) установлен авто-рефрешем в оба воркспейса (sha 3f987188…). Smoke 200.
- Prod data: слиты TG-диалоги-дубли (cmsvmuksa→cmsvmxzpg, 4 сообщения, CrmRecordLink пере-поинчен, дубль closed); Twenty soft-delete дубля person 83404cbc / opp 34e4f6fa; label оригинала → @toxasagmsk; metadataVersion++; flush flat-maps. Бэкапы: `pre-merge-full.dump` (control), `pre-twenty-merge.dump` (twenty) в /tmp контейнеров PG — ПЕРЕНЕСТИ в /opt/voxly/backups при следующем деплое.
- Verify: pnpm typecheck (all) ✅; pnpm test 178 passed / 15 skipped (+15 новых тестов: crm-chat-app-refresh 7, crm-chat-peer-parse 8); py_compile max-bridge ✅. API: threads=[whatsapp, telegram_gramjs @toxasagmsk] 12 сообщений, sendFrom 3/3 available. Access-логи Traefik идут.
- Broken: ничего критичного. Остаток: MAX write-first отправку проверить живым сообщением (диалог resolve теперь через get_chat_id); бэкапы из /tmp PG-контейнеров перенести в постоянное хранилище.
- Next: live-проверка MAX отправки пользователем; перенос бэкапов; чистка AUDIT_CLEANUP_CANDIDATES после подтверждения.

### 2026-08-16 (доп.) — MAX get_chat_id sync-XOR + «Открытые чаты:» select
- Changes: max-bridge `_resolve_dialog_chat_id` переписан (PyMax `get_chat_id` — sync-формула `me ^ user`; прежний await → TypeError → send с user_id → `common.finder not.found`); chat-panel: пилюли тредов → select «Открытые чаты:» (стиль «Пишем от:»), убран unused `accent`.
- Deploy: `prod-deploy.sh max-bridge,saas-api,saas-worker`; tarball sha 4a463e36… установлен авто-рефрешем в efim1/remtoua. Smoke 200.
- Verify: py_compile OK; lint 0 errors; логи воркера — refresh OK. Живая MAX-отправка — у владельца.
- Next: подтверждение живой MAX-отправкой; перенести /tmp-бэкапы PG в /opt/voxly/backups.

### 2026-08-16 (финал) — user-confirmed, инциденты зафиксированы
- Verify (владелец): дублей нет; TG-чат работает; MAX «Пишем от:» отправляется (XOR chat_id); «Открытые чаты:» select на месте.
- Docs: INC-120..123 в INCIDENTS.md (каждый с инвариантом «больше никогда»); write-first/max-bridge спеки усилены XOR-инвариантом; system-history — верификационная запись.
- Остаток (не блокер): перенести /tmp/pg-бэкапы (pre-merge-full.dump, pre-twenty-merge.dump) в /opt/voxly/backups/; закоммитить ветку.

### 2026-08-16 (commit) — 93de38e + финальный деплой
- Commit `93de38e` (feature/cross-channel-enrich-opp-activity): весь write-first стек, авто-рефреш приложения, база знаний docs/, AGENTS.md+rules, INC-120..123, миграция chat_message_from_me.
- Deploy: `prod-deploy.sh saas-api,saas-worker,ai-telegram-worker,gramjs-bridge,max-bridge` — образы пересобраны из закоммиченного дерева, хэши совпали с работающими (контейнеры не пересоздавались), smoke 200, crmchat-refresh OK.
- Бэкапы слития перенесены: `/opt/voxly/backups/20260816-merge/` (voxly_control-pre-merge.dump 284K + twenty-pre-merge.dump 1.4M).
- Остаток: push ветки / PR — по команде владельца.

### 2026-08-16 (follow-up) — native MAX/WA outbound ingest + Kanban default
- Goal: подтянуть сообщения с телефона из MAX/WhatsApp в существующие CRM Person/Opportunity без дублей; сделать `updatedAt` частью дефолтной Kanban-card конфигурации новых порталов.
- Changes: MAX `message.out` callback `/api/internal/max/outbound` (native id/idempotency, dialog key, operator/fromMe, CRM link); WA `fromMe` dedicated mirror (LID/PN merge, operator/fromMe, outbound timeline/cache, no AI/no new deal); outbound `CrmRecordLink` repair in CRM reply; `OPPORTUNITY_KANBAN_CARD_FIELDS` adds updatedAt; tests/docs/rules/INC-124..126.
- Verify: typecheck 23/23; root tests 184 passed / 15 skipped; CRM Chat tarball build; portal lint warnings only; py_compile OK.
- Deploy pending after commit: backup control/twenty, deploy `saas-api,saas-worker,max-bridge,ai-whatsapp-worker`, verify callbacks/logs and new portal Kanban defaults.

### 2026-08-16 (deploy) — native MAX/WA outbound + Kanban activity default
- Commit: `6e5b36b feat(crm): ingest native MAX WA outbound and default kanban activity`.
- Backup before deploy: `/opt/voxly/backups/20260816-native-outbound/` (`voxly_control.dump` 279K, `twenty.dump` 1.4M).
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-worker,max-bridge,ai-whatsapp-worker`; Prisma migrate deploy completed (no destructive schema changes); smoke all 200.
- Verify: `max-internal.js` contains `/outbound`; max-bridge `/health` `{ok:true, pymax:true, sessions:1}`; all four containers Up; worker confirms CRM-chat tarball unchanged (expected — no front-component source change).
- Manual smoke pending: send a real WhatsApp and a real MAX message from the connected phone to a Person already linked to an Opportunity; both must appear as operator messages in their channel threads with no AI reply and no duplicate Person/Opportunity. New portal provisioning must show Opportunity `updatedAt` on Kanban card.

### 2026-08-16 (deploy 2) — MAX outgoing detect + listener watchdog + chat auto-scroll
- Commit `d337061`. Root causes: PyMax Message has no `.out` (outgoing = sender==me — старый guard гасил события молча); PyMax internal reconnect (12:28 keepalive drop) не пере-цепляет handler; chat panel scroll гонялся с layout Remote DOM.
- Fix: sender-based is_outgoing + XOR peer (chat^me) + peer==me guard; `_listener_watchdog` re-attach каждые 300s (дублики → max:<id> dedupe); chat-panel `useLayoutEffect` скролл на последнее сообщение (deps: messages/activeThreadId/loading).
- Verify: py_compile OK; lint 0 errors; typecheck 23/23; tests 184/15; deploy max-bridge,saas-api,saas-worker — smoke 200; `[crmchat-refresh]` установил tarball 27fd9af8… в efim1/remtoua; bridge: Restored session + Attached on_message; health ok.
- Pending user smoke: MAX сообщение с телефона → operator-сообщение в CRM-чате; открытие чата сразу показывает последнее сообщение.

### 2026-08-16 (deploy 3) — host auto-scroll + gift open-deal reuse + merges
- Scroll root cause: Remote DOM proxies → in-component scrollTop/scrollIntoView no-ops. Fix: panel marks list `data-voxly-chat-list="1"`; `twenty-shell-ux.js` `scrollChatListToLatest()` (host DOM, MutationObserver tick) sticks to bottom on open/switch/new messages, respects manual scroll-up. Hot-patched into running twenty-server (`dist/front/voxly-shell-ux.js`, served-verified ×2); source committed — попадёт в image при следующем twenty-ребилде.
- Gift dup deal root cause: gift-bot-worker не redeploy-ился с новым twenty-client (нет t.me-link hint match) + в реюз-цепочке нет Twenty `findOpenOpportunityByPerson`. Fix: fallback добавлен (parity WA/MAX); gift-bot redeployed с новым packages.
- Prod merge (backup /opt/voxly/backups/20260816-gift-merge/): GiftSubscriber cmsvtq4no + conversation cmsvtq4oq → fca157a8/47ecff36; twenty soft-delete dup opp 49a8235b + person c19b2550; metadataVersion++; flat-maps flushed.
- Commit `605bc59`; deploy gift-bot-worker,saas-api,saas-worker; tarball (с data-атрибутом) установлен авто-рефрешем в оба воркспейса; тесты 184/15, lint 0, node --check OK.

### 2026-08-16 (incident) — INC-129 рецидив «Нет данных» + само-лечащийся рефреш
- Root cause: install-миграция кэширует непатченые widget-конфиги в Redis flat-maps ДО INC-116 патча; бамп metadataVersion не удаляет ключи → SPA видит конфиги без __typename. Утренний_manual flush маскировал; каждый реинсталл воспроизводил.
- Immediate heal: DEL flat-maps (67×2) + версия; браузер-verify: панель чата рендерится.
- Permanent: `refreshCrmChatAppForTenant` → `flushTwentyWorkspaceRedisCache` после патча (commit d4b176a). Force-verify: сброс маркера → реинсталл → `keysDeleted=67` ×2 → рендер OK.
- Docs: INC-129, spec-инвариант, AGENTS+rules правило «SQL-патч widget-конфига = обязательный flush».

### 2026-08-16 (deploy 5) — Chat events в Twenty Timeline + kanban updatedAt
- Feature: `writeTimelineEventToTwenty` (saas-api jobs/queues.ts) — timeline-sync worker создаёт Twenty timeline activities («Входящее/Исходящее сообщение · Канал», targetPersonId + targetOpportunityId, body в properties) и вызывает touchOpportunityActivity → Kanban «Последнее обновление» следует за чатами. twenty-client `createChatTimelineActivity` (data/input fallback). Кэш аутентифицированных клиентов per-tenant (10 мин). MAX live inbound/outbound теперь тоже enqueue (прежде только WA/TG/gift/CRM-reply/history-sync).
- Fixes по ходу: BullMQ jobId НЕ может содержать ':' → ключи `tenant.kind.msg.<id>` (per-message; conversation-уровень глотал все события треда после первого); external sink вызывается и в direct-fallback (setTimelineSyncExternalSink).
- Verify: синтет-джобы → worker log `conv=… opp=47ecff36`, timelineActivity `p=t o=t`, opportunity.updatedAt = now; тесты 192/15; typecheck 23/23. Диагностические записи удалены (DELETE 5).
- Commits: be9cc1a, 779f901, f749274 + текущий (debug-лог резолва).
