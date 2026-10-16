-- =============================================================================
-- 0010: Реальное удаление данных при отключении модуля
--
-- До этой миграции отключение модуля удаляло только строку в
-- `installed_modules`: на неё не ссылается ни один внешний ключ и нет ни одного
-- триггера (проверено), поэтому заказ-наряды, счета и транзакции оставались в
-- БД, а `requireModule` лишь закрывал к ним доступ через API. Интерфейс при этом
-- собирался предупреждать об удалении данных — то есть обещал то, чего не
-- происходило.
--
-- Выбрано мягкое удаление с окном восстановления, а не немедленный DELETE:
-- отключение модуля — один клик, а сервисный центр за год работы содержит всю
-- историю ремонтов. Безвозвратное уничтожение по одному клику несоразмерно
-- действию, даже с подтверждением.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `deleted_at` для таблиц модулей, где его не было
-- -----------------------------------------------------------------------------
-- Уже есть у: companies, contacts, crm_tasks, deals, invoices, repair_orders,
-- users. Добавляем остальным таблицам, принадлежащим отключаемым модулям.
--
-- Дочерние таблицы (repair_notes, repair_parts, repair_photos, repair_works,
-- invoice_items) сознательно НЕ получают колонку: они удаляются каскадом
-- (`ON DELETE CASCADE`) вместе с родителем при окончательной очистке, а до неё
-- недоступны вместе с ним.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE cash_accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transactions_not_deleted
  ON transactions (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_accounts_not_deleted
  ON cash_accounts (tenant_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Журнал отключений модулей
-- -----------------------------------------------------------------------------
-- Нужен, чтобы знать, что именно и когда помечено удалённым: без этого повторное
-- включение модуля не смогло бы восстановить ровно те строки, которые скрыло
-- отключение, и задело бы записи, удалённые пользователем вручную раньше.
--
-- Вне RLS не выносится: это данные арендатора, и политика применяется как ко
-- всем остальным таблицам (см. цикл в schema.sql).
CREATE TABLE IF NOT EXISTS module_data_purges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,

  -- Кто отключил: для разбора претензий «данные пропали».
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Сколько строк затронуто по таблицам: {"repair_orders": 128, ...}
  affected JSONB NOT NULL DEFAULT '{}',

  -- Момент, после которого данные можно вычищать окончательно.
  purge_after TIMESTAMPTZ NOT NULL,

  -- Заполняется, когда модуль включили обратно до окончания окна.
  restored_at TIMESTAMPTZ,
  -- Заполняется, когда данные вычищены окончательно.
  purged_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_module_data_purges_pending
  ON module_data_purges (tenant_id, slug)
  WHERE restored_at IS NULL AND purged_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Базовая CRM не отключается
-- -----------------------------------------------------------------------------
-- Инвариант в схеме, а не только в интерфейсе: `core_crm` содержит контакты,
-- компании и сделки, на которые ссылаются все остальные модули (например
-- `repair_orders.customer_id` → `contacts`). Его отключение сделало бы
-- неработоспособной всю систему, поэтому запрет должен держаться на уровне БД,
-- а не на скрытой кнопке — запрос можно отправить и минуя интерфейс.
--
-- Реализовано триггером, а не CHECK: нужно запретить именно DELETE строки, а
-- CHECK на удаление не срабатывает.
CREATE OR REPLACE FUNCTION forbid_core_crm_uninstall() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.slug = 'core_crm' THEN
    RAISE EXCEPTION 'core_crm is a base module and cannot be uninstalled'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_core_crm_uninstall ON installed_modules;
CREATE TRIGGER trg_forbid_core_crm_uninstall
  BEFORE DELETE ON installed_modules
  FOR EACH ROW EXECUTE FUNCTION forbid_core_crm_uninstall();

-- -----------------------------------------------------------------------------
-- 4. Права app_user
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON module_data_purges TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cash_accounts TO app_user';
  END IF;
END;
$$;

-- RLS на новую таблицу: те же правила, что у остальных данных арендатора.
ALTER TABLE module_data_purges ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_data_purges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON module_data_purges;
CREATE POLICY tenant_isolation ON module_data_purges
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
