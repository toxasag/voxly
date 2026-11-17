-- =============================================================================
-- 0108_deal_messages_delivery_receipts_and_presence.sql
--
-- Реальные квитанции доставки сообщений (Receipts state machine) и система
-- присутствия пользователей/контактов (Presence & Last Seen).
--
-- 1. deal_messages:
--    - delivered_at: момент подтверждения доставки в клиент/устройство
--    - read_at: момент прочтения получателем
--    - delivery_status расширяется статусами 'delivered' и 'read'
-- 2. contacts:
--    - last_seen_at: время последней активности контакта (в чате, мессенджере)
--    - is_online: флаг активной сессии
-- 3. users:
--    - last_seen_at: время последней активности оператора/менеджера CRM
--    - is_online: флаг активной сессии
-- =============================================================================

-- 1. Расширение таблицы deal_messages
ALTER TABLE deal_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Обновление валидации delivery_status
ALTER TABLE deal_messages DROP CONSTRAINT IF EXISTS deal_messages_delivery_status_valid;
ALTER TABLE deal_messages ADD CONSTRAINT deal_messages_delivery_status_valid
  CHECK (delivery_status IN ('neutral', 'pending', 'sent', 'delivered', 'read', 'failed', 'received'));

-- Индекс для быстрого подсчета непрочитанных сообщений в сделках
CREATE INDEX IF NOT EXISTS idx_deal_messages_read_status
  ON deal_messages (tenant_id, deal_id, delivery_status)
  WHERE direction = 'inbound';

-- 2. Расширение таблицы contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_last_seen
  ON contacts (tenant_id, last_seen_at DESC NULLS LAST);

-- 3. Расширение таблицы users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;
