# Module freeze cards

Lean per-module status so future work does **not** break working surfaces.

**Baseline 2026-08-06 (user-confirmed):** chats, WhatsApp, Telegram GramJS, gift bot, AI agent, Telegram secretary are **WORKING / FROZEN**. Do not change their product behavior unless the user explicitly asks. Other modules may proceed without regressing this set.

## Before editing a module

1. Read this index → open the module’s freeze card below.
2. Skim `docs/agent/CAPABILITIES.md` (and `CHAT.md` for chat/WA/TG/GramJS/AI).
3. Touch only what the task needs; respect **Contract** + **Frozen paths**. Do not “improve” or simplify frozen surfaces casually.
4. After changes: run the card’s **Smoke** (~1–2 min). If green, update **Last verified / deploy** on that card + append `WORKLOG.md` when significant.

Deploy always via `./scripts/prod-deploy.sh` (see `DEPLOY.md`). **Never** wipe volumes (`docker compose down -v` forbidden on prod).

Cross-cutting (all cards): social TG link ≠ chat send; gift only for subscribers; never invent `t.me/+phone`; Contact book ≠ deals source.

## Cards — WORKING / FROZEN baseline 2026-08-06

| Module | File | Status | Surface |
|---|---|---|---|
| CRM chat panel | [`crm-chat-panel.md`](crm-chat-panel.md) | **WORKING** | voxly-crm-chat + `/api/crm/chat` |
| WA → CRM sync | [`wa-crm-sync.md`](wa-crm-sync.md) | **WORKING** | ai-whatsapp-worker + Evolution LID |
| GramJS / TG personal → CRM | [`gramjs-crm-sync.md`](gramjs-crm-sync.md) | **WORKING** | bridge + sync + portal `historySyncing` |
| Gift bot | [`gift-bot.md`](gift-bot.md) | **WORKING** | ADR-027 portal + gift-bot-worker |
| AI agent | [`ai-agent.md`](ai-agent.md) | **WORKING** | AiAgent + ai-telegram/whatsapp workers |
| Telegram secretary | [`telegram-secretary.md`](telegram-secretary.md) | **WORKING** | `/dashboard/ai` + `ai_tg` Business |

## Supporting cards (also freeze before edit)

| Module | File | Surface |
|---|---|---|
| Person social links | [`person-social-links.md`](person-social-links.md) | LINKS URLs + `/open/tg/{id}` |
| Deal / Opp dedupe | [`deal-dedupe.md`](deal-dedupe.md) | save-time soft-merge + Opp reuse |

## Card template (keep lean)

```md
# <Name>

**Status: WORKING / FROZEN baseline YYYY-MM-DD** (user-confirmed)  <!-- when locked -->

## Paths
## Contract (don’t break)
## Frozen paths
## Incidents
## Smoke (~1–2 min)
## Last verified / deploy
```
