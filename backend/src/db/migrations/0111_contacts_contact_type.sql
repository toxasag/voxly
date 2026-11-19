-- 0111_contacts_contact_type.sql
-- Разделение контактов на «Клиент» (customer) и «Поставщик» (vendor).

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_type VARCHAR(32) NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_contact_type_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_contact_type_check
      CHECK (contact_type IN ('customer', 'vendor'));
  END IF;
END $$;

UPDATE contacts SET contact_type = 'customer' WHERE contact_type IS NULL OR contact_type = '';

CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(tenant_id, contact_type) WHERE deleted_at IS NULL;
