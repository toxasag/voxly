-- =============================================================================
-- 0076: Переменные агента (company override, consultant source) и RAG драфты
-- =============================================================================

-- 1. Добавляем поля в ai_agents для переопределения компании, источника консультанта и fallback-моделей
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS company_name_override TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consultant_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS consultant_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consultant_role TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fallback_models TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. Обновляем constraint статуса документов базы знаний для поддержки 'draft' и 'approved'
ALTER TABLE knowledge_base_documents DROP CONSTRAINT IF EXISTS knowledge_base_documents_status_check;
ALTER TABLE knowledge_base_documents ADD CONSTRAINT knowledge_base_documents_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'approved'::text]));

-- 3. Добавляем поле source_url в knowledge_base_documents для сохранения источника драфта
ALTER TABLE knowledge_base_documents
  ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL;

