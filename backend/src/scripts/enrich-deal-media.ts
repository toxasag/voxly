import { query, runWithPlatformScope, runWithTenantContext } from "../db/client.js";
import { mediaEnrichmentService } from "../modules/crm/media/media-enrichment.service.js";

async function main() {
  const dealId = "bfb028d5-ef14-46a4-9c3e-388ff2cde74a";
  const tenantId = "c0000000-0000-0000-0000-000000000001";

  console.log(`Starting media enrichment for deal ${dealId}...`);

  const messages = await runWithPlatformScope(() =>
    query<{
      id: string;
      tenant_id: string;
      content: string;
      attachment: string | null;
      attachment_type: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, tenant_id, content, attachment, attachment_type, metadata
       FROM deal_messages
       WHERE deal_id = $1 AND attachment IS NOT NULL
       ORDER BY created_at ASC`,
      [dealId],
    ),
  );

  console.log(`Found ${messages.length} media messages to enrich for deal ${dealId}`);

  for (const m of messages) {
    console.log(`Enriching message ${m.id} (${m.attachment_type || "file"})...`);
    const enriched = await runWithTenantContext(tenantId, () =>
      mediaEnrichmentService.enrichMessageMedia(tenantId, m.id),
    );
    console.log(`Result for ${m.id}:`, JSON.stringify(enriched?.metadata));
  }

  console.log("Enrichment finished successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Enrichment error:", err);
  process.exit(1);
});
