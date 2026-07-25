-- Gift project schedule: auto start/stop via saas-api scheduler
ALTER TABLE "GiftCampaignConfig" ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);
ALTER TABLE "GiftCampaignConfig" ADD COLUMN IF NOT EXISTS "scheduledEndAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "GiftCampaignConfig_scheduledStartAt_idx" ON "GiftCampaignConfig"("scheduledStartAt");
CREATE INDEX IF NOT EXISTS "GiftCampaignConfig_scheduledEndAt_idx" ON "GiftCampaignConfig"("scheduledEndAt");
