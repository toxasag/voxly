-- =============================================================================
-- 0126: Синхронизация расчётного счёта организации (finance_organizations)
--       с безналичным счётом в cash_accounts
-- =============================================================================

ALTER TABLE cash_accounts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES finance_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_number TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cash_accounts_org_id
  ON cash_accounts (tenant_id, organization_id)
  WHERE deleted_at IS NULL AND organization_id IS NOT NULL;

DO $$
DECLARE
  org_rec RECORD;
  existing_bank_id UUID;
  acc_name TEXT;
BEGIN
  FOR org_rec IN
    SELECT id,
           tenant_id,
           trim(COALESCE(bank_name, '')) AS bank_name,
           trim(COALESCE(settlement_account, '')) AS settlement_account
    FROM finance_organizations
    WHERE deleted_at IS NULL
      AND (trim(COALESCE(settlement_account, '')) <> '' OR trim(COALESCE(bank_name, '')) <> '')
    ORDER BY is_default DESC, created_at ASC
  LOOP
    SELECT id INTO existing_bank_id
    FROM cash_accounts
    WHERE tenant_id = org_rec.tenant_id
      AND organization_id = org_rec.id
      AND deleted_at IS NULL
    LIMIT 1;

    IF existing_bank_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    IF org_rec.settlement_account <> '' THEN
      SELECT id INTO existing_bank_id
      FROM cash_accounts
      WHERE tenant_id = org_rec.tenant_id
        AND account_type = 'bank'
        AND organization_id IS NULL
        AND trim(account_number) = org_rec.settlement_account
        AND deleted_at IS NULL
      LIMIT 1;
    END IF;

    acc_name := CASE
      WHEN org_rec.bank_name <> '' THEN 'Расчётный счёт (' || org_rec.bank_name || ')'
      ELSE 'Расчётный счёт'
    END;

    IF existing_bank_id IS NOT NULL THEN
      UPDATE cash_accounts
      SET organization_id = org_rec.id,
          name = acc_name,
          account_number = org_rec.settlement_account,
          updated_at = now()
      WHERE id = existing_bank_id;
    ELSE
      INSERT INTO cash_accounts (
        tenant_id,
        organization_id,
        name,
        account_type,
        account_number,
        currency,
        balance,
        is_default
      )
      VALUES (
        org_rec.tenant_id,
        org_rec.id,
        acc_name,
        'bank',
        org_rec.settlement_account,
        'RUB',
        0,
        false
      );
    END IF;
  END LOOP;
END
$$;
