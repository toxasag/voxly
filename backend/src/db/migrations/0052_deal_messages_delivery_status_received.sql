-- Migration 0052: Allow 'received' in deal_messages.delivery_status
ALTER TABLE deal_messages DROP CONSTRAINT IF EXISTS deal_messages_delivery_status_valid;
ALTER TABLE deal_messages ADD CONSTRAINT deal_messages_delivery_status_valid
  CHECK (delivery_status IN ('neutral', 'pending', 'sent', 'failed', 'received'));
