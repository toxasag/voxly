-- ---------------------------------------------------------------------------
-- 0048_deal_lead_notified_at.sql
--
-- Поле lead_notified_at для отслеживания факта отправки email-уведомления
-- арендатору о новом лиде / заявке, чтобы исключить дублирование писем (идемпотентность).
-- ---------------------------------------------------------------------------

ALTER TABLE deals ADD COLUMN IF NOT EXISTS lead_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deals_tenant_lead_notified_at
  ON deals (tenant_id, lead_notified_at)
  WHERE lead_notified_at IS NOT NULL;
