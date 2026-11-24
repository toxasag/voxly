-- Migration 0136: User notifications master toggle and granular preferences
-- Allows users to completely disable notifications (master toggle) while preserving 'enabled by default'

-- 1. Direct column in users table for fast zero-overhead checks
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. Granular user notification settings table with multi-tenant RLS
CREATE TABLE IF NOT EXISTS user_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  inapp_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_notification_settings_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_settings_user
  ON user_notification_settings (tenant_id, user_id);

ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notification_settings_tenant_isolation ON user_notification_settings;
CREATE POLICY user_notification_settings_tenant_isolation ON user_notification_settings
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
