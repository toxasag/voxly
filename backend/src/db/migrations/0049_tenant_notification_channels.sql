-- ---------------------------------------------------------------------------
-- 0049_tenant_notification_channels.sql
--
-- Управление каналами доставки уведомлений о новых заявках / лидах (Lead Notifications).
-- Поддерживает множественные Email, Telegram Bot (100% антибан) и верифицированный WhatsApp.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(20) NOT NULL CHECK (channel_type IN ('email', 'telegram', 'whatsapp')),
    destination TEXT NOT NULL,
    extra_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_verified BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальность канала в рамках арендатора (один и тот же email/чат/номер не дублируется)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_notification_channels
    ON tenant_notification_channels (tenant_id, channel_type, destination);

-- Индекс для быстрой выборки активных каналов арендатора
CREATE INDEX IF NOT EXISTS idx_tenant_notification_channels_active
    ON tenant_notification_channels (tenant_id, is_active)
    WHERE is_active = TRUE;

-- Включение Row-Level Security
ALTER TABLE tenant_notification_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_notification_channels;
CREATE POLICY tenant_isolation ON tenant_notification_channels
    FOR ALL
    USING (tenant_id = current_tenant_id() OR platform_scope())
    WITH CHECK (tenant_id = current_tenant_id());
