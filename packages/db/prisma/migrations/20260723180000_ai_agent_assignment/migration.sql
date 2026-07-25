-- AiAgent + assignment (account default + conversation override).
-- Null agent = AI OFF. Existing rows keep null → no mass-enable (ADR-014).

CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "settings" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiAgent_tenantId_idx" ON "AiAgent"("tenantId");
CREATE INDEX "AiAgent_status_idx" ON "AiAgent"("status");

ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotInstance" ADD COLUMN "defaultAiAgentId" TEXT;
CREATE INDEX "BotInstance_defaultAiAgentId_idx" ON "BotInstance"("defaultAiAgentId");
ALTER TABLE "BotInstance" ADD CONSTRAINT "BotInstance_defaultAiAgentId_fkey" FOREIGN KEY ("defaultAiAgentId") REFERENCES "AiAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD COLUMN "aiAgentId" TEXT;
CREATE INDEX "Conversation_aiAgentId_idx" ON "Conversation"("aiAgentId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_aiAgentId_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
