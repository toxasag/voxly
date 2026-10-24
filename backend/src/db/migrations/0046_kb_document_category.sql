-- =============================================================================
-- 0046: Категории документов базы знаний (Knowledge Base Document Categories).
-- Позволяет классифицировать документы агента:
--   - price_list: прайс-листы, спецификации, каталоги
--   - commercial_offer: коммерческие предложения, пакеты услуг
--   - manual: регламенты, стандарты обслуживания, инструкции
--   - general: общие сведения, FAQ
-- =============================================================================

ALTER TABLE knowledge_base_documents ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant_agent_category
  ON knowledge_base_documents(tenant_id, agent_id, category);
