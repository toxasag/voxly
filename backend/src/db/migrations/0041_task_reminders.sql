-- =============================================================================
-- 0041: Напоминания по задачам в Telegram перед наступлением срока
-- =============================================================================

ALTER TABLE crm_tasks
  ADD COLUMN IF NOT EXISTS notify_telegram BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS remind_before_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_reminders
  ON crm_tasks (notify_telegram, status, reminder_sent_at, due_date)
  WHERE notify_telegram = TRUE AND status <> 'done' AND reminder_sent_at IS NULL AND deleted_at IS NULL;
