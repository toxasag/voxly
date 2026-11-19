import { z } from "zod";

export const bulkActionSchema = z.object({
  mode: z.enum(["ids", "all"]).default("ids"),
  ids: z.array(z.string().uuid()).optional(),
  excluded_ids: z.array(z.string().uuid()).optional(),
  filters: z.record(z.unknown()).optional(),
});

export type BulkActionPayload = z.infer<typeof bulkActionSchema>;
