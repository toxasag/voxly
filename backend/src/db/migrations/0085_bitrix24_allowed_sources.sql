-- ---------------------------------------------------------------------------
-- 0085_bitrix24_allowed_sources.sql
--
-- Добавление списка разрешенных источников лидов (allowed_sources TEXT[])
-- в tenant_bitrix24_configs для гранулярной фильтрации экспорта заявок.
-- ---------------------------------------------------------------------------

ALTER TABLE tenant_bitrix24_configs
ADD COLUMN IF NOT EXISTS allowed_sources TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
