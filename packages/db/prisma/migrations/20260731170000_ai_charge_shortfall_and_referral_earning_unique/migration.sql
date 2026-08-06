-- AI charge shortfall bookkeeping + referral earning idempotency backstop

ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "uncollectedRub" DECIMAL(10,4);

-- A duplicate non-null paymentId can only exist if a Robokassa ResultURL retry was
-- double-processed before the conditional payment claim. Fail loudly with the offending
-- ids instead of a bare constraint violation; no rows are deleted or rewritten here.
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(d."paymentId", ', ') INTO dupes
  FROM (
    SELECT "paymentId"
    FROM "ReferralEarning"
    WHERE "paymentId" IS NOT NULL
    GROUP BY "paymentId"
    HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ReferralEarning has duplicate paymentId values (%); resolve them manually before applying this migration', dupes;
  END IF;
END $$;

-- NULL paymentId stays non-unique in Postgres, so legacy rows without a payment are unaffected
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralEarning_paymentId_key" ON "ReferralEarning"("paymentId");
