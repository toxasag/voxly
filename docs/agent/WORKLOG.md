# Worklog (append-only)

Журнал **значимых** сессий агента / прикладной работы. Не коммит-лог и не дубль `steps.md` — фокус: цель, пути, verify, **что сломано**.

## Шаблон новой записи

```
### YYYY-MM-DD — title
- Goal:
- Changes: (paths)
- Verify:
- Broken / blockers:
- Next:
```

---

---

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
