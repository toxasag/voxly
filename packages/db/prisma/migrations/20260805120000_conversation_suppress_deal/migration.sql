-- After operator deletes a CRM deal, inbound must not auto-reopen Opportunity
-- unless suppressDealCreation is cleared in CRM chat.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "suppressDealCreation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GiftSubscriber" ADD COLUMN IF NOT EXISTS "suppressDealCreation" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Conversation_suppressDealCreation_idx"
  ON "Conversation"("suppressDealCreation");
