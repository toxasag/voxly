-- Referral campaigns (project links) + manual expenses + attribution

ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

CREATE TABLE IF NOT EXISTS "ReferralCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReferralCampaignExpense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amountRub" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCampaignExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCampaign_code_key" ON "ReferralCampaign"("code");
CREATE INDEX IF NOT EXISTS "ReferralCampaign_tenantId_idx" ON "ReferralCampaign"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralCampaignExpense_tenantId_idx" ON "ReferralCampaignExpense"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralCampaignExpense_campaignId_idx" ON "ReferralCampaignExpense"("campaignId");
CREATE INDEX IF NOT EXISTS "ReferralCampaignExpense_spentAt_idx" ON "ReferralCampaignExpense"("spentAt");
CREATE INDEX IF NOT EXISTS "Referral_campaignId_idx" ON "Referral"("campaignId");
CREATE INDEX IF NOT EXISTS "Referral_attributedAt_idx" ON "Referral"("attributedAt");
CREATE INDEX IF NOT EXISTS "Referral_firstPaymentAt_idx" ON "Referral"("firstPaymentAt");

DO $$ BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ReferralCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralCampaign" ADD CONSTRAINT "ReferralCampaign_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralCampaignExpense" ADD CONSTRAINT "ReferralCampaignExpense_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralCampaignExpense" ADD CONSTRAINT "ReferralCampaignExpense_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ReferralCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
