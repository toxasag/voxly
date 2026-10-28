# GETVOXLY — Action Plan Tracker

> Срез: 2026-10-27. Статусы `[x]` выставлены только по фактически выполненным проверкам. `[!]` — подтверждённый риск/блокер. `[ ]` — не закрыто.

> **Обновление текущей итерации:** RLS smoke harness расширен проверкой обеих тестовых арендаторов и parent-scoped `invoice_items`. Запуск изолированной БД в этой среде невозможен: отсутствуют локальный PostgreSQL runtime (`pg_isready` не найден) и `.audit/runtime.json`. Поэтому P0 не отмечен выполненным; кодовая проверка прошла.

## Evidence baseline

- Local HEAD: `52bc3b9 Fix tenant portal redirect loop and session desync`.
- Production endpoints: `https://getvoxly.ru/`, `https://getvoxly.ru/login`, `https://api.getvoxly.ru/health` — HTTP 200 на проверке 2026-10-27.
- Production containers: backend/frontend/db healthy, restart count 0.
- Production DB: 53 migrations, latest `0053_deal_analytics_tab`.
- Production data snapshot: `channel_accounts=11`, `ai_agents=2`, `deals=19`, `deal_messages=149`, `analytics_integrations=0`, `tenant_notification_channels=0`.
- Production log snapshot: 3 Telegram `TIMEOUT` за последние 24 часа; 5 frontend `Server Reference ID ... Received "x"` errors; 12 WhatsApp webhook POSTs.
- Local typecheck/test commands were attempted, but local `node_modules` are absent: backend/frontend typecheck fail with missing modules; Vitest exits `127: vitest not found`. This is an environment/reproducibility failure, not a valid code-green result.

## Status summary

- [x] Product scope identified: modular multi-tenant CRM for service businesses with CRM, service center, finance, communications, AI and attribution.
- [x] Production availability verified by external HTTP and SSH read-only inspection.
- [x] RLS role verified: `app_user` is `NOSUPERUSER` and `NOBYPASSRLS`.
- [x] Migration state verified: 53 applied migrations.
- [!] RLS inventory is not fully compliant with the stated universal rule: production reports 39 public tables with RLS and 38 with FORCE; 9 public tables have no `tenant_id` (some are intentional reference/auth tables, but this must be explicit and tested).
- [!] Production analytics is not configured for any tenant (`analytics_integrations=0`).
- [!] Production lead notification channels are empty (`tenant_notification_channels=0`).
- [!] Telegram transport produced 3 timeouts/24h.
- [!] Frontend produced 5 malformed Next Server Reference ID errors/24h.
- [!] Local verification is currently non-reproducible because dependencies are not installed.

## P0 — release blockers

### Database & RLS

- [ ] Produce an automated RLS audit that fails CI when a business table lacks `tenant_id NOT NULL`, RLS, FORCE, policy, or tenant-safe foreign keys.
  - Acceptance: audit output classifies intentional exceptions (`tenants`, auth/session and platform catalog tables) and fails on unexplained exceptions.
- [ ] Verify every `USING`/`WITH CHECK` policy after migration 0053, including billing, analytics, notification and junction tables.
  - Acceptance: two-tenant SQL test proves cross-tenant SELECT=0 and cross-tenant INSERT/UPDATE/DELETE denied under `app_user`.
  - Update 2026-10-28: migration `0058_force_notification_channels_rls.sql` deployed and `tenant_notification_channels.relforcerowsecurity = true` verified in production. Full RLS audit still fails on tenant-unsafe foreign-key findings and needs classification/migration.
- [ ] Verify `stages` and other tables without `tenant_id` have an explicit parent-scope isolation contract.
  - Acceptance: no route can access a stage/pipeline from another tenant through an unscoped ID.

### Fastify / Channels / Security

- [!] Production deploy blocked by missing `EVOLUTION_WEBHOOK_SECRET`: new fail-closed backend correctly refuses to boot while Evolution is configured without its secret. Previous backend image restored and health verified. Provision secret on VPS before retry.
- [x] Replace public `/uploads/:filename` access with tenant-bound authorization or short-lived signed URLs.
  - Acceptance: tenant A cannot fetch tenant B media; CRM media is not publicly cacheable. Реализована авторизация access-token, проверка tenant-префикса имени файла и `private, no-store`.
- [ ] Remove any production default secret fallback from `docker-compose.yml`, especially Evolution API credentials.
  - Acceptance: missing secret prevents production boot; no literal secret remains in compose.

### Lead delivery / money / attribution

- [ ] Replace `lead_notified_at` pre-claim with durable delivery ledger/outbox.
  - Acceptance: failed SMTP/Telegram/WhatsApp delivery remains retryable; successful delivery is idempotent.
- [ ] Implement the WhatsApp lead notification provider instead of log-only dispatch.
  - Acceptance: provider response is persisted and visible in admin diagnostics.
- [ ] Add durable conversion delivery attempts and retryable provider failures.
  - Acceptance: every conversion has tenant/deal/provider/event/status/attempts/last_error.

## P1 — next stabilization release

### Database & RLS

- [x] Исправить регрессии write-first outbound и stories publish tests; целевые тесты 6/6 проходят.
- [ ] Replace content+time dedupe in CRM pipeline with provider IDs; preserve fallback only for legacy events.
- [ ] Add migration restore rehearsal from the current production dump into an isolated database.

### Fastify Backend

- [ ] Install dependencies from lockfiles in CI with `npm ci` and run backend `typecheck`, `test`, `build`, lint.
- [ ] Replace the generic in-memory `backend/src/infrastructure/queue.ts` with BullMQ-backed durable queues or explicitly restrict it to test/dev.
- [ ] Remove silent in-memory fallback for business-critical lead/conversion/AI usage jobs in production.
- [ ] Add queue health metrics: Redis connectivity, waiting/active/failed/delayed counts, oldest job age.
- [ ] Add request/job/provider correlation IDs to Telegram, WhatsApp, lead and conversion logs.
- [ ] Add Telegram transport reconnect/resync and a health state for degraded accounts after update-loop timeout.
- [ ] Make AI handoff fail safe: DB uncertainty must result in `operator_needed`, not an AI reply.

### Frontend / Next.js

- [ ] Reproduce and fix malformed Server Action/RSC requests producing `Received "x"` in production.
  - Acceptance: zero such errors in a 24-hour canary window; logs include route, user-agent and request ID.
- [ ] Add root `loading.tsx`, `error.tsx` and `not-found.tsx` recovery boundaries where absent.
- [ ] Install dependencies and obtain a real frontend typecheck/test/build result.
- [ ] Add browser E2E for register/login → tenant portal → CRM record → chat → AI bot → logout.
- [ ] Audit client cache reset on tenant switch/impersonation.
- [ ] Remove unused production mock modules or move them to test fixtures; keep test mocks isolated.

### AI Module

- [ ] Verify production AI agents have configured channel bindings, model, prompt, knowledge documents and usage accounting.
- [ ] Add E2E: inbound webchat → RAG answer → CRM message → AI usage charge → handoff/pause.
- [ ] Add provider timeout, retry, stale-response cancellation and token budget metrics.
- [ ] Complete voice/media support or explicitly mark unsupported input types in UI.
- [ ] Make site/map crawler SSRF-safe across DNS resolution and redirects.

### DevOps & Production

- [ ] Add OCI image labels with git revision, build timestamp and release ID.
- [ ] Store a release manifest mapping source SHA → image digest → migrations → health evidence.
- [ ] Verify Redis connectivity and BullMQ queue state directly on VPS without exposing secrets.
- [ ] Add alerting for Telegram timeout rate, webhook 4xx/5xx, failed jobs, missing lead notifications and conversion failures.
- [ ] Add sanitized hourly production error report.

## P2 — product completion and optimization

### Core CRM / Service Center / Finance

- [ ] Validate complete service-center lifecycle: intake → diagnostics → works/parts → invoice → payment → delivered/rejected.
- [ ] Validate finance reconciliation, invoice numbering concurrency, payment webhook replay and entitlement state.
- [ ] Add owner-facing operational counters: new leads, qualified leads, notification delivery, SLA age, channel health.

### Analytics

- [ ] Define one canonical attribution contract instead of mixed `ga_id`, `ga_client_id`, `client_id`, `ym_uid` and custom-field variants.
- [ ] Add first-touch/last-touch provenance and unmatched-conversion reporting.
- [ ] Configure at least one production analytics provider in a controlled tenant and run `deal → won → provider event` acceptance.

### UX

- [ ] Validate 360/767/768/1280 widths, keyboard navigation, focus, overlays and nested relation controls.
- [ ] Remove emoji from non-message UI; document an explicit exception only for a composer emoji picker if product requires it.
- [ ] Add empty/loading/error states to every module route and verify no blank tables.

## Product definition of done

- [ ] A tenant can register, authenticate, configure a channel and AI agent, receive a lead, see contact/deal attribution, get a reliable notification, reply from CRM, pause AI after human response, close the deal, and deliver a verified conversion event.
- [ ] A platform owner can inspect tenant health, queue health, delivery failures, conversion status and audit trail without accessing another tenant's data outside explicit platform scope.
- [!] Production release currently remains on the pre-change backend image after safe rollback; health gate passed, but local webhook hardening is not live.
