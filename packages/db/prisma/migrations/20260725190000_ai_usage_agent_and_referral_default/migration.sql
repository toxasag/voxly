-- Track which AiAgent spent wallet balance
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "aiAgentId" TEXT;
CREATE INDEX IF NOT EXISTS "AiUsageLog_aiAgentId_idx" ON "AiUsageLog"("aiAgentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiUsageLog_aiAgentId_fkey'
  ) THEN
    ALTER TABLE "AiUsageLog"
      ADD CONSTRAINT "AiUsageLog_aiAgentId_fkey"
      FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Default referral: 20% recurring of paid products (not AI top-up; enforced in billing)
UPDATE "ReferralRule"
SET
  "type" = 'percent_recurring',
  "value" = 20,
  "productScope" = 'subscriptions',
  "isActive" = true,
  "updatedAt" = NOW()
WHERE "isDefault" = true;

INSERT INTO "ReferralRule" ("id", "type", "value", "productScope", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT 'default', 'percent_recurring', 20, 'subscriptions', true, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ReferralRule" WHERE "isDefault" = true);
