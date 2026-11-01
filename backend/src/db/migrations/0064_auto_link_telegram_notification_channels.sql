-- -----------------------------------------------------------------------------
-- 0064_auto_link_telegram_notification_channels.sql
--
-- 1. Снимает остатки триала (trial_ends_at = NULL) и обновляет название тарифа
--    на «Партнёрский тариф» для безлимитных/партнерских тенантов с ценой 0 ₽.
-- 2. Выполняет автоматический бэкфилл каналов уведомлений Telegram для всех
--    пользователей, вошедших или зарегистрированных через Telegram Bot API.
-- -----------------------------------------------------------------------------

-- 1. Очистка остатков триала для партнерских и безлимитных тенантов
UPDATE tenants
SET trial_ends_at = NULL,
    custom_plan_name = CASE
      WHEN custom_plan_name IS NULL OR custom_plan_name = '' OR custom_plan_name = 'Индивидуальный'
      THEN 'Партнёрский тариф'
      ELSE custom_plan_name
    END
WHERE custom_price_rubles = 0
   OR plan IN ('partner', 'custom_free')
   OR (status = 'active' AND plan = 'enterprise' AND (custom_price_rubles IS NULL OR custom_price_rubles = 0));

-- 2. Бэкфилл каналов уведомлений Telegram для существующих пользователей
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
  u.tenant_id,
  'telegram',
  u.telegram_chat_id::text,
  jsonb_build_object(
    'username', u.telegram_username,
    'name', u.name,
    'source', 'telegram_auth',
    'auto_linked', true
  ),
  true,
  true,
  now(),
  now()
FROM users u
JOIN tenants t ON t.id = u.tenant_id
WHERE u.telegram_chat_id IS NOT NULL
  AND u.deleted_at IS NULL
ON CONFLICT (tenant_id, channel_type, destination) DO UPDATE
SET is_active = true,
    is_verified = true,
    extra_meta = tenant_notification_channels.extra_meta || EXCLUDED.extra_meta,
    updated_at = now();
