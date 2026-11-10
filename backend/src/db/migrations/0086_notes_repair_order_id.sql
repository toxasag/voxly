-- 0086_notes_repair_order_id.sql
-- Добавление ссылки на наряд repair_order_id для сквозной синхронизации заметок (Repair <-> Deal)

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS repair_order_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_repair_order_id
  ON notes (tenant_id, repair_order_id)
  WHERE repair_order_id IS NOT NULL;
