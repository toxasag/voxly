-- CRM operator read marker for unread badges on Person / Opportunity cards.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastOperatorReadAt" TIMESTAMP(3);

-- Existing threads: baseline so deploy does not flood boards with historical counts.
UPDATE "Conversation"
SET "lastOperatorReadAt" = COALESCE("updatedAt", NOW())
WHERE "lastOperatorReadAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Conversation_twentyOpportunityId_idx"
  ON "Conversation"("twentyOpportunityId");
