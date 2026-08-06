# MAX personal (`ai_max`)

**Status: WORKING** (login INC-104/105 + history sync + phone enrich 2026-08-06) — not in frozen baseline; iterate carefully.

## Paths

- Portal: `apps/saas-portal/src/app/dashboard/ai/max/page.tsx`
- Proxy: `apps/saas-api/src/routes/max.ts` (JWT → bridge) + `POST …/sync-history`
- Sync: `apps/saas-api/src/services/max-chat-sync.ts`
- Bridge: `apps/max-bridge/src/main.py` — `/crm/private-dialogs`, `/users/by-phone`, QR, send
- Enrich: `apps/saas-api/src/services/enrich-person-by-phone.ts` (MAX channel via bridge) + `TwentyClient.applyMaxProfile`
- Internal: `apps/saas-api/src/routes/max-internal.ts` (live inbound)
- CRM reply: `crm-chat.ts` → `sendViaMaxBridge` (text-only)

## PyMax (maxapi-python) — what we use

Pinned/prod: **2.3.1** (`requirements`: `>=2.3.0`; upstream latest 2.4.0). Docs: [PyMax](https://github.com/MaxApiTeam/PyMax), [docs.pymax.org](https://docs.pymax.org/).

| Capability | API | Our use |
|---|---|---|
| Phone → user | `search_by_phone("+7…")` + `import_contacts([ContactInfo])` | Bridge `POST /users/by-phone` → Person name + `max` LINKS |
| Profile fields | `User.names`, `User.link`, `User.phone`, `User.description` | name / max.ru link / phone (if matches) / about |
| Birthday | **not on User** in 2.3–2.4 | Leave empty — honest gap |
| Chats | `fetch_chats(marker=)` + cache `client.chats` | History sync dialog list |
| History | `fetch_history(chat_id=, backward=)` | ×30 msgs; `platformUserId` = **chat id** |
| Peer profile | `get_user(id)` | Dialog name/phone/link during sync |

**Cannot / must not:** invent `max.ru/+{phone}` or `t.me/+{phone}`; treat Contact book as dialog source; casually refactor gift MAX Bot API.

## Contract (don’t break)

- Browser never talks to max-bridge; always `/api/bots/max/*` + service token.
- Soft trial/billing `ai_max` gates QR start.
- Account **name** is a Voxly label only (phone as name is fine).
- PyMax `WebClient.start()` **never returns** until disconnect — wait `on_start`, then upsert/`authorized`, keep `start` task alive.
- Wipe `pending-{tenant}-{name}` session dir on each new QR (stale → `FAIL_LOGIN_TOKEN`).
- 2FA wrong password → status back to `waiting_password` + clear error (not stuck on `processing_password`).
- **History sync:** only `ChatType.DIALOG` with messages; skip groups/channels/empty; `platformUserId` = **chat id** (match inbound); reuse open Opportunity per Person; honor `suppressDealCreation`; message id `max:{id}`; default ×30 msgs; long job → 202 + `historySyncing` on GET accounts.
- Sync fields: peer name/phone/link (if PyMax `get_user`), message text (media → `[media:…]` placeholder), direction from `sender == me`.
- **Phone enrich:** admin `POST …/enrich-persons-by-phone` tries TG (GramJS) + MAX when sessions exist; `Person.max` only when API returns real `max.ru` link; name only replaces `nonameN`/empty/probe.

## Frozen paths

- Do **not** casually refactor gift-bot MAX Bot API (`gift_max` / `max-handler.ts`) when fixing personal.
- Do not touch WA / GramJS / crm-chat / AI agent / secretary unless required for MAX reply path.

## Incidents

- INC-104 — stuck «Проверяем пароль…» (`await start()` hang)
- INC-105 — upsert 400 `maxUserId` null (Zod optional ≠ nullish)
- INC-106 — WA→TG enrich (MAX phone-search was N/A then; now wired via PyMax)

## Smoke (~1–2 min)

1. `/dashboard/ai/max` → trial/sub active → «Показать QR».
2. MAX → Settings → Devices → scan QR.
3. If 2FA: enter **cloud** password (use hint); expect **Подключено** + row in §03 (+ auto sync starts).
4. Or press **Синхронизировать** → badge «Синхронизация…» → hint with dialog/message counts.
5. CRM: deals `· MAX · {label}`; hard-refresh if needed. Reply text from chat.
6. Admin enrich (tenant with `ai_max`): `POST /admin/tenants/:id/enrich-persons-by-phone` `{ "channels": ["max"], "limit": 5 }` → fields may include `max`/`name` when found; never invent link from phone.

## Cross-channel (with WA)

- WA inbound → `enrichMaxPresenceFromPhone` when `ai_max` active (worker).
- MAX inbound/sync with phone → reverse enrich TG + WA (`enrichPersonCrossChannelByPhone`).
- MAX inbound → `syncMaxLeadToCrm` merges Person/Opp by phone + `applyMaxProfile`.
- Person Social layout: Telegram → WhatsApp → **MAX** (force order). If reapply 200 but UI wrong → INC-107 (SQL + twenty recreate).

## Last verified / deploy

- 2026-08-06 — Cross-channel finish on **voxly**: images from backup `20260806-152806` (markers OK); Social order via SQL + twenty recreate (INC-107); reapply needs **superadmin JWT**.
- 2026-08-06 — INC-105 backup `20260806-140626`; deploy `saas-api,max-bridge`; pending wiped.
- 2026-08-06 — INC-104 backup `20260806-135432`; deploy `max-bridge,saas-portal`.
- 2026-08-06 — History sync already live (SHAs matched pre-ship). Phone enrich + `Person.max` deploy `max-bridge,saas-api,saas-portal` backup `20260806-150447`.
