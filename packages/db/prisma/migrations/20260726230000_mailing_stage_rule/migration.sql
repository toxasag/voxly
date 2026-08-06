-- MailingStageRule: auto-send on Opportunity stage enter (ADR-018)
CREATE TABLE IF NOT EXISTS "MailingStageRule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "stageValue" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailingStageRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MailingStageRule_tenantId_idx" ON "MailingStageRule"("tenantId");
CREATE INDEX IF NOT EXISTS "MailingStageRule_tenantId_stageValue_enabled_idx"
  ON "MailingStageRule"("tenantId", "stageValue", "enabled");

DO $$ BEGIN
  ALTER TABLE "MailingStageRule"
    ADD CONSTRAINT "MailingStageRule_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
