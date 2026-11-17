-- Migration 0105: Add city and address to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_city ON contacts (tenant_id, city) WHERE city <> '';
