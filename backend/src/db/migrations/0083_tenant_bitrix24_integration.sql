-- ---------------------------------------------------------------------------
-- 0083_tenant_bitrix24_integration.sql
--
-- Интеграция с Битрикс24 (входящий вебхук crm.lead.add).
-- Хранит конфигурацию исходящей отправки лидов в разрезе tenant_id с RLS.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_bitrix24_configs (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    webhook_url TEXT NOT NULL DEFAULT '',
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    last_lead_id TEXT,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-Level Security
ALTER TABLE tenant_bitrix24_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_bitrix24_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_bitrix24_configs_isolation ON tenant_bitrix24_configs;
CREATE POLICY tenant_bitrix24_configs_isolation ON tenant_bitrix24_configs
    FOR ALL
    USING (tenant_id = current_tenant_id() OR platform_scope())
    WITH CHECK (tenant_id = current_tenant_id());
