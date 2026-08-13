# CRM chat panel (voxly-crm-chat)

**Status: WORKING / FROZEN baseline 2026-08-07 ~16:14 MSK** (user-confirmed — MAX + WhatsApp CRM chat OK).  
Prior panel baseline 2026-08-06; media/widget harden INC-114…116. Channel cards: `max-personal.md`, `wa-crm-sync.md`.

Agents: **do not change** MAX/WA chat behavior without explicit user ask. Freeze card before edits; smoke after.

Golden path: `CHAT.md` §1 + FLOWS CRM UI. Surface: `CAPABILITIES.md` (Deal-card chat UI).

## Paths

- `twenty-app/voxly-crm-chat/` — app ≥**0.1.29** (`package.json` version = tarball)
- `twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx` — soft-refresh **fingerprint** = content + attachment `fileId`s (not ids-only); hide legacy `[media]`/`[документ]` when attachments present; document+`image/*` via mimeType; photo/sticker prefer signed URL (INC-115)
- `apps/saas-api/src/routes/crm-chat.ts` — history/reply/media; `resolveOutboundPeer` (**gift gate**, WA from Person.whatsapp); media resolve by attachment-owning conversation (multi-channel Person, INC-115)
- `docker/twenty-shell-ux.js` — inbound toasts + unread badges (do not casually rewrite)

## Contract (don’t break)

- Soft-refresh must pick up content/attachment changes without remount (INC-098)
- «Пишем от»: gift/gift_max only if GiftSubscriber/conv on **that** bot; WA option if Person.whatsapp filled (no invent from phones alone) — INC-099
- **Social TG link ≠ GramJS send.** Open `/open/tg/{id}` / `tg://` only proves identity. Send needs GramJS account + peer userId/@username (from Person.telegram LINKS or Conversation); first send may create Conversation; bridge may ImportContacts by phone when entity missing — INC-103. Never use MAX `platformUserId` as GramJS peer (INC-109).
- Media: signed URL + `/media/*`, MIME sniff/Range, Fastify `maxParamLength`
- AI toggle / pause / suppressDealCreation (manual) / multi-thread / presence lines stay
- After saas-api bake: `refresh-crm-chat` for affected tenants when tarball bumped

## Frozen paths

- `chat-panel.tsx` fingerprint + `isMediaPlaceholder` behavior
- `resolveOutboundPeer` gift-subscriber gate + WA Person.whatsapp fallback
- crm-chat version bump discipline (bump when shipping front/LF changes)
- Multi-channel media resolve (`findAttachmentContext`) + signed URL photo path (0.1.28)
- `refresh-crm-chat` must keep `configuration.__typename` (INC-116)

## Incidents

- INC-098 — stale `[media]` after backfill
- INC-099 — gift offered without subscription
- INC-114 — WA outbound media pure base64 (worker; panel upload path shared)
- INC-115 — WA media paperclip on Person that also has MAX (wrong default bot)
- INC-116 — Chat «Нет данных» after refresh (missing configuration.__typename) — **closed** user-confirmed 2026-08-07 ~16:14
- INC-063 / INC-050 / INC-055 / INC-057 / INC-067 — media/token/presence family

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200
2. Prod tarball: `/opt/voxly/twenty-app/voxly-crm-chat/package.json` version ≥ **0.1.29**
3. Hard-refresh tenant CRM → Chat widget loads (not «Нет данных»)
4. Peer without gift sub: «Пишем от» has no gift bot; Person with WA link: WA available
5. Person with MAX+WA: both channels preview media; WA outbound photo/video/document OK
6. GramJS channel: «Прикрепить» visible; spoiler+code in native TG (INC-117). MAX/WA attach still when those channels selected.

## Last verified / deploy

- **2026-08-07 INC-117:** GramJS spoiler/code + attach (crm-chat **0.1.29**); MAX/WA freeze behavior preserved (attach still on those channels). Deploy via `gramjs-bridge,saas-api` + refresh.
- **2026-08-07 ~16:14 MSK (user-confirmed WORKING):** MAX chat + WhatsApp chat both OK in CRM; crm-chat **0.1.28**. **Docs freeze only — no redeploy.**
- **2026-08-07:** INC-116 Chat «Нет данных» after refresh — widget `configuration.__typename` missing; SQL+redis fix; refresh harden. crm-chat **0.1.28** kept (INC-115). Backup tip `20260807-130335`.
- **2026-08-07:** INC-115 multi-channel WA media resolve; crm-chat **0.1.28**; backup `20260807-124124`; max-bridge untouched
- **2026-08-06 (user-confirmed WORKING):** multi-channel chat/media/write-as ok; crm-chat **0.1.27**; INC-103; backups `20260806-132913` + `20260806-125415`; PR #1 `263e4ef`
- Deploy: `./scripts/prod-deploy.sh saas-api,gramjs-bridge` then refresh-crm-chat when tarball bumped
