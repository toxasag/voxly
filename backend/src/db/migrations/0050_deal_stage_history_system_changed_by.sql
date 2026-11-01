-- ---------------------------------------------------------------------------
-- 0050_deal_stage_history_system_changed_by.sql
--
-- Разрешаем NULL в deal_stage_history.changed_by для автоматических
-- системных переходов этапов (автопилот AI, распознавание лидов webchat, авто-правила).
-- ---------------------------------------------------------------------------

ALTER TABLE deal_stage_history ALTER COLUMN changed_by DROP NOT NULL;
