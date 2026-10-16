-- Пункт 27 плана: вкладки карточек как данные, а не реестр в TypeScript.
--
-- Состав, порядок и условия показа вкладки приходят из БД, компоненты остаются в
-- коде (фабрика «ключ → React-компонент»). module_slug связывает вкладку с
-- модулем: вкладка исчезает, когда модуль не установлен, без правки кода.
--
-- required_permission сохраняет права, которые сейчас стоят на вкладках
-- (напр., `Guard requiredPermission="deals:write"` у чата). Без него вкладка чата
-- откроется тем, кто раньше видел заглушку «Нет доступа к переписке».
--
-- visibility_rule JSONB в схему НЕ добавляется (см. пункт 29 плана): у Twenty
-- правила живут на уровне виджета, а у нас вкладка = один компонент, поле
-- осталось бы пустым. Добавится вместе с виджетами, если они появятся.

CREATE TABLE IF NOT EXISTS page_layout_tabs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  module_slug TEXT NULL,
  required_permission TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, object_type, tab_key),
  CONSTRAINT page_layout_tabs_object_type_valid CHECK (
    object_type IN ('contact', 'company', 'deal')
  ),
  CONSTRAINT page_layout_tabs_tab_key_valid CHECK (
    tab_key ~ '^[a-z][a-z0-9_-]*$' AND length(tab_key) BETWEEN 1 AND 64
  )
);

CREATE INDEX IF NOT EXISTS idx_page_layout_tabs_object_active
  ON page_layout_tabs (tenant_id, object_type, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON page_layout_tabs TO app_user;

DROP TRIGGER IF EXISTS trg_page_layout_tabs_updated_at ON page_layout_tabs;
CREATE TRIGGER trg_page_layout_tabs_updated_at
  BEFORE UPDATE ON page_layout_tabs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE page_layout_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_layout_tabs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON page_layout_tabs;
CREATE POLICY tenant_isolation ON page_layout_tabs
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
