# Incidents (runtime)

Известные сбои и как диагностировали. **При дебаге читай первым.**  
Новый failure mode → добавь запись сюда + строку в WORKLOG.

---

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
