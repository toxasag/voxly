-- Поддержка типа документа в таблице invoices: счёт на оплату (invoice) и коммерческое предложение (proposal)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_document_type_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_document_type_check
      CHECK (document_type IN ('invoice', 'proposal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_deal_doc_type
  ON invoices (tenant_id, deal_id, document_type)
  WHERE deleted_at IS NULL AND deal_id IS NOT NULL;
