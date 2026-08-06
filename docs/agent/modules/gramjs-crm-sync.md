# GramJS / TG personal → CRM

Golden path: `CHAT.md` (GramJS section). Surface: `CAPABILITIES.md` (GramJS bridge + portal).

## Paths

- `apps/gramjs-bridge/src/index.ts` — QR/session, `exportPrivateDialogsForCrm` (**attachments** `gramjs:peer:msgId`, not bare `[media]`)
- `apps/saas-api/src/services/gramjs-chat-sync.ts` — store + **backfill** existing `[media]` rows on re-sync
- `apps/saas-api/src/routes/gramjs.ts` — `POST …/sync-history` → **202** background job; GET accounts `historySyncing`
- `apps/saas-api/src/services/telegram-crm-enrich.ts` — soft-merge / TG presence (shared with dedupe)
- `apps/saas-portal/src/app/dashboard/ai/gramjs/page.tsx` — badge **Синхронизация…** + poll ~3s

## Contract (don’t break)

- Private DMs only for AI/CRM (skip group/channel) — INC-096
- Sync imports private dialogs (×**30** msgs default, rate-limited); media as attachments + placeholder text (`[фото]` / `[файл:…]`)
- Re-sync **backfills** old `[media]` ChatMessages when bridge now exports attachments
- Portal: sync returns quickly; UI shows `historySyncing` until job done (no false «На связи» during long sync)
- `suppressDealCreation` manual only; never auto on Opportunity delete
- TG open links via `telegramOpenLink` — never `t.me/+phone`
- **CRM send:** Person.telegram userId/@username enables «Пишем от» GramJS even without prior Conversation (WA card OK); `/messages/send` may ImportContacts(`phone`) when `getEntity` fails — social open link alone is not enough without peer bind (INC-103)

## Frozen paths

- Bridge CRM export attachment shape (`gramjs:peer:msgId` + type)
- `gramjs-chat-sync` attachment store + `[media]` backfill
- `historySyncing` job API + portal poll badge

## Incidents

- INC-098 — UI still `[media]` after backfill (see also crm-chat-panel fingerprint)
- INC-096 — group → CRM deal
- Related: INC-102 social open without @username

## Smoke (~1–2 min)

1. `curl -sS https://api.getvoxly.ru/health` → 200
2. `docker-gramjs-bridge-1` Up; inside container `/health` → ok
3. Portal `/dashboard/ai/gramjs` → Sync → amber **Синхронизация…** until done
4. CRM chat on a media-heavy peer: images/files preview (not bare `[media]`) after hard-refresh

## Last verified / deploy

- **2026-08-06:** INC-103 send+ImportContacts; backup `20260806-125415`; earlier media/UI `084234`/`082647`/`090344`
- Deploy: `./scripts/prod-deploy.sh gramjs-bridge,saas-api` (bridge needs compose profile + `TELEGRAM_API_*` on server)
