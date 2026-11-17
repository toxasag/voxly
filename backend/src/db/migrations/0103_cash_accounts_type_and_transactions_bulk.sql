-- Migration 0103: Add account_type to cash_accounts and optimize transactions indices
ALTER TABLE cash_accounts ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'cash';

-- Check constraint for allowed account types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_accounts_account_type_check'
  ) THEN
    ALTER TABLE cash_accounts
      ADD CONSTRAINT cash_accounts_account_type_check
      CHECK (account_type IN ('bank', 'cash', 'acquiring', 'safe'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cash_accounts_tenant_type
  ON cash_accounts (tenant_id, account_type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_occurred
  ON transactions (tenant_id, occurred_at DESC) WHERE deleted_at IS NULL;
