-- Phase 4: form-lead analytics fields, dedupe/phone fingerprints, msclkid, CustomerActivity.

-- 4.2 client analytics + 4.5 phone fingerprint + 4.1 content dedupe fingerprint
ALTER TABLE "FormLead" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "FormLead" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "FormLead" ADD COLUMN "clientTs" TIMESTAMP(3);
ALTER TABLE "FormLead" ADD COLUMN "msclkid" TEXT;
ALTER TABLE "FormLead" ADD COLUMN "phoneFingerprint" TEXT;
ALTER TABLE "FormLead" ADD COLUMN "dedupeFingerprint" TEXT;

-- 4.1 second idempotency backstop when externalId is absent (per-endpoint content fingerprint).
-- Postgres allows multiple NULLs in a unique index, so existing rows are unaffected.
CREATE UNIQUE INDEX "FormLead_endpointId_dedupeFingerprint_key"
    ON "FormLead"("endpointId", "dedupeFingerprint");

-- 4.5 fast lookup by normalized phone
CREATE INDEX "FormLead_tenantId_phoneFingerprint_idx"
    ON "FormLead"("tenantId", "phoneFingerprint");

-- 4.2 msclkid on attribution sessions
ALTER TABLE "AttributionSession" ADD COLUMN "msclkid" TEXT;

-- 4.3 cross-channel interaction history
CREATE TABLE "CustomerActivity" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "twentyPersonId"   TEXT,
    "phoneFingerprint" TEXT,
    "kind"             TEXT NOT NULL,
    "channel"          TEXT,
    "title"            TEXT NOT NULL,
    "description"      TEXT,
    "meta"             JSONB,
    "formLeadId"       TEXT,
    "occurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CustomerActivity_tenantId_twentyPersonId_occurredAt_idx"
    ON "CustomerActivity"("tenantId", "twentyPersonId", "occurredAt");
CREATE INDEX "CustomerActivity_tenantId_phoneFingerprint_occurredAt_idx"
    ON "CustomerActivity"("tenantId", "phoneFingerprint", "occurredAt");
CREATE INDEX "CustomerActivity_tenantId_kind_occurredAt_idx"
    ON "CustomerActivity"("tenantId", "kind", "occurredAt");
CREATE INDEX "CustomerActivity_formLeadId_idx"
    ON "CustomerActivity"("formLeadId");
