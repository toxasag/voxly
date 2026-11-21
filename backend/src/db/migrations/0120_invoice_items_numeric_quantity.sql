-- 0120_invoice_items_numeric_quantity.sql
-- Поддержка дробного количества (нормо-часы и др.) в строках счёта

ALTER TABLE invoice_items
  ALTER COLUMN quantity TYPE NUMERIC(12, 3) USING quantity::numeric;
