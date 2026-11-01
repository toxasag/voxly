-- Durable idempotency marker for overdue invoice reminders.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_invoices_due_reminders
  ON invoices (due_date)
  WHERE deleted_at IS NULL AND status IN ('sent', 'overdue') AND reminder_sent_at IS NULL;
