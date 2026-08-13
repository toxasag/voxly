-- Add idempotency key to AiUsageLog for reliable AI charging (Phase 3.3)
-- A retried charge with the same usageChargeKey becomes a no-op via the unique index.

ALTER TABLE "AiUsageLog" ADD COLUMN "usageChargeKey" TEXT;

CREATE UNIQUE INDEX "AiUsageLog_usageChargeKey_key"
    ON "AiUsageLog"("usageChargeKey");
