-- 0056: persist lead notification provider delivery evidence

ALTER TABLE lead_notification_deliveries
  ADD COLUMN IF NOT EXISTS delivered_channel TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_response JSONB;
