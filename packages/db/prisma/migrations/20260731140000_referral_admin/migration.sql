-- Referral admin: personal partner rules + balance transactions (payouts / manual corrections)

DO $$ BEGIN
  CREATE TYPE "ReferralTxKind" AS ENUM ('payout', 'manual_credit', 'manual_debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReferralRule" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

CREATE TABLE IF NOT EXISTS "ReferralTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ReferralTxKind" NOT NULL,
    "amountRub" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralTransaction_pkey" PRIMARY KEY ("id")
);

-- NULL tenantId stays non-unique in Postgres, so global rules are unaffected
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralRule_tenantId_key" ON "ReferralRule"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralTransaction_tenantId_idx" ON "ReferralTransaction"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralTransaction_createdAt_idx" ON "ReferralTransaction"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ReferralRule" ADD CONSTRAINT "ReferralRule_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
