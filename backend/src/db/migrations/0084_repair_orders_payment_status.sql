-- 0084_repair_orders_payment_status.sql
-- Добавление статуса оплаты (unpaid, invoiced, paid) для наряд-заказов сервисного центра

ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';

CREATE INDEX IF NOT EXISTS idx_repair_orders_payment_status
  ON repair_orders (tenant_id, payment_status);

-- Для существующих нарядов со статусом "issued" (выдан) проставляем "paid" (оплачен)
UPDATE repair_orders
SET payment_status = 'paid'
WHERE status = 'issued' AND payment_status = 'unpaid';
