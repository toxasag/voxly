-- 0098_invoice_repair_orders.sql
-- Связь счетов со множеством наряд-заказов (актов ремонта) + банковские реквизиты для счетов на оплату

CREATE TABLE IF NOT EXISTS invoice_repair_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  repair_order_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoice_repair_orders UNIQUE (tenant_id, invoice_id, repair_order_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_repair_orders_repair ON invoice_repair_orders (tenant_id, repair_order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_repair_orders_invoice ON invoice_repair_orders (tenant_id, invoice_id);

ALTER TABLE invoice_repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_repair_orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_repair_orders_isolation ON invoice_repair_orders;
CREATE POLICY invoice_repair_orders_isolation ON invoice_repair_orders
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- Расширение настроек печатных форм банковскими реквизитами для формирования счетов
ALTER TABLE print_template_settings
  ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bik TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS corr_account TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_account TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS company_kpp TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS director_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accountant_name TEXT NOT NULL DEFAULT '';

-- Бэкфилл связей для уже существующих счетов
INSERT INTO invoice_repair_orders (tenant_id, invoice_id, repair_order_id)
SELECT tenant_id, id, repair_order_id
FROM invoices
WHERE repair_order_id IS NOT NULL
ON CONFLICT (tenant_id, invoice_id, repair_order_id) DO NOTHING;
