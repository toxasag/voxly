-- 0135_sync_supplier_order_transactions_category_and_author.sql
-- Идемпотентный бэкфилл для существующих расходных операций по заказам поставщикам:
-- 1. Привязываем transactions.supplier_order_id по supplier_orders.finance_transaction_id.
-- 2. Заполняем пустое transactions.category_name из finance_categories.name (или «Закупка запчастей»).
-- 3. Заполняем отсутствующий transactions.created_by из supplier_orders.created_by или владельца тенанта.

-- 1. Связь transactions.supplier_order_id <-> supplier_orders.id
UPDATE transactions t
SET supplier_order_id = so.id
FROM supplier_orders so
WHERE so.finance_transaction_id = t.id
  AND so.tenant_id = t.tenant_id
  AND t.supplier_order_id IS NULL;

-- 2. Восстанавливаем category_name из привязанной категории finance_categories там, где имя пустое
UPDATE transactions t
SET category_name = fc.name
FROM finance_categories fc
WHERE fc.id = t.category_id
  AND fc.tenant_id = t.tenant_id
  AND BTRIM(COALESCE(t.category_name, '')) = '';

-- 3. Для операций по заказам поставщикам без категории назначаем «Закупка запчастей»
INSERT INTO finance_categories (tenant_id, name, type)
SELECT DISTINCT t.tenant_id, 'Закупка запчастей', 'expense'
FROM transactions t
WHERE t.supplier_order_id IS NOT NULL
  AND t.direction = 'expense'
  AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM finance_categories fc
    WHERE fc.tenant_id = t.tenant_id
      AND fc.type = 'expense'
      AND lower(fc.name) LIKE '%запчаст%'
  );

UPDATE transactions t
SET category_id = sub.id,
    category_name = sub.name
FROM (
  SELECT DISTINCT ON (tenant_id) tenant_id, id, name
  FROM finance_categories
  WHERE type = 'expense'
    AND lower(name) LIKE '%запчаст%'
  ORDER BY tenant_id,
           CASE WHEN lower(btrim(name)) = 'закупка запчастей' THEN 0 ELSE 1 END,
           created_at ASC
) sub
WHERE t.tenant_id = sub.tenant_id
  AND t.supplier_order_id IS NOT NULL
  AND t.direction = 'expense'
  AND t.deleted_at IS NULL
  AND (t.category_id IS NULL OR BTRIM(COALESCE(t.category_name, '')) = '');

-- 4. Бэкфилл автора (created_by) для операций по заказам поставщикам из автора заказа
UPDATE transactions t
SET created_by = so.created_by
FROM supplier_orders so
WHERE so.id = t.supplier_order_id
  AND so.tenant_id = t.tenant_id
  AND t.created_by IS NULL
  AND so.created_by IS NOT NULL;

-- 5. Fallback автора для оставшихся операций без created_by — владелец/админ тенанта
UPDATE transactions t
SET created_by = (
  SELECT u.id
  FROM users u
  WHERE u.tenant_id = t.tenant_id
    AND u.deleted_at IS NULL
  ORDER BY (u.role = 'owner') DESC, (u.role = 'admin') DESC, u.created_at ASC
  LIMIT 1
)
WHERE t.created_by IS NULL
  AND t.deleted_at IS NULL;
