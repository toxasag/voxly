-- =============================================================================
-- 0131: Очистка сообщений переписок для удалённых сделок и триггер авто-очистки
-- =============================================================================

-- 1. Удаляем сообщения чатов для всех уже удалённых (soft-deleted) сделок
DELETE FROM deal_messages
WHERE deal_id IN (
  SELECT id FROM deals WHERE deleted_at IS NOT NULL
);

-- 2. Удаляем осиротевшие сообщения без сделок (если такие были)
DELETE FROM deal_messages
WHERE deal_id NOT IN (
  SELECT id FROM deals
);

-- 3. Триггер для автоматического каскадного удаления переписок при soft-delete сделки
CREATE OR REPLACE FUNCTION trg_deals_soft_delete_messages()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM deal_messages WHERE deal_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deals_soft_delete_messages ON deals;

CREATE TRIGGER trg_deals_soft_delete_messages
AFTER UPDATE OF deleted_at ON deals
FOR EACH ROW
WHEN (NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION trg_deals_soft_delete_messages();
