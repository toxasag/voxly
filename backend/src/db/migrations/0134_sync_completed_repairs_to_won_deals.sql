-- 0134_sync_completed_repairs_to_won_deals.sql
-- Перевод существующих сделок в статус «Успешно реализовано», если все привязанные наряды выданы (status = 'issued') и оплачены (payment_status = 'paid').

WITH completed_deals AS (
  SELECT
    d.id AS deal_id,
    d.tenant_id,
    d.stage_id AS current_stage_id,
    d.created_by,
    (
      SELECT s_won.id
      FROM stages s_won
      WHERE s_won.pipeline_id = d.pipeline_id
        AND s_won.is_won = true
      ORDER BY s_won.sort_order ASC
      LIMIT 1
    ) AS won_stage_id
  FROM deals d
  JOIN stages s ON s.id = d.stage_id
  JOIN repair_orders ro ON ro.deal_id = d.id AND ro.deleted_at IS NULL
  WHERE d.deleted_at IS NULL
    AND s.is_won = false
  GROUP BY d.id, d.tenant_id, d.stage_id, d.created_by, d.pipeline_id
  HAVING COUNT(ro.id) > 0
     AND COUNT(ro.id) = COUNT(ro.id) FILTER (WHERE ro.status = 'issued' AND ro.payment_status = 'paid')
),
updated_deals AS (
  UPDATE deals d
  SET stage_id = cd.won_stage_id,
      closed_at = COALESCE(d.closed_at, now()),
      updated_at = now()
  FROM completed_deals cd
  WHERE d.id = cd.deal_id
    AND cd.won_stage_id IS NOT NULL
    AND cd.won_stage_id != cd.current_stage_id
  RETURNING d.id AS deal_id, d.tenant_id, cd.current_stage_id, cd.won_stage_id, cd.created_by
)
INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by, created_at)
SELECT tenant_id, deal_id, current_stage_id, won_stage_id, created_by, now()
FROM updated_deals;
