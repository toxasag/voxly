# WhatsApp `fromMe` Outbound Pipeline

## Исходные файлы

- `apps/ai-whatsapp-worker/src/index.ts` — webhook dispatch и `mirrorWaPhoneOutbound`
- `apps/saas-api/src/routes/crm-chat.ts` — CRM-originated outbound persistence
- `packages/db/src/crm-link.ts` — `upsertCrmRecordLink`

## Invariant

Evolution `key.fromMe=true` — это уже отправленное оператором сообщение. Его нельзя передавать в inbound/AI pipeline: иначе возможны AI-ответ самому себе, неверный `chat_inbound` timeline и LID/PN duplicate conversation.

## Алгоритм

1. Normalize remote JID/PN/LID.
2. Find existing WhatsApp Conversation by exact JID, E.164 aliases or linked CRM identity.
3. Store `ChatMessage(role='operator', fromMe=true, externalMessageId=message key id)`.
4. Reconcile existing Person/Opportunity and persist `CrmRecordLink(source='outbound')`.
5. Invalidate CRM thread/unread caches and enqueue `chat_outbound` timeline.
6. Do not invoke AI reply or create a lead solely because of `fromMe`.

## Callers / Outbound

Evolution webhook → `handleEvolutionWebhook` → `mirrorWaPhoneOutbound`.

## Risks

LID without a resolvable PN must not create a second Person blindly. Keep the event in a channel thread and retry CRM reconciliation when PN/contact mapping becomes available.
