# Module freeze cards

Lean per-module status so future work does **not** break working surfaces.

## Before editing a module

1. Read this index → open the module’s freeze card below.
2. Skim `docs/agent/CAPABILITIES.md` (and `CHAT.md` for chat/WA/TG/GramJS).
3. Touch only what the task needs; respect **Contract** + **Frozen paths**.
4. After changes: run the card’s **Smoke** (~1–2 min). If green, update **Last verified / deploy** on that card + append `WORKLOG.md` when significant.

Deploy always via `./scripts/prod-deploy.sh` (see `DEPLOY.md`). Never wipe volumes.

## Cards

| Module | File | Surface |
|---|---|---|
| WA → CRM sync | [`wa-crm-sync.md`](wa-crm-sync.md) | ai-whatsapp-worker + Evolution LID |
| GramJS / TG personal → CRM | [`gramjs-crm-sync.md`](gramjs-crm-sync.md) | bridge + sync + portal `historySyncing` |
| CRM chat panel | [`crm-chat-panel.md`](crm-chat-panel.md) | voxly-crm-chat + `/api/crm/chat` |
| Person social links | [`person-social-links.md`](person-social-links.md) | LINKS URLs + `/open/tg/{id}` |
| Gift-bot setup UX | [`gift-bot.md`](gift-bot.md) | ADR-027 portal + worker |
| Deal / Opp dedupe | [`deal-dedupe.md`](deal-dedupe.md) | save-time soft-merge + Opp reuse |

## Card template (keep lean)

```md
# <Name>

## Paths
## Contract (don’t break)
## Frozen paths
## Incidents
## Smoke (~1–2 min)
## Last verified / deploy
```
