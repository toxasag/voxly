-- AI agent knowledge base + sales examples from won CRM deals
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "salesLearnedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AiKnowledgeFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiAgentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "extractedChars" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiKnowledgeFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiAgentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiSalesExample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiAgentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "opportunityId" TEXT,
    "userText" TEXT NOT NULL,
    "operatorText" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSalesExample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiSalesExample_sourceMessageId_key" ON "AiSalesExample"("sourceMessageId");
CREATE INDEX IF NOT EXISTS "AiKnowledgeFile_tenantId_idx" ON "AiKnowledgeFile"("tenantId");
CREATE INDEX IF NOT EXISTS "AiKnowledgeFile_aiAgentId_idx" ON "AiKnowledgeFile"("aiAgentId");
CREATE INDEX IF NOT EXISTS "AiKnowledgeFile_status_idx" ON "AiKnowledgeFile"("status");
CREATE INDEX IF NOT EXISTS "AiKnowledgeChunk_tenantId_idx" ON "AiKnowledgeChunk"("tenantId");
CREATE INDEX IF NOT EXISTS "AiKnowledgeChunk_aiAgentId_idx" ON "AiKnowledgeChunk"("aiAgentId");
CREATE INDEX IF NOT EXISTS "AiKnowledgeChunk_fileId_idx" ON "AiKnowledgeChunk"("fileId");
CREATE INDEX IF NOT EXISTS "AiSalesExample_tenantId_idx" ON "AiSalesExample"("tenantId");
CREATE INDEX IF NOT EXISTS "AiSalesExample_aiAgentId_idx" ON "AiSalesExample"("aiAgentId");
CREATE INDEX IF NOT EXISTS "AiSalesExample_opportunityId_idx" ON "AiSalesExample"("opportunityId");

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeFile" ADD CONSTRAINT "AiKnowledgeFile_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeFile" ADD CONSTRAINT "AiKnowledgeFile_aiAgentId_fkey"
    FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_aiAgentId_fkey"
    FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "AiKnowledgeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiSalesExample" ADD CONSTRAINT "AiSalesExample_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiSalesExample" ADD CONSTRAINT "AiSalesExample_aiAgentId_fkey"
    FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
