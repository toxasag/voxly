-- 0138_sync_intake_repairs_to_in_progress_deals.sql
-- Автоматический перевод сделок в этап «В работе» для всех активных сделок,
-- имеющих принятые в работу наряд-заказы (status != 'rejected') и находящихся на более ранних этапах.

WITH candidate_deals AS (
  SELECT
    d.id AS deal_id,
    d.tenant_id,
    d.stage_id AS current_stage_id,
    COALESCE(d.owner_id, d.created_by) AS changed_by,
    s_target.id AS in_progress_stage_id
  FROM deals d
  JOIN stages s_curr ON s_curr.id = d.stage_id
  JOIN stages s_target ON s_target.pipeline_id = d.pipeline_id
    AND s_target.is_won = false AND s_target.is_lost = false
    AND (
      lower(btrim(s_target.name)) = 'в работе'
      OR lower(btrim(s_target.name)) = 'in progress'
      OR lower(btrim(s_target.name)) = 'in_progress'
      OR lower(btrim(s_target.name)) LIKE '%в работе%'
      OR lower(btrim(s_target.name)) LIKE '%in progress%'
    )
  JOIN repair_orders ro ON ro.deal_id = d.id AND ro.deleted_at IS NULL
  WHERE d.deleted_at IS NULL
    AND d.status = 'active'
    AND s_curr.is_won = false
    AND s_curr.is_lost = false
    AND s_curr.sort_order < s_target.sort_order
    AND ro.status NOT IN ('rejected')
  GROUP BY d.id, d.tenant_id, d.stage_id, d.owner_id, d.created_by, s_target.id
),
updated_deals AS (
  UPDATE deals d
  SET stage_id = cd.in_progress_stage_id,
      updated_at = now()
  FROM candidate_deals cd
  WHERE d.id = cd.deal_id
    AND cd.in_progress_stage_id IS NOT NULL
    AND cd.in_progress_stage_id != cd.current_stage_id
  RETURNING d.id AS deal_id, d.tenant_id, cd.current_stage_id, cd.in_progress_stage_id, cd.changed_by
)
INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by, created_at)
SELECT tenant_id, deal_id, current_stage_id, in_progress_stage_id, changed_by, now()
FROM updated_deals;
