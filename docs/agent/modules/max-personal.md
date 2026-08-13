# MAX personal (`ai_max`)

**Status: WORKING / FROZEN baseline 2026-08-07 ~16:14 MSK** (user-confirmed — MAX CRM chat OK; do not casually break).  
Prior: login INC-104/105 + history sync + phone enrich 2026-08-06; media/read INC-109–112; channel/self leak INC-113; paired with WA CRM chat freeze same day (INC-114…116).

Agents: **do not regress** the freeze checklist below unless the user **explicitly** asks. Prefer additive fixes. Freeze card before edits; smoke after.

## Paths

- Portal: `apps/saas-portal/src/app/dashboard/ai/max/page.tsx`
- Proxy: `apps/saas-api/src/routes/max.ts` (JWT → bridge) + `POST …/sync-history`
- Sync: `apps/saas-api/src/services/max-chat-sync.ts`
- Bridge: `apps/max-bridge/src/main.py` — `/crm/private-dialogs`, `/users/by-phone`, QR, send, inbound listener
- Enrich: `apps/saas-api/src/services/enrich-person-by-phone.ts` + `TwentyClient.applyMaxProfile`
- Owner-phone guard: `apps/saas-api/src/services/max-phone-guard.ts` (+ vitest `apps/saas-api/tests/max-phone-guard.test.ts`)
- Internal: `apps/saas-api/src/routes/max-internal.ts` (live inbound)
- CRM reply: `crm-chat.ts` → `sendViaMaxBridge` (text + media)
- Media: bridge `/messages/media` + inbound `attaches`; read: `/messages/read`

## PyMax (maxapi-python) — what we use

Pinned/prod: **2.4.0** (`requirements`: `>=2.3.0`). Docs: [PyMax](https://github.com/MaxApiTeam/PyMax), [docs.pymax.org](https://docs.pymax.org/).

| Capability | API | Our use |
|---|---|---|
| Phone → user | `search_by_phone("+7…")` + `import_contacts([ContactInfo])` | Bridge `POST /users/by-phone` → Person name + `max` LINKS |
| Profile fields | `User.names`, `User.link`, `User.phone`, `User.description` | name / max.ru link / phone (if matches) / about |
| Birthday | **not on User** in 2.3–2.4 | Leave empty — honest gap |
| Chats | `fetch_chats(marker=)` + cache `client.chats` | History sync dialog list |
| History | `fetch_history(chat_id=, backward=)` | ×30 msgs; `platformUserId` = **chat id**; attachments when present |
| Peer profile | `get_user(id)` | Dialog name/phone/link during sync |
| Inbound media | `message.attaches` + `get_file_by_id` / `get_video_by_id` / photo `base_url` | CRM attachments `max:{chat}:{mid}:{kind}:{id}` |
| Outbound media | `send_message(..., attachments=[Photo\|File\|Video\|Voice])` | CRM 📎 |
| Read | `read_message(message_id, chat_id)` | CRM open/reply → native read |
| Typing (send) | **not exposed** (`MSG_TYPING` opcode only; `on_typing` receive-only) | Unsupported — do not fake |

**Cannot / must not:** invent `max.ru/+{phone}` or `t.me/+{phone}`; treat Contact book as dialog source; casually refactor gift MAX Bot API; reuse MAX `platformUserId` as GramJS peer (INC-109).

## Freeze checklist (do not break)

| # | Behavior | Guard / note |
|---|---|---|
| 1 | **Inbound personal DMs** → Conversation + ChatMessage + Person/Opp | Live `on_msg` + `/api/internal/max/inbound` |
| 2 | **Inbound media** photo/video/voice/circle/sticker/PDF → CRM attachments + player where MIME allows | Bridge attaches + Chrome UA for okcdn (INC-110) |
| 3 | **Outbound** text + file + video from CRM chat | `sendViaMaxBridge`; session-auth retry (INC-111); `:out` resolve (INC-112) |
| 3b | **Attach button (📎)** in CRM composer for MAX | Shared crm-chat panel; media via bridge `/messages/media` |
| 4 | **Read receipts** on CRM open/reply | Bridge `/messages/read` |
| 5 | **No CHANNEL / CHAT / negative-id leads** | Bridge + saas-api reject non-DIALOG |
| 6 | **No bot leads** | `_is_bot_user` heuristic on peer |
| 7 | **Skip-me** | Unwrap `me.contact` (not `me.id` alone); skip `sender == me` |
| 8 | **No owner-profile leak** onto peer Person | Never forward `me` phone; pass `selfPhone`; `stripOwnerPhone`; enrich `forbidPhones`; `applyMaxProfile` phone **fill-empty** only |
| 9 | **`/open/max` = peer user id** | `maxUserId` / dialog `userId` — **not** chat id (chat_id ≠ user_id) |
| 10 | History sync **button only** (no auto on connect) | Portal + `POST …/sync-history` |
| 11 | Typing send | **N/A** — do not fake |

## Contract (don’t break)

- Browser never talks to max-bridge; always `/api/bots/max/*` + service token.
- Soft trial/billing `ai_max` gates QR start.
- Account **name** is a Voxly label only (phone as name is fine).
- PyMax `WebClient.start()` **never returns** until disconnect — wait `on_start`, then upsert/`authorized`, keep `start` task alive.
- Wipe `pending-{tenant}-{name}` session dir on each new QR (stale → `FAIL_LOGIN_TOKEN`).
- 2FA wrong password → status back to `waiting_password` + clear error (not stuck on `processing_password`).
- **History sync:** only `ChatType.DIALOG` with messages; skip groups/channels/empty/negative ids/bots; `platformUserId` = **chat id** (send/read); profile `/open/max` = **peer user id** (`maxUserId` / dialog `userId`); reuse open Opportunity per Person; honor `suppressDealCreation`; message id `max:{id}`; default ×30 msgs; long job → 202 + `historySyncing` on GET accounts; bridge returns `selfPhone`/`selfMaxUserId` for saas-api strip.
- **Live inbound:** same private-only gate; never forward connected-account phone onto peer; pass `maxUserId`+`chatType`+`selfPhone`.
- Sync fields: peer name/phone/link (if PyMax `get_user`), message text + attachments, direction from `sender == me`. Phone via `applyMaxProfile` fill-empty — **never** direct `updatePersonPhone` overwrite.
- **Phone enrich:** admin `POST …/enrich-persons-by-phone` tries TG + MAX when sessions exist; `Person.max` only when API returns real `max.ru` link; name only replaces `nonameN`/empty/probe; never invent `max.ru/+{phone}`.
- Cross-channel «Пишем от» GramJS from MAX card: Person.telegram @/userId + phone ImportContacts — never MAX chat id as TG peer.
- PyMax `client.me` is often a **wrapper** — real User on `.contact` (skip-self / upsert `phoneNumberId`).

## Frozen paths

- Do **not** casually refactor gift-bot MAX Bot API (`gift_max` / `max-handler.ts`) when fixing personal.
- Do not touch WA / GramJS / crm-chat / AI agent / secretary unless required for MAX reply path.
- Do not remove channel/self/owner-phone guards or switch `/open/max` back to chat id.

## Incidents

- INC-104 — stuck «Проверяем пароль…» (`await start()` hang)
- INC-105 — upsert 400 `maxUserId` null (Zod optional ≠ nullish)
- INC-106 — WA→TG enrich (MAX phone-search was N/A then; now wired via PyMax)
- INC-108 — live inbound TypeError: `on_msg` arity vs PyMax `callback(event, client)` — no CRM leads until fix
- INC-109 — media `[сообщение]`; no attach/read; TG peer = MAX id
- INC-110 — regular video file okcdn 400 without Chrome UA → CRM «скачать» only
- INC-111 — CRM outbound «Token has expired»: drop+restore once on send; RU re-QR if still dead
- INC-112 — outbound video CRM «скачать» only: `fileId` …`:out` not resolvable; fix media GET via message.attaches + extension classify
- INC-113 — channel→CRM lead; owner phone/TG enrich leaked onto peer (me.contact skip + chat_id≠user_id + owner-phone belt)

## Smoke (~1–2 min)

1. `/dashboard/ai/max` → trial/sub active → «Показать QR» → **Подключено**.
2. Personal DM inbound → CRM Conversation + Person (peer phone/name, **not** owner phone/TG).
3. Channel / group message → **no** new Person/Opp (log skip / skipped non_private).
4. Outbound text + file/video from CRM → delivered; video player when MIME ok.
5. Open chat → read receipt (native).
6. Hard-refresh: inbound media still preview/player (voice/circle/PDF/video).
7. Admin enrich (optional): `POST /admin/tenants/:id/enrich-persons-by-phone` `{ "channels": ["max"], "limit": 5 }` — never invent `max.ru/+phone`.
8. Unit: `pnpm exec vitest run apps/saas-api/tests/max-phone-guard.test.ts`.

## Cross-channel (with WA)

- WA inbound → `enrichMaxPresenceFromPhone` when `ai_max` active (worker).
- MAX inbound/sync with peer phone → reverse enrich TG + WA (`enrichPersonCrossChannelByPhone` + `forbidPhones` for owner).
- MAX inbound → `syncMaxLeadToCrm` merges Person/Opp by phone + `applyMaxProfile`.
- Person Social layout: Telegram → WhatsApp → **MAX** (force order). If reapply 200 but UI wrong → INC-107 (SQL + twenty recreate).

## Last verified / deploy

- **2026-08-07 ~16:14 MSK (user-confirmed WORKING):** live inbound DM → Person/Opp; media inbound (photo/pdf/voice/circle/sticker/video); outbound text/file/video + preview; read receipts; no channel/bot leads; no owner-profile leak (INC-113); attach button. **Docs freeze only — no redeploy.** Paired WA freeze: `wa-crm-sync.md` + `crm-chat-panel.md`.
- 2026-08-07 — INC-113 harden: `selfPhone` bridge→api; `stripOwnerPhone` + enrich `forbidPhones`; history sync no overwrite phone; freeze baseline. Deploy `saas-api,max-bridge` backup `20260807-121730`. Marina already cleaned — no mass CRM delete.
- 2026-08-07 — INC-113: channel/bot/self filters + me.contact unwrap + maxUserId for open/max; deploy `saas-api,max-bridge` backup `20260807-120603`. Marina cleaned; channel Person/Opp soft-deleted.
- 2026-08-07 — INC-112: outbound `:out` media resolve + .mp4 classify; deploy `max-bridge,saas-api` backup `20260807-114320`.
- 2026-08-07 — INC-111: session-auth retry on send + RU humanize; deploy `max-bridge,saas-api` backup `20260807-105343`.
- 2026-08-07 — INC-110: okcdn video download Chrome UA; deploy `max-bridge` backup `20260807-101651`.
- 2026-08-07 — INC-109: media inbound/outbound + read + TG peer fix; deploy `max-bridge,saas-api,gramjs-bridge` backup `20260807-085850`.
- 2026-08-07 — INC-108: live inbound handler arity fix; deploy `max-bridge` backup `20260807-083628`.
- 2026-08-07 — Connect no longer auto-POSTs `sync-history` (portal); sync **button only**.
- 2026-08-06 — History sync + phone enrich + Person.max (see earlier WORKLOG entries).
