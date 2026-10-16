-- =============================================================================
-- M7.5.18 — CRM operational core: message persistence & deduplication fields
-- =============================================================================

-- Contacts deduplication by Telegram numeric user id.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_contacts_telegram_chat_id
  ON contacts (tenant_id, telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- Link deal messages to the originating channel account.
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS channel_account_id UUID;

CREATE INDEX IF NOT EXISTS idx_deal_messages_channel_account_id
  ON deal_messages (channel_account_id);
