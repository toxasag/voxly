-- -----------------------------------------------------------------------------
-- 0034: AI Handoff and Bot Pause upon manual operator reply
--
-- Adds `ai_paused_until` to `deals`. When a manager responds natively from
-- their phone or web interface, AI autoreply is paused for 30 minutes on that deal.
-- -----------------------------------------------------------------------------

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deals_ai_paused_until
  ON deals (tenant_id, ai_paused_until)
  WHERE ai_paused_until IS NOT NULL;
