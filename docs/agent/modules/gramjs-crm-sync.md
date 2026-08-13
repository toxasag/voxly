# GramJS / TG personal → CRM

**Status: WORKING** (baseline 2026-08-06; outbound format+attach 2026-08-07)

Golden path: `CHAT.md` (GramJS section). Surface: `CAPABILITIES.md` (GramJS bridge + portal).

## Paths

- `apps/gramjs-bridge/src/index.ts` — QR/session, `exportPrivateDialogsForCrm` (**attachments** `gramjs:peer:msgId`, not bare `[media]`); CRM `POST /messages/send` (**HTML entities** + optional `mediaBase64`)
- `apps/saas-api/src/services/gramjs-chat-sync.ts` — store + **backfill** existing `[media]` rows on re-sync
- `apps/saas-api/src/routes/gramjs.ts` — `POST …/sync-history` → **202** background job; GET accounts `historySyncing`
- `apps/saas-api/src/routes/crm-chat.ts` — GramJS reply text+attach; `supportsAttachments` true for `ai_gramjs`
- `apps/saas-api/src/services/telegram-crm-enrich.ts` — soft-merge / TG presence (shared with dedupe)
- `apps/saas-portal/src/app/dashboard/ai/gramjs/page.tsx` — badge **Синхронизация…** + poll ~3s
- `packages/shared/src/telegram-md.ts` — `clientMdToTelegramHtml` (spoiler/code for MTProto)

## Contract (don’t break)

- Private DMs only for AI/CRM (skip group/channel) — INC-096
- Sync imports private dialogs (×**30** msgs default, rate-limited); media as attachments + placeholder text (`[фото]` / `[файл:…]`)
- Re-sync **backfills** old `[media]` ChatMessages when bridge now exports attachments
- Portal: sync returns quickly; UI shows `historySyncing` until job done (no false «На связи» during long sync)
- **No auto history sync on connect** — `/api/internal/gramjs/connected` is ack-only; sync via portal button / admin enqueue only
- `suppressDealCreation` manual only; never auto on Opportunity delete
- TG open links via `telegramOpenLink` — never `t.me/+phone`
- On history sync: phone-matched Persons get `applyTelegramProfile` from dialog (name/phone/links); placeholder names upgraded (INC-106)
- **CRM send:** Person.telegram userId/@username enables «Пишем от» GramJS even without prior Conversation (WA/MAX card OK); `/messages/send` tries `getEntity(username)` then ImportContacts(`phone`) when id missing; phone mapping wins if CRM peer id was from another channel — INC-103 / INC-109
- **CRM format:** client MD (`**` `__` `~~` `||` `` ` ``) → Telegram HTML entities on bridge (INC-117/118). Inline `` `code` `` → `<pre>` / MessageEntityPre (visible grey block; MessageEntityCode too subtle on Cyrillic). Do not send raw markers; GramJS `md` delimiters omit spoiler.
- **CRM attach:** outbound photo/video/voice/document via bridge `mediaBase64` (same multipart path as MAX/WA). Do not re-hide attach for `ai_gramjs` (INC-033 was temporary).

## Frozen paths

- Bridge CRM export attachment shape (`gramjs:peer:msgId` + type)
- `gramjs-chat-sync` attachment store + `[media]` backfill
- `historySyncing` job API + portal poll badge
- MAX/WA outbound paths in `crm-chat.ts` / max-bridge / ai-whatsapp-worker — **do not change** for GramJS work

## Incidents

- INC-118 — «Код» invisible as MessageEntityCode → Pre block
- INC-117 — spoiler/code + missing attach on GramJS CRM send
- INC-098 — UI still `[media]` after backfill (see also crm-chat-panel fingerprint)
- INC-096 — group → CRM deal
- Related: INC-102 social open without @username; INC-033 hid attach (superseded by INC-117)

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200
2. `docker-gramjs-bridge-1` Up; inside container `/health` → ok
3. Portal `/dashboard/ai/gramjs` → Sync → amber **Синхронизация…** until done
4. CRM chat on a media-heavy peer: images/files preview (not bare `[media]`) after hard-refresh
5. CRM GramJS: spoiler + code in native Telegram; «Прикрепить» visible; photo send OK
6. Switch «Пишем от» → MAX/WA: attach still present (freeze)

## Last verified / deploy

- **2026-08-07 INC-118:** `` `code` `` → MessageEntityPre (visible); backup `20260807-141203` `gramjs-bridge` only. **max-bridge / wa-worker / crm-chat untouched.**
- **2026-08-07 INC-117:** CRM GramJS spoiler/code (HTML parseMode) + outbound attach; crm-chat **0.1.29**; `supportsAttachments` for `ai_gramjs`. Deploy backup `20260807-132959` `gramjs-bridge,saas-api` + `refresh-crm-chat` all tenants. **max-bridge / ai-whatsapp-worker untouched.**
- **2026-08-07:** disabled auto CRM history/enrich enqueue on connect (`gramjs-internal` `/connected` no-op + bridge skip notify). Manual `POST …/sync-history` unchanged. Deploy: `gramjs-bridge,saas-api` (+ portal if UI copy).
- **2026-08-06 INC-106:** `/users/by-phone` DeleteContacts→GetFullUser (real ФИО); backup `20260806-143720`; sync still applies dialog profile on phone match
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge,saas-api` (bridge needs compose profile + `TELEGRAM_API_*` on server)
