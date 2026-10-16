-- Пункт 28 плана: стандартные вкладки с шагом позиций 10, как у Twenty.
--
-- Воспроизводится текущий состав один в один:
-- - контакт и компания: Главная 10, Задачи 30, Заметки 40;
-- - сделка: Главная 10, Чат 15, Задачи 30, Заметки 40, Файлы 50.
--
-- Позиция 15 у чата не случайна — та же, что у вкладки чата в CRM-PLUS: между
-- «Главной» и остальными, и модуль вставит свою вкладку, не переписывая чужие.
--
-- Файлы: пустая заглушка (`FilesTab` рендерит только `EmptyState`). В сид
-- включается, но с `is_active = false`: сейчас она занимает место в ряду вкладок
-- и на телефоне вытесняет рабочие. Включится, когда за ней появится
-- функциональность.
--
-- required_permission сохраняет права, которые сейчас стоят на вкладках в коде:
-- у чата `Guard requiredPermission="deals:write"`. Без этого вкладка чата
-- откроется тем, кто раньше видел заглушку «Нет доступа к переписке».

DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    -- Контакт: Главная, Задачи, Заметки
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'contact', 'home',  'Главная', 'Home',        10, true, NULL, NULL),
      (tenant_rec.id, 'contact', 'tasks', 'Задачи',  'ListChecks', 30, true, NULL, NULL),
      (tenant_rec.id, 'contact', 'notes', 'Заметки', 'StickyNote', 40, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;

    -- Компания: Главная, Задачи, Заметки
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'company', 'home',  'Главная', 'Home',        10, true, NULL, NULL),
      (tenant_rec.id, 'company', 'tasks', 'Задачи',  'ListChecks', 30, true, NULL, NULL),
      (tenant_rec.id, 'company', 'notes', 'Заметки', 'StickyNote', 40, true, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;

    -- Сделка: Главная, Чат (deals:write), Задачи, Заметки, Файлы (неактивна)
    INSERT INTO page_layout_tabs (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
    VALUES
      (tenant_rec.id, 'deal', 'home',  'Главная', 'Home',        10, true,  NULL, NULL),
      (tenant_rec.id, 'deal', 'chat',  'Чат',     'MessageCircle', 15, true,  NULL, 'deals:write'),
      (tenant_rec.id, 'deal', 'tasks', 'Задачи',  'ListChecks',   30, true,  NULL, NULL),
      (tenant_rec.id, 'deal', 'notes', 'Заметки', 'StickyNote',   40, true,  NULL, NULL),
      (tenant_rec.id, 'deal', 'files', 'Файлы',   'Paperclip',    50, false, NULL, NULL)
    ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING;
  END LOOP;
END;
$$;
