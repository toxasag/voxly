# Person social links (LINKS + open/tg)

Surface: `CAPABILITIES.md` «Person Социальные сети».

## Paths

- `packages/twenty-client/src/index.ts` — `telegramOpenLink`, `socialFieldToUrl`, `linksInput` (label = URL), `ensureSocialFields`, `applyTelegramProfile`
- `apps/saas-api/src/routes/open-tg.ts` — public `GET /open/tg/:userId` HTML → `tg://user?id=`
- `apps/saas-api/src/services/migrate-social-links.ts` — label=url; clear `t.me/+`
- `apps/saas-api/src/services/backfill-telegram-open-links.ts` + admin route — MTProto id → bridge URL
- Writers: WA/TG/GramJS/gift sync paths that set Person.telegram / whatsapp
- Enrich: `enrichPersonCrossChannelByPhone` (TG + MAX + WA IsOnWhatsApp) + WA worker local TG/MAX + admin `enrich-persons-by-phone` + `applyTelegramProfile` / `applyMaxProfile` placeholder guard; internal `POST /api/internal/crm/enrich-by-phone`

## Contract (don’t break)

- Visible LINKS label = **full URL** (`primaryLinkLabel` = `primaryLinkUrl`) — INC-101
- TG `@username` → `https://t.me/{user}`
- No @username but MTProto userId → `https://api.getvoxly.ru/open/tg/{id}` with label `tg://user?id={id}` — INC-102
- **Never** invent `https://t.me/+{phone}` (scrape is not a profile)
- WA → `https://wa.me/{E164}` when known (inbound) **or** Evolution IsOnWhatsApp `exists` (cross-channel from site/TG/MAX)
- MAX → Person.`max` from real `max.ru/…` **or** `/open/max/{userId}` when PyMax has id but no public link — **never** invent `max.ru/+phone`
- Name enrich only replaces `nonameN` / empty / probe — never overwrites a good human name (INC-106)
- Twenty front mangles bare `tg://` — always use HTTPS bridge for clickability
- **Open profile ≠ CRM Chat send.** Link proves identity for humans; GramJS «Пишем от» uses the same userId via `parseTelegramPeerFromLink` + Conversation bind on first send (see `crm-chat-panel.md` / INC-103)

## Frozen paths

- `telegramOpenLink` decision table (@ vs userId vs empty)
- `open-tg.ts` public route registration on saas-api
- `linksInput` label=URL behavior

## Incidents

- INC-102 — open TG without @username
- INC-101 — LINKS showed "WhatsApp"/"Telegram" instead of URL
- INC-106 — WA noname + empty TG despite ImportContacts userId
- INC-107 — reapply 200 but Social order stuck in System (SQL + twenty recreate)

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/open/tg/928954961` → 200 HTML with `tg://user?id=928954961`
2. CRM Person without @username but with TG id: Telegram LINKS clickable via `/open/tg/…`
3. WA Person: WhatsApp pill text is `https://wa.me/…` not "WhatsApp"
4. No Person telegram = `t.me/+7…`

## Last verified / deploy

- **2026-08-06 INC-106:** noname98 → open/tg/6392903179 + name Оксана; admin `enrich-persons-by-phone`; backup `20260806-143720`
- Deploy: `./scripts/prod-deploy.sh saas-api` (+ workers if sync writers changed); optional admin backfill per tenant
