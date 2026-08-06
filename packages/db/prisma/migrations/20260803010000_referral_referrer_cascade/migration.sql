-- Allow purging a partner tenant that still has Referral rows as referrer.
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_referrerTenantId_fkey";
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerTenantId_fkey"
  FOREIGN KEY ("referrerTenantId") REFERENCES "Tenant"("id")
  ON UPDATE CASCADE ON DELETE CASCADE;
