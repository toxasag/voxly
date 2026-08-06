# Gift-bot setup UX (ADR-027)

Canonical for **all** tenants/bots. Details: `CAPABILITIES.md` «Gift bot detail» + `DECISIONS.md` ADR-027. Cursor rule: `.cursor/rules/gift-bot-setup-ux.mdc`.

## Paths

- `apps/saas-portal/src/app/dashboard/bots/[botId]/page.tsx` — steps **1–6** + **Дожим**; data from `botId` only
- Preview/input: `telegram-preview.tsx`, `telegram-preview-chrome.tsx`, `bot-greeting-preview.tsx`, `telegram-md-textarea.tsx`, `input-with-emoji.tsx`, `emoji-picker.tsx`, `to-jpeg.ts`, `upload-bot-media.ts`
- `apps/saas-api/src/routes/bots.ts` — profile/media/promo/funnel APIs; `GET …/media-file`
- `apps/gift-bot-worker/src/index.ts` — funnel runtime; `detectStoredMediaKind` prefix-wins

## Contract (don’t break)

- Drive everything from route `botId` + tenant-scoped `/api/bots/:botId/*` — **never** hardcode bot/tenant id
- Dual photos: profile (TG `setMyProfilePhoto`, PNG/WebP→JPEG) vs card (localStorage per botId)
- Emoji under step-2 preview; unified TG preview chrome; partners amber **page** chrome only (not inside TG preview)
- Media via `file_id` + media-file proxy after reload; Markdown client → MarkdownV2 path
- Same UX for every tenant — polish on one prod bot is the product standard

## Frozen paths

- Dual photo + JPEG convert path
- `TelegramPreview` / chrome / `media-file` preview resolution
- `InputWithEmoji` / `TelegramMdTextarea` / emoji under step 2
- `detectStoredMediaKind` prefix-wins in worker

## Incidents

- INC-005, INC-086–091, INC-093 — media/preview/upload family (gift)

## Smoke (~1–2 min)

1. Portal `/dashboard/bots/<anyBotId>` loads steps 1–6 + Дожим
2. Step 2: change text + emoji → preview updates; save profile photo (JPEG path)
3. Upload media → preview after reload via media-file (not broken blob-only)
4. Do not touch gift UX when fixing WA/GramJS/crm-chat unless explicitly asked

## Last verified / deploy

- **2026-08-06:** gift-bot-worker on prod-diff match; container Up; included in backup deploys `20260806-123456` (open/tg writers) — UX not intentionally changed that day
- Deploy: `./scripts/prod-deploy.sh saas-portal,saas-api,gift-bot-worker` when gift surface changes
