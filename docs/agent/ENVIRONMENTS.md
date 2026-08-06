# Environments: local vs prod

**SoT for how deploys work:** [`DEPLOY.md`](DEPLOY.md) + `./scripts/prod-deploy.sh`.  
**SoT for product surface:** [`CAPABILITIES.md`](CAPABILITIES.md).

## Two environments (never merge casually)

| | Local (dev laptop) | Prod (VPS `150.241.98.135`) |
|---|---|---|
| Code root | this git repo | `/opt/voxly` |
| DB | Colima Docker volumes | named volumes on VPS — **client data** |
| Secrets | root `.env` (local) | `/opt/voxly/.env` (600) — **never rsync** |
| Portal | `:3001` | `https://getvoxly.ru` |
| API | `:3002` | `https://api.getvoxly.ru` |
| Twenty | `:3007` / `{slug}.localhost:3007` | `https://app.getvoxly.ru` / `{slug}-crm.getvoxly.ru` |
| Compose | `docker-compose.yml` + **override** OK | `docker-compose.yml` + **`prod-npm.yml` only** (no override) |
| Edge | none / local Traefik | NPM → Traefik `:8880` ([`docs/NPM-EDGE.md`](../NPM-EDGE.md)) |

Rule: developing locally must **not** assume prod DB/content. Shipping is always **code → rebuild image**, never DB dump local→prod.

## What “match” means

1. **Process match** — agents/humans always use `prod-diff` → `prod-deploy` (documented, scripted).
2. **Code match** — hot files checksum-equal local ↔ `/opt/voxly` for the services you care about.
3. **Runtime match** — containers rebuilt from that code; smoke 200.

Process (1) is in place. Code (2) is **not fully equal** (see drift below). That is OK while working locally; before each prod ship, run `prod-diff` and deploy only the services you intend.

## Verified snapshot (2026-08-06 tip redeploy)

- Branch tip `cb36ecf` on `feature/getvoxlybot-otp-live-robokassa`; PR https://github.com/toxasag/voxly/pull/1 → `main`.
- Deployed: `saas-api`, `saas-portal`, `gramjs-bridge`, `ai-whatsapp-worker`, `ai-telegram-worker`, `gift-bot-worker`.
- Backup `/opt/voxly/backups/20260806-132913/`. Smoke landing + API health + `/open/tg/928954961` **200**.
- Not touched: `evolution-api` (WA sessions), `max-bridge`, Twenty image.

## Verified snapshot (2026-07-23, Business AI ship)

### Match (OK) — after `prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,gift-bot-worker,manager-bot-service,compose`

- API hot files: `queues.ts`, `crm-chat.ts`, `auth.ts`, `twenty-custom-domain.ts`, `Dockerfile`, `twenty-client`, `chat-panel.tsx`
- Portal: `globals.css`, landing, login, `dashboard/page.tsx`, `package.json` (+ AI/GramJS pages rsynced with tree)
- `ai-telegram-worker` `index.ts` + `package.json`
- Manager bot `index.ts`, gift-bot `package.json`
- `docker-compose.yml` + `docker-compose.prod-npm.yml`

### Drift / gaps still open

| Item | Notes |
|---|---|
| Twenty app re-apply | If CRM chat front already installed on workspaces, re-apply after `chat-panel` bake |
| Root SSH | Password auth via `SSHPASS` only (no laptop key) — rotate to key. If `SSHPASS` is unset, `prod-deploy.sh` / `prod-diff.sh` read it from the macOS keychain (account `$(id -un)`, service `voxly-prod-ssh`), so non-interactive runs work without `~/.zshrc` |
| Hard Robokassa `ai_gramjs` | Soft trial only; SKU payment later |
| Robokassa cabinet `crmgetvoxly` | SHA256; Result POST `/api/billing/result`; Success/Fail GET; **live** Password#1/#2 in prod `.env`, `ROBOKASSA_IS_TEST=0` (2026-08-02) |

### Match update — GramJS (2026-07-23 ~16:10 MSK)

- `gramjs-bridge` running (`docker-gramjs-bridge-1`, `:3008`); `/health` ok.
- Prod `.env`: `TELEGRAM_API_*`, `ENCRYPTION_KEY`, `VOXLY_SERVICE_TOKEN`, `GRAMJS_BRIDGE_URL=http://gramjs-bridge:3008` (fixed from `:3010`), `OPENROUTER_API_KEY` present.
- Backup: `/opt/voxly/backups/20260723-130943/`.

### Deploy 2026-07-31 (admin partners + per-tenant referral rules)

- Services: `saas-api`, `saas-portal`.
- Backup `/opt/voxly/backups/20260731-131927/` (`voxly_control.dump`, `twenty.dump`).
- Control migrate: `20260731140000_referral_admin` applied via `docker exec -w /voxly/packages/db docker-saas-api-1 ./node_modules/.bin/prisma migrate deploy` (additive: `ReferralRule.tenantId`, `ReferralTransaction`, enum `ReferralTxKind`).
- `prod-diff saas-api,saas-portal` before deploy: all compared paths match.
- Smoke: `/`, API health, `/admin/partners`, `/admin/crm`, `/dashboard/crm`, `/dashboard/partners` **200**; `GET /api/admin/referrals` unauthenticated **401** (routes registered).

### Deploy 2026-07-23 (success)

- Backup `/opt/voxly/backups/20260723-122938/`; Conversation AI columns migrated on control DB.
- Smoke: portal + API health **200**.

### Deploy 2026-07-24 (INC-043 WA Contact-book phone + composer placeholder)

- Services: `ai-whatsapp-worker`, `saas-api` (crm-chat **0.1.2**).
- Backup `/opt/voxly/backups/20260724-121355/`.
- Smoke: portal + API health **200**; john Persons backfilled `+79150946944`.

### Deploy 2026-07-26 (INC-063 media + INC-064 prompt filter)

- Services: `saas-api` (crm-chat **0.1.9**), `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge`.
- Backup `/opt/voxly/backups/20260726-022902/`.
- Smoke: portal + API health + app healthz **200**; gramjs `/health` ok.

### Deploy 2026-07-26 (portal indigo shadcn ADR-020)

- Services: `saas-portal` (also restarted `saas-api` as compose dep).
- Backup `/opt/voxly/backups/20260726-200859/`.
- Theme: classic indigo primary `226.5 70.7% 40.2%`; dashboard/auth/legal restyle.
- Smoke: first script pass 404/502 (cold); then portal + API **200**; CSS contains indigo HSL.

### Deploy 2026-07-26 (CRM presence 0.1.8)

- Services: `saas-api`, `gramjs-bridge`, `ai-whatsapp-worker` (not `evolution-api`).
- Backup `/opt/voxly/backups/20260726-000817/`.
- Smoke: portal + API health **200**; john crm-chat **0.1.8+**.

### Deploy 2026-07-26 (Evolution v2.3.7-lid + WA worker)

- Services: `evolution-api`, `ai-whatsapp-worker`.
- Backup `/opt/voxly/backups/20260726-002454/`.
- Image: `voxly-evolution-api:v2.3.7-lid` (LID patch 150 files). Session restored without QR; webhook includes `PRESENCE_UPDATE`.
- Smoke: portal + API health **200**.

### Deploy 2026-07-26 (in-CRM «Рассылка» 0.1.17)

- Services: `saas-api` (crm-chat tarball **0.1.17** PAGE_LAYOUT + mailing-panel).
- Backup `/opt/voxly/backups/20260726-202005/`.
- refresh-crm-chat john/lexx/antontest/antontest3 → `{ok:true}`; john nav `Рассылка` = `PAGE_LAYOUT` (no portal mailing LINKs).
- Smoke: portal + API health **200**.

### Deploy 2026-07-26 (INC-063 media token maxParamLength + video_note AI)

- Services: `saas-api`, `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge` (crm-chat tarball **0.1.15**).
- Backup `/opt/voxly/backups/20260726-192410/`.
- Fix: Fastify `maxParamLength` + `/media/*`; ASR tagging/fallback; no «Секунду…» bubble.
- Smoke: portal + API health **200**; media Range **206** `video/mp4`; refresh-crm-chat → app **0.1.15**.

### Deploy 2026-07-26 (media 0.1.13 + unread shell-ux + workers)

- Services: `saas-api`, `twenty`, `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge` (crm-chat tarball **0.1.13**).
- Backup `/opt/voxly/backups/20260726-190111/`.
- Control migrate: `lastOperatorReadAt` already applied; `mailing_attribution` applied (schema only).
- Smoke: portal + API health + app healthz **200**; prod-diff match; refresh-crm-chat john/lexx/antontest/antontest3.

### Deploy 2026-07-26 (media 0.1.13 playback mime/Range)

- Services: `saas-api`, `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge` (tarball **0.1.13**).
- Backup `/opt/voxly/backups/20260726-185249/`.
- Smoke: portal + API health + app healthz **200**; media bad token **401**; john/lexx/antontest/antontest3 crm-chat refreshed.

### Deploy 2026-07-26 (media 0.1.11 + unread badges)

- Services: `saas-api`, `twenty`, `ai-telegram-worker`, `ai-whatsapp-worker`, `gramjs-bridge`.
- Backup `/opt/voxly/backups/20260726-182032/`.
- Control migrate: `conversation_last_operator_read` (+ 2 previously pending).
- Smoke: portal + API health + app healthz **200**; john/lexx/antontest/antontest3 crm-chat refreshed (tarball 0.1.11).

### Deploy 2026-07-24 (INC-039 WA media/typing/LID + INC-040 error map)

- Services: `saas-api`, `ai-whatsapp-worker` (crm-chat tarball via saas-api).
- Backup `/opt/voxly/backups/20260724-103450/`.
- Smoke: portal + API health + app healthz **200**.

### Deploy 2026-07-31 (partner balance + AI channels + billing fixes)

- Services: `saas-api`, `saas-portal`, `ai-telegram-worker`, `ai-whatsapp-worker`, `gift-bot-worker`.
- Backup `/opt/voxly/backups/20260731-151337/` (`voxly_control.dump` 279K + `twenty.dump` 2.4M).
- Control migrate: 4 migrations applied (`20260731170000` uncollectedRub + ReferralEarning unique paymentId, `20260731180000` productScope normalise, `20260731190000` AiUsageLog.channel, `20260731200000` ReferralWithdrawal + Payment.balanceAppliedRub + ReferralTxKind.redeem).
- Cold start: saas-api first boot hit `releaseStaleBalanceHolds` 30s timer before migration → P2022 Payment.balanceAppliedRub; container restarted after migration applied, clean.
- Smoke: `/`, API health, `/dashboard/partners`, `/dashboard/crm`, `/admin/partners`, `/dashboard/ai` — **200**. Logs clean after restart.

### Deploy 2026-08-03 (web form lead intake ADR-026)

- Services: `saas-api`, `saas-portal`.
- Backup `/opt/voxly/backups/20260803-122358/`.
- Control migrate: `20260803160000_form_lead_intake` (`FormWebhookEndpoint`, `FormLead`).
- Smoke: `/`, api/health(+body), `/dashboard/crm` **200**; `POST /api/webhooks/forms/…` → 404 unknown token; `/api/forms/endpoints` → 401 without JWT.

### Deploy 2026-08-06 (INC-103 GramJS send from Person.telegram + module freeze)

- Services: `saas-api`, `gramjs-bridge` (also earlier same-day: WA/TG/gift workers, portal for social/open-tg).
- Backup `/opt/voxly/backups/20260806-125415/` (+ `123456`, `102034`, `093403`, `090344`, `084234`, `082647`).
- Smoke: portal + API health **200**; `GET /open/tg/928954961` **200**; containers saas-api/gramjs/WA/gift Up.
- Code match: prod-diff hot paths for CRM/TG/WA matched before INC-103; post-deploy includes peer-from-LINKS + ImportContacts keepContact.

## Continue local work without breaking deploy

1. Feature only in git working tree / branch.
2. Verify on Colima (`localhost:3001/3002/3007`).
3. Do **not** ad-hoc rsync to VPS.
4. When ready: `prod-diff` → see what would change → `prod-deploy.sh --dry-run <svc>` → `prod-deploy.sh <svc>`.
5. Script backs up DBs, syncs whitelist, rebuilds, smokes HTTPS.
6. WORKLOG entry.

## What was checked in-repo (no VPS required)

- `scripts/prod-deploy.sh --dry-run` for `saas-portal`, `saas-api`, `twenty`, `compose` — exit 0
- Every path those dry-runs list **exists** locally
- Docs linked from `README.md`, `STACK.md`, `NPM-EDGE.md`, `steps.md` §4, cursor rule `prod-deploy-updates.mdc`

## What was **not** done

- Did **not** run a full live `prod-deploy.sh` of the new scripts themselves (scripts live on laptop; they push code to VPS).
- Did **not** auto-align the 3 drift files to prod (intentional — ship when you choose).
- Prod DB content ≠ local DB (by design).
