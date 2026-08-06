# AI agent (AiAgent + workers)

**Status: WORKING / FROZEN baseline 2026-08-06** (user-confirmed)

Surface: `CAPABILITIES.md` AI agents + ADR-014. Golden path: `CHAT.md`. Portal: `/dashboard/ai/agents`.

## Paths

- `apps/saas-portal/src/app/dashboard/ai/agents/page.tsx` + `ai-agents-portal-hero.tsx` — list/create/edit, SKU `ai_agent`, KB, won-deal examples, wallet top-up
- `apps/saas-api/src/routes/ai-agents.ts` — CRUD / assign / usage / knowledge / sales-examples
- `apps/ai-telegram-worker/` — TG Business + GramJS inbound LLM (reply only if AiAgent assigned)
- `apps/ai-whatsapp-worker/` — WA AI replies (same assign model; WA = golden timing/debounce)
- `packages/db` — `AiAgent`; `BotInstance.defaultAiAgentId`; Conversation `aiAgentId` override

## Contract (don’t break)

- **AI reply only if AiAgent assigned** (bot default or conversation override); null = AI off (ADR-014)
- Do not casually rewrite debounce / typing / bubble-gap timing (WA эталон in `CHAT.md`)
- Skip TG `is_bot`; WA skip groups/status/newsletter
- Default AI **OFF** until assigned — do not auto-enable on connect
- CRM chat AI toggle / pause must keep working (`/api/crm/chat/.../ai`)
- Media ASR/vision/docs path stays platform-default; fail → clear RU fallback
- Do not invent phones / `t.me/+phone`; Contact book ≠ deals source (WA sync card)
- Never wipe prod volumes when deploying workers

## Frozen paths

- Assign semantics: `PATCH /api/ai/agents/assign/bot/:botId` + conversation override
- Worker gate: no LLM without assigned agent
- Portal agents page SKU gate + usage/KB/sales-examples surface

## Incidents

- Related: INC-056 (TG Business `can_reply`); media family via workers; see `CHAT.md` / INCIDENTS for AI timing

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200
2. Portal `/dashboard/ai/agents` loads; create/list agents (or existing tenant agents visible)
3. Secretary or WA/GramJS bot with assigned agent: inbound gets AI reply; unassigned → no auto-reply
4. CRM chat AI toggle still present on a linked thread

## Last verified / deploy

- **2026-08-06:** user-confirmed working; tip deploy backup `20260806-132913` (+ INC-103 `20260806-125415`); PR #1 merged `263e4ef`
- Deploy: `./scripts/prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker` when AI surface changes
