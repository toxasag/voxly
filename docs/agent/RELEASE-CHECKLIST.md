# Release & client-acceptance checklist (Voxly)

Automated coverage grows under `pnpm verify` / `.github/workflows/ci.yml`. This document is the go/no-go gate for a release and for accepting a deployment at a client.

Target audience for the product: Telegram mass-looker / commenter / DM-outreach operators. Core surfaces: `/dashboard/partners`, `/dashboard/crm`, `/dashboard/ai` (Телеграм Секретарь), `/dashboard/ai/agents`.

## Environments

| Contour | Role |
|---|---|
| Local `docker-compose` + `voxly_test` | Money, RBAC, status, integration degradation tests |
| Prod (after `./scripts/prod-deploy.sh`) | Read-only HTTP smoke + `/api/admin/health` review |
| Staging | **Not required** until client data volume forces it |

```bash
pnpm test:db          # create/migrate/seed voxly_test
pnpm verify           # typecheck + unit/integration + portal lint
pnpm test:e2e         # Playwright (needs portal+API up; or SKIP_E2E=1)
```

## 1. Functional completeness

**Automated:** Playwright cabinet smoke (`apps/saas-portal/e2e`), API happy-path tests for trial/checkout/agents.

**Manual before release:**
- [ ] Partners: create campaign with unique code, add expense, request withdrawal, cancel withdrawal
- [ ] CRM: see trial/active/grace clearly; checkout with seats; invite member
- [ ] Телеграм Секретарь: trial badge + days left; connect bot; assign agent; handoff dialog to human
- [ ] AI agents: create blocked without slot (402); buy slot; top up wallet; channel spend table

## 2. Business-process logic (status models)

**Automated:** `evaluateCrmAccess` matrix (`status-transitions.test.ts`), one-shot trials (`trial-consumed.test.ts`), payment status claim + OutSum check.

**Manual:**
- [ ] Trial → expire → pay → active (ai_tg and CRM)
- [ ] Paid → grace → locked; CRM chat blocked with clear 402 copy
- [ ] Withdrawal: pending → paid / rejected; balance moves once

## 3. Integration connectivity

**Automated:** bad Robokassa signature rejected; GramJS/WA unreachable → controlled 4xx/503 (`integrations-degradation.test.ts`).

**Manual / client:**
- [ ] Robokassa ResultURL in test mode completes a real invoice
- [ ] Twenty workspace opens via «Открыть CRM»
- [ ] TG Business account connects; inbound message creates CRM person/opportunity
- [ ] WhatsApp QR pairs; GramJS QR + 2FA
- [ ] **Account ban / disconnect mid-flight:** suspend bot → conversations still listed; reconnect does not double-charge wallet

## 4. Performance

**Automated:** `findmany-guards.test.ts` (hot queries must keep `take`); optional `pnpm perf:seed`.

**Manual / ops:**
- [ ] `/api/admin/health` queue depths and DB ping healthy after deploy
- [ ] Partner dashboard and AI agents page load < 3s with production-like data
- [ ] No OOM on broadcast audience for largest tenant

## 5. Security & tenant isolation (RBAC)

**Automated:** cross-tenant agent PATCH denied; OutSum mismatch rejected; scheduler Redis lock.

**Manual:**
- [ ] Member cannot invite/delete owners or start trials
- [ ] Superadmin impersonation leaves audit trail
- [ ] Service token without matching workspace header cannot read foreign chats

## 6. Unit economics

**Automated:** markup invariants (`packages/ai-core/tests/unit-economics.test.ts`); `pnpm report:unit-econ -- --days 30`.

**Manual / product:**
- [ ] AI chargedRub ≥ providerCostRub for sampled logs
- [ ] `ai_topup` never creates `ReferralEarning`
- [ ] Cost per handled dialog (by channel) acceptable vs plan price
- [ ] Partner payout share of revenue within policy

## 7. Scalability / segment configurability

**Automated:** prices/limits sourced from `@voxly/shared` (`configurability.test.ts`).

**Manual:**
- [ ] New price or trial length changeable via `PRICING` / `PlatformSetting` without rewriting portal pages
- [ ] Per-tenant referral rule override works in `/admin/partners`

## Go / no-go

**GO** only if:
1. `pnpm verify` green (or CI green on the release commit)
2. `./scripts/prod-deploy.sh` smoke green (landing, API health body, four cabinet URLs)
3. No open P0 in money paths (webhook, wallet, balance hold)
4. Manual §1–§3 checks for the release scope are ticked

**NO-GO** if: OutSum bypass, double webhook credit, cross-tenant data leak, or trial renew without payment.

## Client acceptance (post-implement)

1. Owner logs in → sees partners + CRM + secretary + agents.
2. Starts ai_tg trial once; second attempt refused with clear copy.
3. Connects at least one channel; AI replies while wallet > 0; hands off when paused/empty.
4. Pays CRM or AI invoice via Robokassa (or balance); invoice appears as paid once.
5. Creates referral link; registration attributes; earning rules match admin setting.
6. Signs off that Telegram disconnect does not erase CRM history.
