-- 0118_finance_organizations_and_elba.sql
-- Организации-поставщики для выставления счетов, конструктор РФ-счёта с логотипом,
-- режимы НДС и интеграция с Контур.Эльбой (Public API).

CREATE TABLE IF NOT EXISTS finance_organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  org_type TEXT NOT NULL DEFAULT 'ip' CHECK (org_type IN ('ip', 'ooo', 'self_employed')),

  -- Основные и контактные реквизиты
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  inn TEXT NOT NULL DEFAULT '',
  kpp TEXT NOT NULL DEFAULT '',
  ogrn TEXT NOT NULL DEFAULT '',
  legal_address TEXT NOT NULL DEFAULT '',
  actual_address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  edo_info TEXT NOT NULL DEFAULT '',

  -- Банковские реквизиты
  bank_name TEXT NOT NULL DEFAULT '',
  bik TEXT NOT NULL DEFAULT '',
  corr_account TEXT NOT NULL DEFAULT '',
  settlement_account TEXT NOT NULL DEFAULT '',

  -- Подписанты
  director_title TEXT NOT NULL DEFAULT 'Индивидуальный предприниматель',
  director_name TEXT NOT NULL DEFAULT '',
  accountant_name TEXT NOT NULL DEFAULT '',

  -- Налогообложение / НДС по умолчанию
  vat_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (vat_mode IN ('none', 'included_5', 'included_7', 'included_10', 'included_20')),

  -- Оформление и конструктор печатной формы счёта РФ
  logo_url TEXT NOT NULL DEFAULT '',
  logo_width INTEGER NOT NULL DEFAULT 140,
  stamp_url TEXT NOT NULL DEFAULT '',
  signature_url TEXT NOT NULL DEFAULT '',
  invoice_config JSONB NOT NULL DEFAULT '{
    "showLogo": true,
    "showQrCode": true,
    "showContactsHeader": true,
    "showEdo": true,
    "showNotice": false,
    "noticeText": "Внимание! Оплата данного счёта означает согласие с условиями поставки товара / оказания услуг.",
    "showBasis": false,
    "showAccountant": false,
    "showStamp": true,
    "showSignature": true,
    "invoiceNumberPrefix": "СЧ",
    "accentColor": "#4a38f5",
    "footerNote": ""
  }'::jsonb,

  -- Интеграция с Контур.Эльбой (ключ хранится в AES-256-GCM)
  elba_enabled BOOLEAN NOT NULL DEFAULT false,
  elba_api_key_enc TEXT NOT NULL DEFAULT '',
  elba_api_key_hint TEXT NOT NULL DEFAULT '',
  elba_organization_id TEXT NOT NULL DEFAULT '',
  elba_organization_name TEXT NOT NULL DEFAULT '',
  elba_bank_account_id TEXT NOT NULL DEFAULT '',
  elba_auto_sync_invoices BOOLEAN NOT NULL DEFAULT false,
  elba_last_sync_at TIMESTAMPTZ,
  elba_last_error TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_finance_organizations_tenant
  ON finance_organizations (tenant_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_organizations_default
  ON finance_organizations (tenant_id) WHERE is_default = true AND deleted_at IS NULL;

ALTER TABLE finance_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_organizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_organizations_isolation ON finance_organizations;
CREATE POLICY finance_organizations_isolation ON finance_organizations
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON finance_organizations TO app_user';
  END IF;
END $$;

-- Расширение таблицы invoices: привязка к организации-поставщику, снапшот реквизитов, режим НДС и поля Эльбы
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS issuer_organization_id UUID REFERENCES finance_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issuer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vat_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS elba_bill_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS elba_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elba_sync_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_invoices_issuer_org
  ON invoices (tenant_id, issuer_organization_id) WHERE deleted_at IS NULL;

-- Бэкфилл: создать организацию по умолчанию из print_template_settings для существующих тенантов
INSERT INTO finance_organizations (
  tenant_id, is_default, org_type, name, inn, kpp, ogrn,
  legal_address, phone, email, website,
  bank_name, bik, corr_account, settlement_account,
  director_title, director_name, accountant_name,
  vat_mode, logo_url
)
SELECT
  pts.tenant_id,
  true,
  CASE WHEN length(btrim(pts.company_inn)) = 10 THEN 'ooo' ELSE 'ip' END,
  COALESCE(NULLIF(btrim(pts.company_name), ''), 'Моя организация'),
  COALESCE(pts.company_inn, ''),
  COALESCE(pts.company_kpp, ''),
  COALESCE(pts.company_ogrn, ''),
  COALESCE(pts.company_address, ''),
  COALESCE(pts.company_phone, ''),
  COALESCE(pts.company_email, ''),
  COALESCE(pts.company_website, ''),
  COALESCE(pts.bank_name, ''),
  COALESCE(pts.bik, ''),
  COALESCE(pts.corr_account, ''),
  COALESCE(pts.settlement_account, ''),
  CASE WHEN length(btrim(pts.company_inn)) = 10 THEN 'Генеральный директор' ELSE 'Индивидуальный предприниматель' END,
  COALESCE(pts.director_name, ''),
  COALESCE(pts.accountant_name, ''),
  'none',
  COALESCE(pts.logo_url, '')
FROM print_template_settings pts
WHERE NOT EXISTS (
  SELECT 1 FROM finance_organizations fo
  WHERE fo.tenant_id = pts.tenant_id AND fo.deleted_at IS NULL
);
