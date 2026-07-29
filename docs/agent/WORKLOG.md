### 2026-07-30 — Ship AIDA landing (GitHub + prod saas-portal)

- Goal: Push branch + deploy selling landing to getvoxly.ru.
- Changes:
  - Landing: conversational RU AIDA copy; amber full-bleed hero; Voxly mascot poses `voxly-*-v5.png` (transparent).
  - Unbounded + Manrope; sticky mobile CTA; removed comparison-table-first layout.
  - Commit also includes prior staged mailing/CRM work on `ui/indigo-shadcn-dashboard` (portal deploy targets landing first).
- Verify: `./scripts/prod-deploy.sh saas-portal` + `curl -Ik https://getvoxly.ru/`.
- Broken: —
- Next: smoke live landing; optional refresh-crm-chat if mailing panels not yet on prod.

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
