-- 0093_bitrix24_sync_logs.sql
-- Таблица журнала исходящих синхронизаций с Битрикс24 (наблюдаемость интеграции)

CREATE TABLE IF NOT EXISTS bitrix24_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  entity_type VARCHAR(32) NOT NULL DEFAULT 'deal',
  direction VARCHAR(16) NOT NULL DEFAULT 'outbound',
  status VARCHAR(32) NOT NULL, -- 'success', 'error', 'skipped', 'pending'
  bitrix_lead_id VARCHAR(64),
  webhook_url TEXT,
  request_payload JSONB,
  response_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  lead_source VARCHAR(64),
  widget_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_logs_tenant_created ON bitrix24_sync_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitrix24_sync_logs_deal ON bitrix24_sync_logs (deal_id);

ALTER TABLE bitrix24_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitrix24_sync_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bitrix24_sync_logs_isolation ON bitrix24_sync_logs;
CREATE POLICY bitrix24_sync_logs_isolation ON bitrix24_sync_logs
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- Историческая запись для подтвержденной успешной отправки сделки a0457490-db10-428c-8e8e-a22666146997
INSERT INTO bitrix24_sync_logs (
  tenant_id,
  deal_id,
  entity_type,
  direction,
  status,
  bitrix_lead_id,
  webhook_url,
  response_status,
  response_body,
  lead_source,
  widget_id,
  created_at
)
SELECT
  d.tenant_id,
  d.id,
  'deal',
  'outbound',
  'success',
  '1002443',
  'https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json',
  200,
  '{"result": 1002443}'::jsonb,
  'site_widget',
  d.source_widget_id,
  COALESCE(c.last_sync_at, d.lead_notified_at, NOW())
FROM deals d
JOIN tenant_bitrix24_configs c ON c.tenant_id = d.tenant_id
WHERE d.id = 'a0457490-db10-428c-8e8e-a22666146997'
  AND c.last_lead_id = '1002443'
ON CONFLICT DO NOTHING;
