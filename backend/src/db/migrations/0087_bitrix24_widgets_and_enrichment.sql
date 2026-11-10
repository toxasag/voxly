-- ---------------------------------------------------------------------------
-- 0087_bitrix24_widgets_and_enrichment.sql
--
-- Расширение интеграции Битрикс24:
-- 1. selected_widget_ids - фильтрация по конкретным виджетам тенанта
-- 2. custom_source_id - кастомный SOURCE_ID (по умолчанию UC_VWN1ZK)
-- 3. send_utm_marks - флаг передачи UTM-меток
-- 4. send_geo_data - флаг передачи геолокации и метаданных визита
-- ---------------------------------------------------------------------------

ALTER TABLE tenant_bitrix24_configs
  ADD COLUMN IF NOT EXISTS selected_widget_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS custom_source_id TEXT NOT NULL DEFAULT 'UC_VWN1ZK',
  ADD COLUMN IF NOT EXISTS send_utm_marks BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_geo_data BOOLEAN NOT NULL DEFAULT true;
