-- 0054: durable lead notification delivery state
--
-- A boolean timestamp on deals cannot coordinate concurrent workers or preserve
-- failed delivery attempts. This ledger is the idempotency boundary: one row per
-- tenant/deal, with a short lease for crash recovery and explicit failure data.

CREATE TABLE IF NOT EXISTS lead_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'failed', 'sent')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_notification_deliveries_retry
  ON lead_notification_deliveries (tenant_id, status, locked_until)
  WHERE status <> 'sent';

ALTER TABLE lead_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notification_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lead_notification_deliveries;
CREATE POLICY tenant_isolation ON lead_notification_deliveries
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
