-- Add timelineSyncEnabled field to Tenant (default true for per-tenant toggle)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "timelineSyncEnabled" BOOLEAN NOT NULL DEFAULT true;