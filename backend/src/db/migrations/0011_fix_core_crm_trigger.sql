-- =============================================================================
-- 0011: Триггер запрета core_crm не должен мешать удалению арендатора
--
-- Миграция 0010 добавила BEFORE DELETE триггер на `installed_modules`, чтобы
-- базовую CRM нельзя было отключить. Побочный эффект обнаружился сразу:
-- `DELETE FROM tenants` каскадом удаляет строки `installed_modules`, триггер
-- срабатывает и на них, и удаление арендатора становится невозможным —
-- `core_crm is a base module and cannot be uninstalled`.
--
-- Это ломало и очистку тестовых данных, и будущий GDPR-purge арендатора.
--
-- Решение: триггер пропускает удаление, когда исчезает сам арендатор. Признак —
-- отсутствие строки в `tenants`: при каскаде родитель удаляется первым, поэтому
-- к моменту срабатывания триггера его уже нет.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

CREATE OR REPLACE FUNCTION forbid_core_crm_uninstall() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.slug <> 'core_crm' THEN
    RETURN OLD;
  END IF;

  -- Каскад от удаления арендатора: родительской строки уже нет, запрет не
  -- применяется. Отключение модуля живым арендатором — применяется.
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'core_crm is a base module and cannot be uninstalled'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
