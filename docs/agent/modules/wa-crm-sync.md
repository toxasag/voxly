# WA → CRM sync (ai-whatsapp-worker + Evolution)

**Status: WORKING / FROZEN baseline 2026-08-06** (user-confirmed)

Golden path detail: `docs/agent/CHAT.md` §2. Product surface: `CAPABILITIES.md` (WA private chat sync).

## Paths

- `apps/ai-whatsapp-worker/src/index.ts` — `runWhatsAppPrivateChatSync`, `resolveLidPhoneFromEvolution`, `buildWaProfilePnIndex`, `mergeWaLidPnTwinConversations`, `syncLeadToCrm`, `enrichTelegramPresenceFromPhone`
- `apps/saas-api/src/routes/whatsapp.ts` — `POST …/sync-history` (default `messageLimit` **500**)
- `docker/evolution-api.Dockerfile` + `docker/patch-evolution-lid-pn.cjs` — image `voxly-evolution-api:v2.3.7-lid`; findChats/fetchProfile → `remoteJidAlt`/`senderPn` from lidMapping/Redis

## Contract (don’t break)

- Deals = **open private** `findChats` **with messages**; Contact book = **enrich only** (not dialog source)
- Always Person + open Opportunity (`nonameN` if no name); title `{seq} · WA · {bot.displayName}`
- Phone → Person.phones + whatsapp when Evolution/mapping gives E.164 — **never invent** from avatar/pushName (INC-059)
- After phone: GramJS ImportContacts → telegram LINKS + name/birthday when better than `nonameN` (INC-106); never apply probe `Voxly`/`Check`; never invent `t.me/+phone`
- LID↔PN twin Conversations merge; reuse open Opp on Person before create (INC-100)
- Groups/self/status/newsletter skipped; no `t.me/+{phone}`; `suppressDealCreation` **manual only**
- Profile-index/repair scoped to open findChats (no contact-book OOM)
- Lead sync **before** ASR/vision enrich (INC-068)

## Frozen paths

- `resolveLidPhoneFromEvolution` order / honesty rules (do not add inventing fallbacks)
- Evolution Dockerfile + `patch-evolution-lid-pn.cjs` (LID send bypass + PN expose)
- Contact-book-as-deals = **forbidden** regression

## Incidents

- INC-097 (v6…v8.x) — empty shells / LID→PN honesty
- INC-100 — duplicate Opps on one Person
- INC-106 — WA→TG enrich early-return on scrape discarded userId (noname98)
- INC-059 — avatar twin phone invent
- INC-043 / INC-039 — Contact-book phone / media LID

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200 `ok`
2. Container `docker-ai-whatsapp-worker-1` + `docker-evolution-api-1` Up
3. Portal `/dashboard/ai/whatsapp` → «Синхронизировать» (or `POST …/sync-history`) — finishes without worker OOM
4. Spot: Person with known PN has phones+whatsapp; no `t.me/+` on Telegram link

## Last verified / deploy

- **2026-08-06 INC-106:** WA→TG enrich fix deployed (`ai-whatsapp-worker` + bridge/saas-api); backup `20260806-143720`; noname98→Оксана + open/tg. Core sync contract unchanged.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` (+ `saas-api` if routes/`twenty-client` changed; `compose`/`evolution-api` only if Dockerfile/patch changed). Never wipe volumes / Evolution sessions casually.
