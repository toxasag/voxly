-- Per-partner per-SKU commission overrides (ReferralServiceRate).
-- Additive only: new table + FKs. Existing ReferralRule rows unchanged.

CREATE TABLE IF NOT EXISTS "ReferralServiceRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralServiceRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralServiceRate_tenantId_productCode_key"
  ON "ReferralServiceRate"("tenantId", "productCode");
CREATE INDEX IF NOT EXISTS "ReferralServiceRate_tenantId_idx"
  ON "ReferralServiceRate"("tenantId");

DO $$ BEGIN
  ALTER TABLE "ReferralServiceRate" ADD CONSTRAINT "ReferralServiceRate_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
