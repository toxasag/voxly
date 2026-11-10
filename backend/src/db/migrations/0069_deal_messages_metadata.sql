-- ---------------------------------------------------------------------------
-- 0069_deal_messages_metadata.sql
--
-- Добавление JSONB поля metadata в таблицу deal_messages для хранения:
-- 1. transcript: { text, status, duration, language, error } (STT расшифровка аудио)
-- 2. document_info: { summary, doc_type, pages_count, file_size, attributes, status, error } (аннотация документа)
-- ---------------------------------------------------------------------------

ALTER TABLE deal_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_deal_messages_metadata_gin
  ON deal_messages USING GIN (metadata);
