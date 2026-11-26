-- 0142_reconcile_read_inapp_notifications.sql
-- Идемпотентная реконсиляция устаревших inapp_notifications:
-- 1) Уведомления о сообщениях по сделкам, где все входящие сообщения уже прочитаны
--    или менеджер уже отправил ответ после создания уведомления.
-- 2) Уведомления по удалённым сделкам/задачам/нарядам и по завершённым/отменённым задачам.
-- 3) Уведомления о новых заявках (lead), по которым менеджер уже ответил клиенту.

-- 1. Сообщения, которые уже прочитаны в чате или на которые уже дан ответ
UPDATE inapp_notifications n
SET is_read = true,
    read_at = COALESCE(n.read_at, now())
WHERE n.is_read = false
  AND n.category = 'message'
  AND n.entity_type IN ('deal', 'chat')
  AND (
    NOT EXISTS (
      SELECT 1
      FROM deal_messages dm
      WHERE dm.tenant_id = n.tenant_id
        AND dm.deal_id::text = n.entity_id
        AND dm.direction = 'inbound'
        AND dm.delivery_status != 'read'
    )
    OR EXISTS (
      SELECT 1
      FROM deal_messages dm
      WHERE dm.tenant_id = n.tenant_id
        AND dm.deal_id::text = n.entity_id
        AND dm.direction = 'outbound'
        AND dm.created_at >= n.created_at
    )
  );

-- 2. Новые заявки (lead), по которым сделка уже удалена или менеджер уже ответил клиенту
UPDATE inapp_notifications n
SET is_read = true,
    read_at = COALESCE(n.read_at, now())
WHERE n.is_read = false
  AND n.category = 'lead'
  AND n.entity_type IN ('deal', 'lead')
  AND (
    NOT EXISTS (
      SELECT 1
      FROM deals d
      WHERE d.tenant_id = n.tenant_id
        AND d.id::text = n.entity_id
        AND d.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM deal_messages dm
      WHERE dm.tenant_id = n.tenant_id
        AND dm.deal_id::text = n.entity_id
        AND dm.direction = 'outbound'
    )
  );

-- 3. Уведомления по удалённым или уже закрытым задачам
UPDATE inapp_notifications n
SET is_read = true,
    read_at = COALESCE(n.read_at, now())
WHERE n.is_read = false
  AND n.entity_type = 'task'
  AND (
    NOT EXISTS (
      SELECT 1
      FROM crm_tasks t
      WHERE t.tenant_id = n.tenant_id
        AND t.id::text = n.entity_id
        AND t.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM crm_tasks t
      WHERE t.tenant_id = n.tenant_id
        AND t.id::text = n.entity_id
        AND t.status IN ('done', 'canceled')
    )
  );
