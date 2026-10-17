-- =============================================================================
-- 0032: Флаг suppress_deal_creation для контактов.
-- Защищает от создания новых сделок в пайплайне, если менеджер закрыл/удалил сделку
-- или явно пометил контакт как не требующий создания сделок при входящих сообщениях.
-- =============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS suppress_deal_creation BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_suppress_deal ON contacts(tenant_id, suppress_deal_creation) WHERE deleted_at IS NULL;
