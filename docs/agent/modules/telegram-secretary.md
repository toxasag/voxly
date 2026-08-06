# Telegram secretary (Телеграм Секретарь)

**Status: WORKING / FROZEN baseline 2026-08-06** (user-confirmed)

Surface: `CAPABILITIES.md` `/dashboard/ai` + `ai_tg` Business bots. ADR-014. Worker: `ai-telegram-worker`. Gift webhook may forward `ai_tg` → worker.

## Paths

- `apps/saas-portal/src/app/dashboard/ai/page.tsx` — **TelegramSecretaryPageInner**; `?bot=`
- `apps/saas-portal/src/components/portal/ai-secretary-hero.tsx`
- `apps/saas-api/src/routes/bots.ts` — `ai/start-trial`, `ai/connect`, Business accounts, unlink, agent assign, dialogs/handoff
- `apps/ai-telegram-worker/src/index.ts` — Business webhook inbound + AI (if agent assigned)
- `apps/gift-bot-worker` `/tg` — if `botType === 'ai_tg'` → forward to `ai-telegram-worker:3005`

## Contract (don’t break)

- Page is **Telegram Secretary only** — not all-channels overview, not AI wallet top-up (that lives under `/dashboard/ai/agents`)
- SKU `ai_tg` 1000₽/10 акк; extra conn `ai_tg_extra_conn`; BotFather token connect
- Business accounts + unlink + agent assignment + dialogs/handoff stay
- AI replies only when AiAgent assigned (see `ai-agent.md`); default AI OFF
- TG Business needs «Отвечать на сообщения» (`can_reply`) or outbound fails (INC-056)
- Social open link ≠ chat send; never invent `t.me/+phone`
- Gift «Пишем от» only for subscribers on that bot (crm-chat contract)
- Never wipe prod volumes

## Frozen paths

- `/dashboard/ai` secretary page scope + hero messaging (trial/paid state)
- `ai_tg` connect / Business account management APIs
- Forward path gift-bot → ai-telegram-worker for `ai_tg`

## Incidents

- INC-056 — Business `can_reply` required for replies
- Related: ADR-014 assign model; media/ASR on ai-telegram-worker

## Smoke (~1–2 min)

1. Portal `/dashboard/ai` loads secretary UI (hero + bot connect / accounts)
2. Connected Business bot listed; agent assign control works
3. `docker-ai-telegram-worker-1` Up; API health 200
4. Optional: inbound Business message → CRM thread; AI only if agent assigned

## Last verified / deploy

- **2026-08-06:** user-confirmed working; tip deploy backup `20260806-132913` included `ai-telegram-worker` + `saas-portal`; PR #1 `263e4ef`
- Deploy: `./scripts/prod-deploy.sh saas-portal,saas-api,ai-telegram-worker` (+ `gift-bot-worker` if webhook forward touched)
