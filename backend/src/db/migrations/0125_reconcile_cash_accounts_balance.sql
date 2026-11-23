-- 0125_reconcile_cash_accounts_balance.sql
-- Синхронизация балансов всех счетов строго с суммой активных операций (transactions WHERE deleted_at IS NULL).
-- Исключает «фантомные» остатки без операций (например, после создания счёта с opening_balance без проводки и удаления всех операций).

UPDATE cash_accounts a
SET balance = COALESCE((
  SELECT SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE -t.amount END)
  FROM transactions t
  WHERE t.tenant_id = a.tenant_id
    AND t.cash_account_id = a.id
    AND t.deleted_at IS NULL
), 0)
WHERE a.deleted_at IS NULL
  AND a.balance IS DISTINCT FROM COALESCE((
    SELECT SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE -t.amount END)
    FROM transactions t
    WHERE t.tenant_id = a.tenant_id
      AND t.cash_account_id = a.id
      AND t.deleted_at IS NULL
  ), 0);
