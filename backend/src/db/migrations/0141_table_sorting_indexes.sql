-- =============================================================================
-- 0141: B-tree индексы под серверную сортировку и детерминированную пагинацию
-- =============================================================================
-- Только аддитивно (`CREATE INDEX IF NOT EXISTS`). Составные ключи включают
-- `tenant_id` (RLS/изоляция) и `id` (tie-breaker при пагинации `LIMIT/OFFSET`).

-- Склад: Номенклатура (сортировка по имени, мин. остатку, ценам, дате создания)
CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_name_sort
  ON warehouse_items (tenant_id, name, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_min_stock_sort
  ON warehouse_items (tenant_id, min_stock, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_cost_price_sort
  ON warehouse_items (tenant_id, cost_price, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_retail_price_sort
  ON warehouse_items (tenant_id, retail_price, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant_created_sort
  ON warehouse_items (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Склад: Партии, Движения, Заявки на закупку, Заказы поставщикам
CREATE INDEX IF NOT EXISTS idx_warehouse_batches_tenant_received_sort
  ON warehouse_batches (tenant_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_tenant_created_sort
  ON warehouse_movements (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_tenant_created_sort
  ON purchase_requests (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_created_sort
  ON supplier_orders (tenant_id, created_at DESC, id DESC);

-- CRM: Контакты, Компании, Сделки, Задачи
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created_sort
  ON contacts (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_name_sort
  ON contacts (tenant_id, first_name, last_name, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_companies_tenant_created_sort
  ON companies (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_companies_tenant_name_sort
  ON companies (tenant_id, name, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_tenant_created_sort
  ON deals (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_tenant_budget_sort
  ON deals (tenant_id, budget DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_created_sort
  ON crm_tasks (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_due_sort
  ON crm_tasks (tenant_id, due_date ASC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

-- Сервисный центр: Наряд-заказы
CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_received_sort
  ON repair_orders (tenant_id, received_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_ticket_sort
  ON repair_orders (tenant_id, ticket_number, id DESC)
  WHERE deleted_at IS NULL;

-- Финансы: Операции и Счета
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_occurred_sort
  ON transactions (tenant_id, occurred_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_amount_sort
  ON transactions (tenant_id, amount DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_issue_date_sort
  ON invoices (tenant_id, issue_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_total_sort
  ON invoices (tenant_id, total DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Справочник услуг
CREATE INDEX IF NOT EXISTS idx_repair_services_catalog_tenant_price_sort
  ON repair_services_catalog (tenant_id, default_price, id DESC);
