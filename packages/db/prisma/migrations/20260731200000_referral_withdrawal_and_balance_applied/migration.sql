-- Partner balance as one pot: redeemable against the tenant's own invoice + cash withdrawal requests

-- Additive only. PG 12+ allows ALTER TYPE ... ADD VALUE inside a transaction block; the new label
-- may just not be USED in that same transaction. Nothing below inserts or compares 'redeem', so a
-- single migration is safe (Postgres 16 here — see docker/docker-compose.yml).
ALTER TYPE "ReferralTxKind" ADD VALUE IF NOT EXISTS 'redeem';

DO $$ BEGIN
  CREATE TYPE "ReferralWithdrawalStatus" AS ENUM ('pending', 'paid', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Payout details are stored as plain text by explicit product decision (no encryption).
CREATE TABLE IF NOT EXISTS "ReferralWithdrawal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountRub" DECIMAL(10,2) NOT NULL,
    "status" "ReferralWithdrawalStatus" NOT NULL DEFAULT 'pending',
    "payoutDetails" TEXT NOT NULL,
    "comment" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReferralWithdrawal_tenantId_idx" ON "ReferralWithdrawal"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralWithdrawal_status_idx" ON "ReferralWithdrawal"("status");
CREATE INDEX IF NOT EXISTS "ReferralWithdrawal_createdAt_idx" ON "ReferralWithdrawal"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ReferralWithdrawal" ADD CONSTRAINT "ReferralWithdrawal_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How much of this invoice the partner balance covers; amount = gross - balanceAppliedRub.
-- DEFAULT 0 keeps every existing payment (fully money-paid) correct without a backfill.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "balanceAppliedRub" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Serves checkout: find this tenant's open holds (status = 'pending') before creating a new one.
-- Leading tenantId narrows to the tenant, status filters the holds.
CREATE INDEX IF NOT EXISTS "Payment_tenantId_status_idx" ON "Payment"("tenantId", "status");
