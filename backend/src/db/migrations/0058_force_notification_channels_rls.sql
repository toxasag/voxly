-- 0058_force_notification_channels_rls.sql
-- The policy was created in 0049, but FORCE was omitted. Without FORCE,
-- the table owner can bypass tenant_isolation. This is an additive, metadata-only
-- hardening change: no rows or indexes are changed.
ALTER TABLE tenant_notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_notification_channels FORCE ROW LEVEL SECURITY;
