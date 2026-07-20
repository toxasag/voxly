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

### 2026-07-20 — Telegram field → Social group
- Goal: поле Telegram в блоке «Социальные сети», не «Система».
- Changes: `twenty-client` `movePersonFieldToSocialGroup` (same viewFieldGroup as LinkedIn); `ensureTelegramField` always repositions.
- Verify: Person card → Социальные сети → LinkedIn + Telegram `@Remont_toua`.
- Broken / blockers: —
- Next: —

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
