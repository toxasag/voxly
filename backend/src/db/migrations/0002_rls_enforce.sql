-- =============================================================================
-- 0002: Реально работающая изоляция арендаторов (RLS)
--
-- Проблема, которую закрывает миграция: политики `tenant_isolation` были
-- созданы ещё в schema.sql, но не действовали ни на одной строке. Причин две:
--   1. Приложение подключалось ролью `getvoxly` — владельцем всех таблиц.
--      Владелец не подпадает под RLS без `FORCE ROW LEVEL SECURITY`.
--   2. В образе postgres эта же роль является SUPERUSER с `rolbypassrls`,
--      а суперпользователя не останавливает даже `FORCE`.
-- Поэтому одного включения `FORCE` недостаточно: нужна отдельная
-- непривилегированная роль для пула соединений.
--
-- Итог: `app_user` (NOSUPERUSER, NOBYPASSRLS) получает только DML-права, и
-- каждый его запрос проходит через политики. Владелец таблиц `getvoxly`
-- остаётся для миграций и `docker-entrypoint-initdb.d`.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Роль приложения
-- -----------------------------------------------------------------------------
-- Пароль подставляется из окружения вызывающим скриптом (psql -v app_password=…),
-- чтобы не фиксировать секрет в репозитории.
--
-- Через \gexec, а не DO-блок: psql не подставляет переменные внутри
-- dollar-quoted строк, поэтому в `DO $$ ... :'app_password' ... $$` секрет
-- попал бы в БД буквальным текстом ":'app_password'".

SELECT format('CREATE ROLE app_user LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
\gexec

-- Отдельным шагом: приводит пароль к актуальному и когда роль уже была создана.
SELECT format('ALTER ROLE app_user PASSWORD %L', :'app_password')
\gexec

-- Явно снимаем всё, что позволило бы обойти политики.
ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

-- -----------------------------------------------------------------------------
-- 2. Права
-- -----------------------------------------------------------------------------
-- Только DML. DDL остаётся за владельцем схемы, поэтому скомпрометированное
-- приложение не может удалить таблицу или отключить политику.

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Таблицы, добавленные будущими миграциями, должны быть доступны сразу:
-- без этого новый CREATE TABLE молча ломал бы приложение правом доступа.
ALTER DEFAULT PRIVILEGES FOR ROLE getvoxly IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE getvoxly IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- -----------------------------------------------------------------------------
-- 3. Платформенный скоуп
-- -----------------------------------------------------------------------------
-- Superadmin-панель считает метрики по всем арендаторам. Отдельная роль для
-- неё означала бы второй пул соединений, поэтому признак передаётся GUC
-- `app.platform_scope`, который выставляет только гейт requirePlatformOwner
-- (plugins/authorize.ts) после проверки users.platform_role.

CREATE OR REPLACE FUNCTION platform_scope() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.platform_scope', true), 'off') = 'on';
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- 4. Политики: FORCE + учёт платформенного скоупа
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'contacts', 'companies', 'deals', 'deal_messages', 'deal_stage_history', 'crm_tasks',
    'repair_orders', 'repair_works', 'repair_parts', 'repair_notes', 'repair_photos',
    'device_models', 'cash_accounts', 'finance_categories', 'transactions', 'invoices',
    'installed_modules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    -- Ключевая строка: без FORCE владелец таблицы игнорирует политики.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id() OR platform_scope())
         WITH CHECK (tenant_id = current_tenant_id())',
      target_table
    );
  END LOOP;
END;
$$;

-- WITH CHECK сознательно не содержит platform_scope(): читать агрегаты по всем
-- арендаторам платформенной панели нужно, а писать от их имени — нет.

-- invoice_items не имеет своего tenant_id и наследует область родителя.
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_items;
CREATE POLICY tenant_isolation ON invoice_items
  USING (
    platform_scope() OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.tenant_id = current_tenant_id()
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Таблицы вне tenant-политики
-- -----------------------------------------------------------------------------
-- `tenants`, `users`, `otp_codes`, `refresh_tokens`, `marketplace_modules`,
-- `repair_counters`, `pipelines`, `stages` и `tenant_audit_log` остаются без
-- политики tenant_isolation осознанно:
--   * otp_codes / refresh_tokens читаются до появления tenant-контекста (по
--     номеру телефона и по хешу токена), политика сверялась бы с NULL GUC и
--     заблокировала бы вход;
--   * users читается тем же хуком authenticate до установки контекста;
--   * tenants и marketplace_modules — платформенные справочники.
-- Изоляция для них обеспечивается явными WHERE в SQL.
