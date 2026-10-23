-- =============================================================================
-- 0040: Исправление RLS политик subscriptions и billing_payments
--
-- Миграция 0031 использовала прямой каст current_setting('app.tenant_id', true)::uuid
-- вместо функции current_tenant_id() OR platform_scope(). При пустом app.tenant_id
-- (например, в платформенной админке или при удалении арендатора) Postgres падал с:
-- "invalid input syntax for type uuid: ''".
--
-- Исправление приводит политики к общему стандарту:
-- USING (tenant_id = current_tenant_id() OR platform_scope())
-- WITH CHECK (tenant_id = current_tenant_id())
-- =============================================================================

DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON billing_payments;
CREATE POLICY tenant_isolation ON billing_payments
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
