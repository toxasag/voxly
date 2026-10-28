-- 0055: durable server-side conversion delivery attempts
--
-- One row per tenant/deal/provider/event. The event key makes retries safe and
-- lets operations inspect failures without relying on transient BullMQ logs.

CREATE TABLE IF NOT EXISTS conversion_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('yandex', 'ga4', 'google_ads', 'meta', 'vk')),
  event_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_status INTEGER,
  last_error TEXT,
  response_snippet TEXT,
  delivered_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, event_key)
);

CREATE INDEX IF NOT EXISTS idx_conversion_attempts_retry
  ON conversion_delivery_attempts (tenant_id, status, locked_until)
  WHERE status <> 'sent';

ALTER TABLE conversion_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_delivery_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conversion_delivery_attempts;
CREATE POLICY tenant_isolation ON conversion_delivery_attempts
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
