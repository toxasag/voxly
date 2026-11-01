-- Migration 0066: Push subscriptions and in-app notifications
-- Enables Web Push (VAPID) background delivery and persistent notification center with RLS

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_user
  ON push_subscriptions (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions (endpoint);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_tenant_isolation ON push_subscriptions;
CREATE POLICY push_subscriptions_tenant_isolation ON push_subscriptions
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- In-app notification center table
CREATE TABLE IF NOT EXISTS inapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(32) NOT NULL DEFAULT 'system',
  entity_type VARCHAR(32) NOT NULL DEFAULT 'system',
  entity_id VARCHAR(128) NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inapp_notifications_tenant_user_read
  ON inapp_notifications (tenant_id, user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inapp_notifications_tenant_created
  ON inapp_notifications (tenant_id, created_at DESC);

ALTER TABLE inapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE inapp_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_notifications_tenant_isolation ON inapp_notifications;
CREATE POLICY inapp_notifications_tenant_isolation ON inapp_notifications
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
