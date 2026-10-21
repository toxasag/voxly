-- =============================================================================
-- 0038: Бесплатные квоты ботов и онлайн-чата в основном тарифе GETVOXLY.
-- Установка included_units = 1 для telegram_bot и max_bot, отключение ложного
-- триала trial_days для всех модулей, входящих в базовый тариф навсегда.
-- =============================================================================

-- 1. Установка 1 бесплатного бота в базовом тарифе для telegram_bot и max_bot
UPDATE marketplace_modules
SET included_units = 1,
    trial_days = 0,
    description = 'Официальный публичный бот компании через Bot API токен (@BotFather). 1 бот включен бесплатно в базовый тариф, дополнительные боты — по тарифу.',
    features = ARRAY['1 бот бесплатно в тарифе', 'Дополнительные боты — 500 ₽/мес', 'Подключение по Bot API токену', 'Неограниченно клиентов', 'Команды и меню', 'Интеграция с AI-агентами']
WHERE slug = 'telegram_bot';

UPDATE marketplace_modules
SET included_units = 1,
    trial_days = 0,
    description = 'Официальный публичный бот в мессенджере MAX по Bot API токену. 1 бот включен бесплатно в базовый тариф, дополнительные боты — по тарифу.',
    features = ARRAY['1 бот бесплатно в тарифе', 'Дополнительные боты — 500 ₽/мес', 'Подключение по Bot API токену', 'Каналы и группы', 'Интеграция с AI-агентами']
WHERE slug = 'max_bot';

-- 2. Отключение trial_days для webchat и остальных модулей с постоянными бесплатными квотами
UPDATE marketplace_modules
SET trial_days = 0
WHERE slug IN ('webchat', 'telegram', 'whatsapp', 'max', 'ai_bots', 'core_crm');

-- 3. Добавление колонок в platform_billing_config
ALTER TABLE platform_billing_config
  ADD COLUMN IF NOT EXISTS base_crm_included_telegram_bot INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_crm_included_max_bot INT NOT NULL DEFAULT 1;

-- 4. Очистка устаревших trial_ends_at в installed_modules для модулей с постоянными бесплатными квотами
UPDATE installed_modules i
SET trial_ends_at = NULL
FROM marketplace_modules m
WHERE i.slug = m.slug AND m.included_units > 0;
