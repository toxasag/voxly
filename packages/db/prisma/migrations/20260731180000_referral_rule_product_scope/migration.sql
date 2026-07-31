-- ReferralRule.productScope: normalise to the vocabulary the crediting code now enforces
--
-- Until now `creditReferralForPayment` never read `productScope`, so the stored value had no
-- effect: every payment except the AI wallet top-up (`REFERRAL_EXCLUDED_PRODUCTS`, applied
-- before any scope check) earned commission. Production rows carry the seeded value
-- 'subscriptions', which is no longer part of the vocabulary — every SKU except `ai_topup`
-- creates a Subscription, so it was indistinguishable from 'all'.
--
-- Deliberate, approved data change: rewrite every non-'crm' value to 'all' ("everything except
-- the AI top-up") so that enforcing the field does NOT narrow payouts on deploy. Existing 'crm'
-- rows (none in production today) keep their meaning. Idempotent: a second run matches no rows.
-- Nothing else on this table or any other is touched.
UPDATE "ReferralRule"
SET "productScope" = 'all', "updatedAt" = CURRENT_TIMESTAMP
WHERE "productScope" NOT IN ('all', 'crm');
