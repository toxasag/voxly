-- Системный нулевой этап «Первый контакт» для входящих обращений без контактов (онлайн-виджет).
-- Сделка переходит в «Новый лид» только после получения контактных данных клиента (телефон, email, мессенджер).

DO $$
DECLARE
  p RECORD;
  fc_stage_id UUID;
  new_lead_stage_id UUID;
BEGIN
  FOR p IN SELECT id FROM pipelines LOOP
    -- Проверяем, есть ли уже этап 'Первый контакт'
    IF NOT EXISTS (SELECT 1 FROM stages WHERE pipeline_id = p.id AND name = 'Первый контакт') THEN
      -- Сдвигаем существующие этапы на +1
      UPDATE stages SET sort_order = sort_order + 1 WHERE pipeline_id = p.id;

      -- Вставляем системный нулевой этап 'Первый контакт'
      INSERT INTO stages (pipeline_id, name, sort_order, is_won, is_lost, is_system, color)
      VALUES (p.id, 'Первый контакт', 0, false, false, true, 'slate')
      RETURNING id INTO fc_stage_id;

      -- Находим этап 'Новый лид' в этой воронке
      SELECT id INTO new_lead_stage_id FROM stages WHERE pipeline_id = p.id AND name = 'Новый лид' LIMIT 1;

      -- Если найдены оба этапа, переносим существующие анонимные сделки веб-чата без контактов в 'Первый контакт'
      IF fc_stage_id IS NOT NULL AND new_lead_stage_id IS NOT NULL THEN
        UPDATE deals d
        SET stage_id = fc_stage_id,
            updated_at = now()
        FROM contacts c
        WHERE d.contact_id = c.id
          AND d.pipeline_id = p.id
          AND d.stage_id = new_lead_stage_id
          AND (c.phone IS NULL OR c.phone = '')
          AND (c.telegram_chat_id IS NULL)
          AND (c.channel = 'webchat' OR d.title ILIKE '%webchat%' OR d.title ILIKE '%Онлайн-чат%');
      END IF;
    END IF;
  END LOOP;
END $$;
