-- Migration 0140: Track background chat history sync status & progress per channel account

ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS history_sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (history_sync_status IN ('idle', 'queued', 'syncing', 'completed', 'error')),
  ADD COLUMN IF NOT EXISTS history_sync_total INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_processed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_messages INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS history_sync_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_finished_at TIMESTAMPTZ;
