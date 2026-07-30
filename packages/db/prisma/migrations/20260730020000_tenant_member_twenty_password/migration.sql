-- Per-member Twenty CRM credentials (SSO + direct john-crm.getvoxly.ru login)
ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "twentyPasswordEncrypted" TEXT;
