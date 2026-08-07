# Cross-channel enrich + Opp chat activity

**Status: WORKING** (symmetric enrich + Opp.updatedAt bump 2026-08-06) — supporting freeze; do not invent social URLs.

Surface: CHAT.md §7; CAPABILITIES «Cross-channel enrich» + admin sync-opportunity-chat-activity.

## Paths

- Hub: `apps/saas-api/src/services/enrich-person-by-phone.ts` — `enrichPersonCrossChannelByPhone`, TG/MAX/WA IsOnWhatsApp
- Internal: `POST /api/internal/crm/enrich-by-phone`; WA worker `POST /internal/crm/check-on-whatsapp`
- Admin: `POST /api/admin/tenants/:id/enrich-persons-by-phone` (+ platform all-tenants variants where present)
- Writers / callers: form-lead (`processFormLead`), `max-internal` / `max-chat-sync`, `gramjs-chat-sync`, ai-telegram-worker, gift contact-share, WA inbound (local TG+MAX)
- Social writers: `TwentyClient.applyTelegramProfile` / `applyMaxProfile` / whatsapp LINKS
- Open links: `apps/saas-api/src/routes/open-tg.ts`, `open-max.ts` (`maxOpenLink` when no public max.ru)
- Opp activity: `TwentyClient.touchOpportunityActivity`; `apps/saas-api/src/services/sync-opportunity-chat-activity.ts`; live bumps WA/TG/MAX sync + crm-chat reply
- Admin backfill Opp: `POST /api/admin/tenants/:id/sync-opportunity-chat-activity` + `POST /api/admin/sync-opportunity-chat-activity`

## Contract (don’t break)

- **Never** invent `t.me/+phone` or `max.ru/+phone`
- `wa.me` **only** when Evolution IsOnWhatsApp reports `exists` (or known inbound WA identity)
- MAX: real `max.ru/…` **or** `https://api.getvoxly.ru/open/max/{userId}` when id known without public link
- TG: `@username` → t.me; else `/open/tg/{userId}` — see `person-social-links.md`
- Name enrich only replaces `nonameN` / empty / probe (INC-106)
- Opportunity.updatedAt bumped on chat activity (Kanban «Последнее обновление»)
- Soft-merge / Opp reuse still via deal-dedupe + sync paths — enrich does not create duplicate open deals by design

## Frozen paths

- Decision table: invent-never for phone→URL
- IsOnWhatsApp gate for wa.me from non-WA channels
- `open/max` + `open/tg` public routes

## Incidents

- INC-106 — WA→TG enrich scrape / noname
- INC-107 — Social field order (Telegram→WhatsApp→MAX) drift; reapply JWT; SQL + twenty recreate
- INC-102 — open/tg without @username
- Related: INC-044 phone cross-channel Person merge

## Smoke (~1–2 min)

1. Site form-lead with phone (sessions connected) → Person may gain TG/MAX/wa.me without inventing +.
2. `curl -sS -o /dev/null -w '%{http_code}\n' https://api.getvoxly.ru/open/max/3361844` → 200 (or known id).
3. Inbound chat → Opp moves up by «Последнее обновление» (or admin sync updates `updatedAt`).
4. No Person telegram/max = `t.me/+7…` / `max.ru/+7…`.

## Deploy services

`./scripts/prod-deploy.sh saas-api` (+ `ai-whatsapp-worker`, `ai-telegram-worker`, `gift-bot-worker`, `max-bridge`, `gramjs-bridge` if those callers changed). Volumes untouched.

## New vs existing portals

| | New | Existing |
|---|---|---|
| Runtime enrich | shared code — works on next lead with phone + sessions | same |
| Social layout | provision `ensureSocialFields` order | may need reapply / INC-107 SQL if System group |
| Old Persons without links | — | `enrich-persons-by-phone` |
| Old Opps Kanban order | live bump from first new message | `sync-opportunity-chat-activity` (per tenant or all) |

## Last verified / deploy

- **2026-08-07** — card added (agent memory). Prior ops 2026-08-06: enrich backup `20260806-160936`; Opp activity `20260806-163110`; open/max 200.
