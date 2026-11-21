-- =============================================================================
-- 0119: Индексы под горячие запросы (чат сделки, список нарядов, задачи, аудит)
--
-- Только аддитивно: IF NOT EXISTS, существующие индексы и данные не меняются,
-- откат кода на предыдущую версию со схемой совместим.
--
-- Обычный CREATE INDEX (не CONCURRENTLY): раннер оборачивает файл в транзакцию,
-- а CONCURRENTLY в транзакции недопустим. Блокировка записи на время построения
-- короткая на объёмах этих таблиц; выкатывать вне пиковых часов.
-- =============================================================================

-- История чата сделки и LATERAL «последнее сообщение» в inbox/threads
CREATE INDEX IF NOT EXISTS idx_deal_messages_tenant_deal_created
  ON deal_messages (tenant_id, deal_id, created_at DESC);

-- Фильтры и сортировка списка нарядов сервис-центра
CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_status
  ON repair_orders (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_customer
  ON repair_orders (tenant_id, customer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_tenant_created
  ON repair_orders (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Календарь задач и вкладка задач в карточке сделки
CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_status_due
  ON crm_tasks (tenant_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_deal
  ON crm_tasks (tenant_id, deal_id)
  WHERE deal_id IS NOT NULL AND deleted_at IS NULL;

-- Сортировка таблицы сделок по обновлению
CREATE INDEX IF NOT EXISTS idx_deals_tenant_updated
  ON deals (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Лента аудита тенанта
CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant_created
  ON tenant_audit_log (tenant_id, created_at DESC);
