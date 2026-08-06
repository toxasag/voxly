# Person social links (LINKS + open/tg)

Surface: `CAPABILITIES.md` «Person Социальные сети».

## Paths

- `packages/twenty-client/src/index.ts` — `telegramOpenLink`, `socialFieldToUrl`, `linksInput` (label = URL), `ensureSocialFields`, `applyTelegramProfile`
- `apps/saas-api/src/routes/open-tg.ts` — public `GET /open/tg/:userId` HTML → `tg://user?id=`
- `apps/saas-api/src/services/migrate-social-links.ts` — label=url; clear `t.me/+`
- `apps/saas-api/src/services/backfill-telegram-open-links.ts` + admin route — MTProto id → bridge URL
- Writers: WA/TG/GramJS/gift sync paths that set Person.telegram / whatsapp

## Contract (don’t break)

- Visible LINKS label = **full URL** (`primaryLinkLabel` = `primaryLinkUrl`) — INC-101
- TG `@username` → `https://t.me/{user}`
- No @username but MTProto userId → `https://api.getvoxly.ru/open/tg/{id}` with label `tg://user?id={id}` — INC-102
- **Never** invent `https://t.me/+{phone}` (scrape is not a profile)
- WA → `https://wa.me/{E164}` when known
- Twenty front mangles bare `tg://` — always use HTTPS bridge for clickability
- **Open profile ≠ CRM Chat send.** Link proves identity for humans; GramJS «Пишем от» uses the same userId via `parseTelegramPeerFromLink` + Conversation bind on first send (see `crm-chat-panel.md` / INC-103)

## Frozen paths

- `telegramOpenLink` decision table (@ vs userId vs empty)
- `open-tg.ts` public route registration on saas-api
- `linksInput` label=URL behavior

## Incidents

- INC-102 — open TG without @username
- INC-101 — LINKS showed "WhatsApp"/"Telegram" instead of URL

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/open/tg/928954961` → 200 HTML with `tg://user?id=928954961`
2. CRM Person without @username but with TG id: Telegram LINKS clickable via `/open/tg/…`
3. WA Person: WhatsApp pill text is `https://wa.me/…` not "WhatsApp"
4. No Person telegram = `t.me/+7…`

## Last verified / deploy

- **2026-08-06:** open/tg live; backup `20260806-123456`; voxly backfill 162 updated; md5 local=prod for `open-tg.ts`
- Deploy: `./scripts/prod-deploy.sh saas-api` (+ workers if sync writers changed); optional admin backfill per tenant
