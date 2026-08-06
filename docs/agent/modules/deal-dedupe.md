# Deal / Opp dedupe (save-time + sync reuse)

Surface: `CAPABILITIES.md` «Save-time CRM deal dedupe» + WA sync Opp reuse (INC-100).

## Paths

- `apps/saas-api/src/services/crm-deal-dedupe.ts` — soft-merge People by phone/whatsapp; collapse duplicate open Opps (keep Conversation-linked); relink GiftSubscriber/Conversation
- `apps/saas-api/src/routes/crm-chat.ts` — `POST /api/crm/chat/dedupe`
- `twenty-app/voxly-crm-chat/src/logic-functions/dedupe-on-opportunity-create.ts`
- `twenty-app/voxly-crm-chat/src/logic-functions/dedupe-on-opportunity-save.ts`
- `twenty-app/voxly-crm-chat/src/logic-functions/dedupe-on-person-save.ts` — phones/whatsapp → dedupe API
- Sync-time reuse: WA `findOpenOpportunityByPerson` before `createOpportunity`; GramJS enrich uses soft-merge (manual sync-history does **not** run full enrich)

## Contract (don’t break)

- Soft-merge only — **no** hard-delete loser People; no invent phones
- One open Opportunity per Person when save/sync can see phone/whatsapp twins (INC-100)
- Keep Conversation-linked Opp when collapsing duplicates
- Retarget Opportunities + GiftSubscriber/Conversation person ids on merge
- Does not replace WA LID↔PN conversation merge (separate, `mergeWaLidPnTwinConversations`)

## Frozen paths

- `crm-deal-dedupe.ts` soft-merge semantics
- crm-chat LF hooks ≥ **0.1.27** (`opportunity.created` / `updated`, `person.updated` on phones/whatsapp)
- WA sync `findOpenOpportunityByPerson` before create

## Incidents

- INC-100 — two Opportunities on one Person after WA sync
- INC-097 — empty shells / twin cleanup (related)

## Smoke (~1–2 min)

1. `POST /api/crm/chat/dedupe` (auth) on sample opp without phone → `{ok:true,skipped:true,reason:no_phone_or_whatsapp}` (or equivalent skip)
2. Save Person/Opp with duplicate phone in same workspace → soft-merge / single open Opp (no second open deal)
3. crm-chat package ≥ **0.1.27** installed on tenant

## Last verified / deploy

- **2026-08-06:** backup `20260806-093403`; refresh-crm-chat voxly; `crm-deal-dedupe.ts` md5 local=prod
- Deploy: `./scripts/prod-deploy.sh saas-api` + refresh-crm-chat when LFs change
