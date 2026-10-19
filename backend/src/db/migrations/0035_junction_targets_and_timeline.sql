-- -----------------------------------------------------------------------------
-- 0035: Junction-таблицы для NoteTarget и TaskTarget (Twenty CRM Parity)
-- и добавление вкладки Timeline в карточки записей
-- -----------------------------------------------------------------------------

-- 1. note_targets ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS note_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('contact', 'company', 'deal')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_note_target UNIQUE (note_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_note_targets_target
  ON note_targets (tenant_id, target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_targets_note
  ON note_targets (tenant_id, note_id);

ALTER TABLE note_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_targets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON note_targets;
CREATE POLICY tenant_isolation ON note_targets
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 2. task_targets ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES crm_tasks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('contact', 'company', 'deal')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_target UNIQUE (task_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_task_targets_target
  ON task_targets (tenant_id, target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_targets_task
  ON task_targets (tenant_id, task_id);

ALTER TABLE task_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_targets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task_targets;
CREATE POLICY tenant_isolation ON task_targets
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- 3. Миграция существующих данных в junction-таблицы -------------------------
INSERT INTO note_targets (tenant_id, note_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'contact', contact_id, created_at
FROM notes WHERE contact_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (note_id, target_type, target_id) DO NOTHING;

INSERT INTO note_targets (tenant_id, note_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'company', company_id, created_at
FROM notes WHERE company_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (note_id, target_type, target_id) DO NOTHING;

INSERT INTO note_targets (tenant_id, note_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'deal', deal_id, created_at
FROM notes WHERE deal_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (note_id, target_type, target_id) DO NOTHING;

INSERT INTO task_targets (tenant_id, task_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'contact', contact_id, created_at
FROM crm_tasks WHERE contact_id IS NOT NULL
ON CONFLICT (task_id, target_type, target_id) DO NOTHING;

INSERT INTO task_targets (tenant_id, task_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'company', company_id, created_at
FROM crm_tasks WHERE company_id IS NOT NULL
ON CONFLICT (task_id, target_type, target_id) DO NOTHING;

INSERT INTO task_targets (tenant_id, task_id, target_type, target_id, created_at)
SELECT tenant_id, id, 'deal', deal_id, created_at
FROM crm_tasks WHERE deal_id IS NOT NULL
ON CONFLICT (task_id, target_type, target_id) DO NOTHING;

-- 4. Добавляем вкладку Timeline (позиция 20) для всех существующих тенантов ---
DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'contact', 'timeline', 'Активность', 'Clock', 20, true, NULL, NULL),
      (tenant_rec.id, 'company', 'timeline', 'Активность', 'Clock', 20, true, NULL, NULL),
      (tenant_rec.id, 'deal',    'timeline', 'Активность', 'Clock', 20, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;
  END LOOP;
END;
$$;
