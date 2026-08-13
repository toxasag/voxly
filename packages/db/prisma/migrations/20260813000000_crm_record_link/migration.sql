-- Create CrmRecordLink table for fast Conversation ↔ CRM record lookup
-- Phase 2.1: Speed up chat panel by avoiding Twenty CRM calls

CREATE TABLE "CrmRecordLink" (
    id              TEXT    NOT NULL,
    "conversationId" TEXT    NOT NULL,
    "tenantId"      TEXT    NOT NULL,
    "twentyPersonId"      TEXT,
    "twentyOpportunityId" TEXT,
    source          TEXT    NOT NULL DEFAULT 'inbound',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmRecordLink_pkey" PRIMARY KEY (id)
);

-- Foreign keys
ALTER TABLE "CrmRecordLink" ADD CONSTRAINT "CrmRecordLink_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmRecordLink" ADD CONSTRAINT "CrmRecordLink_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique indexes
CREATE UNIQUE INDEX "CrmRecordLink_conversationId_twentyPersonId_key"
    ON "CrmRecordLink"("conversationId", "twentyPersonId");

CREATE UNIQUE INDEX "CrmRecordLink_conversationId_twentyOpportunityId_key"
    ON "CrmRecordLink"("conversationId", "twentyOpportunityId");

-- Query indexes
CREATE INDEX "CrmRecordLink_tenantId_twentyPersonId_idx"
    ON "CrmRecordLink"("tenantId", "twentyPersonId");

CREATE INDEX "CrmRecordLink_tenantId_twentyOpportunityId_idx"
    ON "CrmRecordLink"("tenantId", "twentyOpportunityId");

CREATE INDEX "CrmRecordLink_conversationId_idx"
    ON "CrmRecordLink"("conversationId");