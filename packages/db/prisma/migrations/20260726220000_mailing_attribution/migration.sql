-- AlterTable
ALTER TABLE "GiftSubscriber" ADD COLUMN IF NOT EXISTS "lastMailingBroadcastId" TEXT;
ALTER TABLE "GiftSubscriber" ADD COLUMN IF NOT EXISTS "lastMailingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMailingBroadcastId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMailingAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GiftSubscriber_lastMailingAt_idx" ON "GiftSubscriber"("lastMailingAt");
CREATE INDEX IF NOT EXISTS "Conversation_lastMailingAt_idx" ON "Conversation"("lastMailingAt");
