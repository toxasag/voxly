-- Migration 0081: Caller ID high-speed phone index and user_push_subscriptions compatibility view
-- Fast index for caller-id lookup (< 5ms response) and standard naming alias for push subscriptions

CREATE INDEX IF NOT EXISTS idx_contacts_phone_digits
  ON contacts (tenant_id, regexp_replace(phone, '\D', '', 'g'))
  WHERE deleted_at IS NULL;

-- View user_push_subscriptions alias with p256dh_key / auth_key naming
CREATE OR REPLACE VIEW user_push_subscriptions AS
  SELECT
    id,
    tenant_id,
    user_id,
    endpoint,
    p256dh AS p256dh_key,
    auth AS auth_key,
    user_agent,
    created_at,
    updated_at
  FROM push_subscriptions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_push_subscriptions TO app_user;
  END IF;
END $$;
