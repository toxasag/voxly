-- Web form lead intake (Tilda / WordPress / generic JSON)

CREATE TABLE "FormWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Сайт',
    "token" TEXT NOT NULL,
    "secret" TEXT,
    "dedupeMode" TEXT NOT NULL DEFAULT 'reuse_open',
    "defaultStage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "formId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "comment" TEXT,
    "pageUrl" TEXT,
    "referer" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "personId" TEXT,
    "opportunityId" TEXT,
    "attributionId" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormWebhookEndpoint_token_key" ON "FormWebhookEndpoint"("token");

CREATE INDEX "FormWebhookEndpoint_tenantId_idx" ON "FormWebhookEndpoint"("tenantId");

CREATE INDEX "FormWebhookEndpoint_tenantId_isActive_idx" ON "FormWebhookEndpoint"("tenantId", "isActive");

CREATE UNIQUE INDEX "FormLead_tenantId_source_externalId_key" ON "FormLead"("tenantId", "source", "externalId");

CREATE INDEX "FormLead_tenantId_createdAt_idx" ON "FormLead"("tenantId", "createdAt");

CREATE INDEX "FormLead_endpointId_createdAt_idx" ON "FormLead"("endpointId", "createdAt");

CREATE INDEX "FormLead_status_idx" ON "FormLead"("status");

ALTER TABLE "FormWebhookEndpoint" ADD CONSTRAINT "FormWebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormLead" ADD CONSTRAINT "FormLead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormLead" ADD CONSTRAINT "FormLead_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "FormWebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
