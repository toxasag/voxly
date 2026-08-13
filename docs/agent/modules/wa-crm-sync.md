# WA → CRM sync (ai-whatsapp-worker + Evolution)

**Status: WORKING / FROZEN baseline 2026-08-07 ~16:14 MSK** (user-confirmed — WA CRM chat OK; do not casually break).  
Prior sync baseline 2026-08-06; chat media/widget harden INC-114…116 same day. Paired with MAX freeze (`max-personal.md`) + panel (`crm-chat-panel.md`).

Agents: **do not regress** the freeze checklist below unless the user **explicitly** asks. Prefer additive fixes. Freeze card before edits; smoke after.

Golden path detail: `docs/agent/CHAT.md` §2. Product surface: `CAPABILITIES.md` (WA private chat sync).

## Paths

- `apps/ai-whatsapp-worker/src/index.ts` — `runWhatsAppPrivateChatSync`, `resolveLidPhoneFromEvolution`, `buildWaProfilePnIndex`, `mergeWaLidPnTwinConversations`, `syncLeadToCrm`, `enrichTelegramPresenceFromPhone`, `sendWhatsAppMedia` (**pure base64**, INC-114)
- `apps/saas-api/src/routes/whatsapp.ts` — `POST …/sync-history` (default `messageLimit` **500**; manual only — no auto on QR/`CONNECTION_UPDATE`)
- `apps/saas-api/src/routes/crm-chat.ts` — WA reply/media; `findAttachmentContext` by owning conversation (INC-115)
- CRM panel: `twenty-app/voxly-crm-chat` ≥**0.1.28** (WA preview + widget `__typename` safe refresh, INC-115/116)
- `docker/evolution-api.Dockerfile` + `docker/patch-evolution-lid-pn.cjs` — image `voxly-evolution-api:v2.3.7-lid`; findChats/fetchProfile → `remoteJidAlt`/`senderPn` from lidMapping/Redis

## Freeze checklist (do not break)

| # | Behavior | Guard / note |
|---|---|---|
| 1 | **Outbound** text + photo + video + document from CRM → Evolution | `sendWhatsAppMedia` **pure base64** (not `data:` URI) + mime coerce (INC-114) |
| 2 | **Media previews** in CRM when Person has MAX+WA | Resolve bot/`fileId` by attachment-owning conversation — not busiest thread (INC-115) |
| 3 | **Chat widget loads** after `refresh-crm-chat` | `configuration.__typename = FrontComponentConfiguration` (INC-116); crm-chat **0.1.28** |
| 4 | History sync **button only** (no auto on QR / CONNECTION_UPDATE) | Portal + `POST …/sync-history` |
| 5 | Open private chats → Person/Opp; no empty «WhatsApp» shells; LID→PN honesty | INC-097 family; Contact book ≠ deals |

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
- `sendWhatsAppMedia` pure-base64 path (do not reintroduce `data:` URI)
- Multi-channel media resolve via `findAttachmentContext` (do not default to busiest thread)
- Do not casually refactor MAX / GramJS / gift when fixing WA reply path

## Incidents

- INC-114 — CRM→WA media «Owned media must be a url or base64» (data-URI vs pure base64)
- INC-115 — WA photo/video paperclip on Person with MAX+WA (wrong default bot)
- INC-116 — Chat «Нет данных» after refresh-crm-chat (missing `__typename`) — shared panel
- INC-097 (v6…v8.x) — empty shells / LID→PN honesty
- INC-100 — duplicate Opps on one Person
- INC-106 — WA→TG enrich early-return on scrape discarded userId (noname98)
- INC-059 — avatar twin phone invent
- INC-043 / INC-039 — Contact-book phone / media LID

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200 `ok`
2. Container `docker-ai-whatsapp-worker-1` + `docker-evolution-api-1` Up
3. CRM WA thread: outbound text + photo + video + document delivered
4. Person with MAX+WA: WA media preview (not paperclip); MAX thread still OK
5. Hard-refresh CRM → Chat widget loads (not «Нет данных»); tarball ≥ **0.1.28**
6. Portal `/dashboard/ai/whatsapp` → «Синхронизировать» — finishes without worker OOM; no `t.me/+` invent

## Last verified / deploy

- **2026-08-07 ~16:14 MSK (user-confirmed WORKING):** outbound text/photo/video/document; media previews with MAX+WA; Chat widget loads (crm-chat **0.1.28**). **Docs freeze only — no redeploy.** INC-114/115/116 closed with user confirmation.
- **2026-08-07 INC-115:** CRM WA media preview on multi-channel Person — resolve bot by attachment `fileId` (not busiest thread). Deploy `saas-api,ai-whatsapp-worker` backup `20260807-124124`. **max-bridge untouched.**
- **2026-08-07 INC-114:** CRM→WA outbound photo/video — Evolution needs **pure base64** (not `data:` URI). Deploy `ai-whatsapp-worker` backup `20260807-122920`. MAX untouched.
- **2026-08-07:** removed connect-time `scheduleWhatsAppHistorySync` (QR open + CONNECTION_UPDATE). History sync **button / `POST …/sync-history` only**; inbound live messages unchanged. Deploy: `ai-whatsapp-worker`.
- **2026-08-06 INC-106:** WA→TG enrich fix deployed (`ai-whatsapp-worker` + bridge/saas-api); backup `20260806-143720`; noname98→Оксана + open/tg. Core sync contract unchanged.
- Deploy: `./scripts/prod-deploy.sh ai-whatsapp-worker` (+ `saas-api` if routes/`twenty-client` changed; `compose`/`evolution-api` only if Dockerfile/patch changed). Never wipe volumes / Evolution sessions casually.
