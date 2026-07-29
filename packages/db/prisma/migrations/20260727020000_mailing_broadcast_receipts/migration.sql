-- ChatMessage delivery receipts + BroadcastRecipient for mailing Phase 2
ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChatMessage_externalMessageId_idx" ON "ChatMessage"("externalMessageId");
CREATE INDEX IF NOT EXISTS "ChatMessage_deliveryStatus_idx" ON "ChatMessage"("deliveryStatus");

CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
  "id" TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "conversationId" TEXT,
  "giftSubscriberId" TEXT,
  "externalMessageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_idx" ON "BroadcastRecipient"("broadcastId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_conversationId_idx" ON "BroadcastRecipient"("conversationId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_externalMessageId_idx" ON "BroadcastRecipient"("externalMessageId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_status_idx" ON "BroadcastRecipient"("status");
