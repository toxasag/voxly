-- 0124_tenant_audit_log_indexes.sql
-- Индексы для быстрого поиска и фильтрации журнала действий пользователей и ошибок (tenant_audit_log)

CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant_created
  ON tenant_audit_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_created_at
  ON tenant_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_action
  ON tenant_audit_log (tenant_id, action);
