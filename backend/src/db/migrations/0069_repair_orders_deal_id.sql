-- Добавление связи заказа на ремонт со сделкой CRM (0069_repair_orders_deal_id.sql)

ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_deal_id
  ON repair_orders(tenant_id, deal_id)
  WHERE deal_id IS NOT NULL;
