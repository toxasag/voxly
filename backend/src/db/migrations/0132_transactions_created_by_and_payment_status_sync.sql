-- 0132_transactions_created_by_and_payment_status_sync.sql
-- 1. Добавляем колонку created_by в таблицу transactions для фиксации автора операции
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_created_by
  ON transactions (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

-- 2. Бэкфилл автора (created_by) для существующих операций:
-- Сначала из мастера наряд-заказа
UPDATE transactions t
SET created_by = ro.master_id
FROM repair_orders ro
WHERE ro.id = t.repair_order_id
  AND ro.tenant_id = t.tenant_id
  AND t.created_by IS NULL
  AND ro.master_id IS NOT NULL;

-- Для остальных операций берём первого администратора/владельца тенанта
UPDATE transactions t
SET created_by = (
  SELECT u.id
  FROM users u
  WHERE u.tenant_id = t.tenant_id
  ORDER BY (u.role = 'owner') DESC, (u.role = 'admin') DESC, u.created_at ASC
  LIMIT 1
)
WHERE t.created_by IS NULL;

-- 3. Бэкфилл контрагента (counterparty_name, counterparty_inn) для существующих операций
-- Из связанных счетов
UPDATE transactions t
SET counterparty_name = COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(i.contact_name), ''), ''),
    counterparty_inn = COALESCE(TRIM(i.company_inn), '')
FROM invoices i
WHERE i.id = t.invoice_id
  AND i.tenant_id = t.tenant_id
  AND (t.counterparty_name = '' OR t.counterparty_name IS NULL);

-- Из связанных наряд-заказов
UPDATE transactions t
SET counterparty_name = COALESCE(TRIM(ro.customer_name), '')
FROM repair_orders ro
WHERE ro.id = t.repair_order_id
  AND ro.tenant_id = t.tenant_id
  AND (t.counterparty_name = '' OR t.counterparty_name IS NULL);

-- 4. Бэкфилл категорий доходов для операций оплаты счетов без категории
UPDATE transactions t
SET category_id = fc.id,
    category_name = fc.name
FROM finance_categories fc
WHERE t.category_id IS NULL
  AND t.direction = 'income'
  AND fc.tenant_id = t.tenant_id
  AND fc.type = 'income'
  AND (fc.name ILIKE '%работ%' OR fc.name ILIKE '%услуг%')
  AND EXISTS (
    SELECT 1 FROM invoice_items ii
    WHERE ii.invoice_id = t.invoice_id
      AND (ii.source = 'repair_work' OR ii.description ILIKE '%работ%' OR ii.description ILIKE '%ремонт%')
  );

UPDATE transactions t
SET category_id = fc.id,
    category_name = fc.name
FROM finance_categories fc
WHERE t.category_id IS NULL
  AND t.direction = 'income'
  AND fc.tenant_id = t.tenant_id
  AND fc.type = 'income'
  AND (fc.name ILIKE '%запчаст%' OR fc.name ILIKE '%продаж%')
  AND EXISTS (
    SELECT 1 FROM invoice_items ii
    WHERE ii.invoice_id = t.invoice_id
      AND (ii.source = 'repair_part' OR ii.description ILIKE '%запчаст%')
  );

-- 5. Синхронизация статусов счетов:
-- Если счет помечен paid, но сумма активных (не удаленных) доходных операций меньше суммы счета,
-- возвращаем счет в 'sent' (или 'overdue', если срок оплаты прошел) и сбрасываем paid_at / paid_account_id
UPDATE invoices i
SET status = CASE WHEN i.due_date < now() THEN 'overdue' ELSE 'sent' END,
    paid_at = NULL,
    paid_account_id = NULL,
    updated_at = now()
WHERE i.deleted_at IS NULL
  AND i.status = 'paid'
  AND COALESCE((
    SELECT SUM(t.amount)
    FROM transactions t
    WHERE t.tenant_id = i.tenant_id
      AND t.invoice_id = i.id
      AND t.direction = 'income'
      AND t.deleted_at IS NULL
  ), 0) < i.total;

-- 6. Синхронизация статусов оплаты наряд-заказов (payment_status):
-- Если наряд был paid, но активных оплаченных счетов и прямых платежей нет,
-- а есть активные выставленные счета (sent / overdue / draft), возвращаем в 'invoiced'
UPDATE repair_orders ro
SET payment_status = 'invoiced',
    updated_at = now()
WHERE ro.deleted_at IS NULL
  AND ro.payment_status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM invoices i
    LEFT JOIN invoice_repair_orders iro ON iro.invoice_id = i.id AND iro.tenant_id = i.tenant_id
    WHERE i.tenant_id = ro.tenant_id
      AND i.deleted_at IS NULL
      AND i.status = 'paid'
      AND (i.repair_order_id = ro.id OR iro.repair_order_id = ro.id)
  )
  AND COALESCE((
    SELECT SUM(t.amount)
    FROM transactions t
    WHERE t.tenant_id = ro.tenant_id
      AND t.repair_order_id = ro.id
      AND t.direction = 'income'
      AND t.deleted_at IS NULL
  ), 0) < COALESCE(NULLIF(ro.final_cost, 0), NULLIF(ro.estimated_cost, 0), 1)
  AND EXISTS (
    SELECT 1 FROM invoices i2
    LEFT JOIN invoice_repair_orders iro2 ON iro2.invoice_id = i2.id AND iro2.tenant_id = i2.tenant_id
    WHERE i2.tenant_id = ro.tenant_id
      AND i2.deleted_at IS NULL
      AND i2.status IN ('sent', 'overdue', 'draft')
      AND (i2.repair_order_id = ro.id OR iro2.repair_order_id = ro.id)
  );
