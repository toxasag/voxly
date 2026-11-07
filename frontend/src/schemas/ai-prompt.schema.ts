import { z } from "zod";

// ---------------------------------------------------------------------------
// Prompt templates are persisted in the database (see .cursorrules §13) and
// edited through PromptTemplateEditor. Variables use the {{entity.field}}
// syntax and are resolved server-side before the LLM call.
// ---------------------------------------------------------------------------

const VARIABLE_TOKEN = /^[a-z_]+(\.[a-z_]+)*$/;

export const promptTemplateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().max(300).optional().or(z.literal("")),
  body: z
    .string()
    .min(10, "Template body must be at least 10 characters")
    .max(50000, "Template body is limited to 50000 characters"),
});

export type PromptTemplatePayload = z.infer<typeof promptTemplateSchema>;

export const promptVariableSchema = z.object({
  token: z
    .string()
    .min(3, "Token is too short")
    .regex(VARIABLE_TOKEN, "Use lowercase dot notation, e.g. contact.name"),
  label: z.string().min(2, "Label is required").max(60),
  example: z.string().max(120),
});

export type PromptVariablePayload = z.infer<typeof promptVariableSchema>;
