-- AI CRM lead linkage + ambiguous dedupe flag on Conversation
ALTER TABLE "Conversation" ADD COLUMN "twentyPersonId" TEXT,
ADD COLUMN "twentyOpportunityId" TEXT,
ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Conversation_needsReview_idx" ON "Conversation"("needsReview");
CREATE INDEX "Conversation_twentyPersonId_idx" ON "Conversation"("twentyPersonId");
