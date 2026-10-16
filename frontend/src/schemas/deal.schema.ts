import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional();

/**
 * Deal creation payload, aligned with backend/src/modules/crm/deals/deals.types.ts.
 *
 * pipeline_id and stage_id are required UUIDs (the old mock schema had neither);
 * contact_id and company_id are optional. There is no channel/manager field on
 * the backend deal — manager is derived from the auth token as created_by.
 */
export const createDealSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  budget: z.number({ invalid_type_error: "Budget must be a number" }).min(0, "Budget cannot be negative"),
  currency: z.string().length(3, "Use a 3-letter currency code").default("RUB"),
  pipeline_id: z.string().uuid("Select a pipeline"),
  stage_id: z.string().uuid("Select a stage"),
  contact_id: optionalUuid,
  company_id: optionalUuid,
});

export type CreateDealPayload = z.infer<typeof createDealSchema>;
