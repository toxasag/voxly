# CRM chat panel (voxly-crm-chat)

Golden path: `CHAT.md` §1 + FLOWS CRM UI. Surface: `CAPABILITIES.md` (Deal-card chat UI).

## Paths

- `twenty-app/voxly-crm-chat/` — app ≥**0.1.27** (`package.json` version = tarball)
- `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` — soft-refresh **fingerprint** = content + attachment `fileId`s (not ids-only); hide legacy `[media]`/`[документ]` when attachments present; document+`image/*` via mimeType
- `apps/saas-api/src/routes/crm-chat.ts` — history/reply/media; `resolveOutboundPeer` (**gift gate**, WA from Person.whatsapp)
- `docker/twenty-shell-ux.js` — inbound toasts + unread badges (do not casually rewrite)

## Contract (don’t break)

- Soft-refresh must pick up content/attachment changes without remount (INC-098)
- «Пишем от»: gift/gift_max only if GiftSubscriber/conv on **that** bot; WA option if Person.whatsapp filled (no invent from phones alone) — INC-099
- **Social TG link ≠ GramJS send.** Open `/open/tg/{id}` / `tg://` only proves identity. Send needs GramJS account + peer userId/@username (from Person.telegram LINKS or Conversation); first send may create Conversation; bridge may ImportContacts by phone when entity missing — INC-103
- Media: signed URL + `/media/*`, MIME sniff/Range, Fastify `maxParamLength`
- AI toggle / pause / suppressDealCreation (manual) / multi-thread / presence lines stay
- After saas-api bake: `refresh-crm-chat` for affected tenants when tarball bumped

## Frozen paths

- `chat-panel.tsx` fingerprint + `isMediaPlaceholder` behavior
- `resolveOutboundPeer` gift-subscriber gate + WA Person.whatsapp fallback
- crm-chat version bump discipline (bump when shipping front/LF changes)

## Incidents

- INC-098 — stale `[media]` after backfill
- INC-099 — gift offered without subscription
- INC-063 / INC-050 / INC-055 / INC-057 / INC-067 — media/token/presence family

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200
2. Prod tarball: `/opt/voxly/twenty-app/voxly-crm-chat/package.json` version ≥ **0.1.27**
3. Hard-refresh tenant CRM → Opportunity with GramJS photos → Чат shows images (not `[media]`)
4. Peer without gift sub: «Пишем от» has no gift bot; Person with WA link: WA available

## Last verified / deploy

- **2026-08-06:** crm-chat **0.1.27** on prod; INC-103 GramJS-from-Person.telegram in saas-api; backup `20260806-125415` (+ earlier `090344`/`093403`); refresh-crm-chat **voxly** ok
- Deploy: `./scripts/prod-deploy.sh saas-api,gramjs-bridge` then refresh-crm-chat when tarball bumped
