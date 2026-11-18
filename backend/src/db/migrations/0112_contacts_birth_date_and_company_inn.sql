-- =============================================================================
-- Migration 0111: Add birth_date and company_inn to contacts, kpp to companies
-- =============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS company_inn TEXT;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS kpp TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_company_inn
  ON contacts (tenant_id, company_inn)
  WHERE company_inn IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_birth_date
  ON contacts (tenant_id, birth_date)
  WHERE birth_date IS NOT NULL;
