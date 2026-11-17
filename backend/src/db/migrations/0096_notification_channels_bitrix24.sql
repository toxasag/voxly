-- ---------------------------------------------------------------------------
-- 0096_notification_channels_bitrix24.sql
--
-- Расширение каналов уведомлений арендатора поддержкой Битрикс24 (bitrix24).
-- Позволяет тенанту подключать несколько интеграций Bitrix24 (разные воронки/сайты/виджеты).
-- ---------------------------------------------------------------------------

-- 1. Снятие старого ограничения CHECK на типы каналов и установка нового с 'bitrix24'
ALTER TABLE tenant_notification_channels
    DROP CONSTRAINT IF EXISTS tenant_notification_channels_channel_type_check;

ALTER TABLE tenant_notification_channels
    ADD CONSTRAINT tenant_notification_channels_channel_type_check
    CHECK (channel_type IN ('email', 'telegram', 'whatsapp', 'bitrix24'));

-- 2. Корректировка уникального индекса:
-- Для direct-каналов (email, telegram, whatsapp) гарантируем дедупликацию по назначению.
-- Для bitrix24 разрешаем множественные каналы (например, разные виджеты или разные webhook URL).
DROP INDEX IF EXISTS uq_tenant_notification_channels;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_notification_channels_direct
    ON tenant_notification_channels (tenant_id, channel_type, destination)
    WHERE channel_type IN ('email', 'telegram', 'whatsapp');

-- Для bitrix24 индекс по tenant_id и destination для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_tenant_notification_channels_b24
    ON tenant_notification_channels (tenant_id, channel_type)
    WHERE channel_type = 'bitrix24';

-- 3. Автоматическая миграция существующих конфигураций Bitrix24 в tenant_notification_channels
INSERT INTO tenant_notification_channels (
    tenant_id,
    channel_type,
    destination,
    extra_meta,
    is_active,
    is_verified,
    created_at,
    updated_at
)
SELECT
    tenant_id,
    'bitrix24',
    webhook_url,
    jsonb_build_object(
        'custom_source_id', COALESCE(NULLIF(custom_source_id, ''), 'UC_VWN1ZK'),
        'allowed_sources', to_jsonb(allowed_sources),
        'selected_widget_ids', to_jsonb(selected_widget_ids),
        'send_utm_marks', send_utm_marks,
        'send_geo_data', send_geo_data,
        'last_lead_id', last_lead_id,
        'last_sync_at', last_sync_at,
        'last_error', last_error
    ),
    is_enabled,
    true,
    created_at,
    updated_at
FROM tenant_bitrix24_configs
WHERE webhook_url IS NOT NULL AND webhook_url != ''
  AND NOT EXISTS (
      SELECT 1 FROM tenant_notification_channels tnc
      WHERE tnc.tenant_id = tenant_bitrix24_configs.tenant_id
        AND tnc.channel_type = 'bitrix24'
        AND tnc.destination = tenant_bitrix24_configs.webhook_url
  );
