-- =============================================================================
-- 0030: Добавление онлайн-чата (webchat) и официальных ботов (telegram_bot, max_bot)
-- в каталог marketplace_modules, а также таблица платформенных квот Базовой CRM.
-- =============================================================================

-- 1. Расширение ограничения допустимых каналов связи
ALTER TABLE channel_accounts
  DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;

ALTER TABLE channel_accounts
  ADD CONSTRAINT channel_accounts_channel_check
  CHECK (channel IN ('telegram', 'whatsapp', 'max', 'avito', 'instagram', 'webchat', 'telegram_bot', 'max_bot'));

-- 2. Добавление веб-чата и официальных ботов в каталог модулей
INSERT INTO marketplace_modules
  (slug, name, description, price_monthly, billing_kind, base_price, unit_price,
   included_units, unit_label, is_multi, category, icon, trial_days, features, sort_order)
VALUES
  ('webchat', 'Онлайн-чат на сайт',
   'Виджет чата для сайтов с AI-ассистентом. 1 сайт включен бесплатно в базовый тариф, дополнительные сайты — по тарифу.',
   500, 'per_unit', 0, 500, 1, 'сайт', true, 'integration', 'MessageSquareText', 14,
   ARRAY['1 сайт бесплатно в тарифе', 'Дополнительные сайты — 500 ₽/мес', 'Привязка AI-ассистентов', 'Сбор контактов в CRM'], 95),
  ('telegram_bot', 'Telegram-бот компании',
   'Официальный публичный бот компании через Bot API токен (@BotFather).',
   500, 'per_unit', 0, 500, 0, 'бот', true, 'integration', 'Bot', 14,
   ARRAY['Подключение по Bot API токену', 'Неограниченно клиентов', 'Команды и меню', 'Интеграция с AI-агентами'], 55),
  ('max_bot', 'MAX-бот компании',
   'Официальный публичный бот в мессенджере MAX по Bot API токену.',
   500, 'per_unit', 0, 500, 0, 'бот', true, 'integration', 'Hash', 14,
   ARRAY['Подключение по Bot API токену', 'Каналы и группы', 'Интеграция с AI-агентами'], 75)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  billing_kind = EXCLUDED.billing_kind,
  base_price = EXCLUDED.base_price,
  unit_price = EXCLUDED.unit_price,
  included_units = EXCLUDED.included_units,
  unit_label = EXCLUDED.unit_label,
  is_multi = EXCLUDED.is_multi,
  icon = EXCLUDED.icon,
  features = EXCLUDED.features;

-- 3. Платформенные настройки квот и цен Базовой CRM
CREATE TABLE IF NOT EXISTS platform_billing_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  base_crm_price NUMERIC(10, 2) NOT NULL DEFAULT 600,
  base_crm_users INT NOT NULL DEFAULT 10,
  base_crm_extra_user_price NUMERIC(10, 2) NOT NULL DEFAULT 200,
  base_crm_included_ai_agents INT NOT NULL DEFAULT 2,
  base_crm_included_telegram INT NOT NULL DEFAULT 2,
  base_crm_included_whatsapp INT NOT NULL DEFAULT 2,
  base_crm_included_max INT NOT NULL DEFAULT 2,
  base_crm_included_webchat INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_billing_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- 4. Обновление бесплатных квот в Базовом тарифе CRM
UPDATE marketplace_modules
SET included_units = 2
WHERE slug IN ('ai_bots', 'telegram', 'whatsapp', 'max');

UPDATE marketplace_modules
SET included_units = 1
WHERE slug = 'webchat';

-- 5. Поддержка отложенного изменения цен
ALTER TABLE installed_modules
  ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 month'),
  ADD COLUMN IF NOT EXISTS locked_unit_price NUMERIC DEFAULT NULL;

ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS pending_unit_price NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_effective_at TIMESTAMPTZ DEFAULT NULL;
