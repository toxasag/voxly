import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)").optional().or(z.literal(""));

/**
 * Deal creation payload, aligned with backend/src/modules/crm/deals/deals.types.ts.
 *
 * pipeline_id and stage_id are required UUIDs (the old mock schema had neither);
 * contact_id and company_id are optional.
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
  owner_id: optionalUuid,
  close_date: optionalDate,
});

export type CreateDealPayload = z.infer<typeof createDealSchema>;
