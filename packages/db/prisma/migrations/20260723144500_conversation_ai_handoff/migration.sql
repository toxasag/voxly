-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "pausedUntil" TIMESTAMP(3),
ADD COLUMN "aiDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "channel" TEXT,
ADD COLUMN "businessConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_businessConnectionId_idx" ON "Conversation"("businessConnectionId");

-- CreateIndex
CREATE INDEX "Conversation_aiDisabled_idx" ON "Conversation"("aiDisabled");
