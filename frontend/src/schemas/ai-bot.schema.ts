import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum sources — kept in sync with lib/ai-bots/ai-bots.types.ts
// ---------------------------------------------------------------------------

export const botModelValues = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4",
  "claude-opus-4",
  "deepseek-v3",
  "gemini-1.5-pro",
] as const;

export const botModeValues = ["suggester", "autoreply", "disabled"] as const;

export const botStatusValues = ["active", "paused"] as const;

export const botContextEntityValues = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "repairs",
  "invoices",
] as const;

export const botAccentValues = ["amber", "sky", "emerald", "orange", "rose"] as const;

export const wizardConfigSchema = z
  .object({
    presetId: z.string().optional(),
    consultantName: z.string().optional(),
    consultantRole: z.string().optional(),
    businessNiche: z.string().optional(),
    targetAction: z.string().optional(),
    handoffSpecialist: z.string().optional(),
    isCustomEdited: z.boolean().optional(),
  })
  .optional()
  .nullable();

export type WizardConfig = z.infer<typeof wizardConfigSchema>;

// ---------------------------------------------------------------------------
// Create / update bot
// ---------------------------------------------------------------------------

export const createBotSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().max(300).optional().or(z.literal("")),
  model: z.string().min(1, "Model is required"),
  mode: z.enum(botModeValues, { required_error: "Mode is required" }),
  status: z.enum(botStatusValues),
  accent: z.enum(botAccentValues),
  temperature: z
    .number({ invalid_type_error: "Temperature must be a number" })
    .min(0, "Minimum is 0")
    .max(1, "Maximum is 1"),
  max_tokens: z
    .number({ invalid_type_error: "Max tokens must be a number" })
    .int("Must be a whole number")
    .min(128, "Minimum is 128")
    .max(8192, "Maximum is 8192"),
  system_prompt: z
    .string()
    .min(20, "System prompt must be at least 20 characters")
    .max(8000, "System prompt is limited to 8000 characters"),
  context_entities: z
    .array(z.enum(botContextEntityValues))
    .min(1, "Select at least one context entity"),
  wizard_config: wizardConfigSchema,
  website_url: z.string().url("Укажите корректный URL (http:// или https://)").optional().or(z.literal("")),
  map_reviews_url: z.string().url("Укажите корректный URL (http:// или https://)").optional().or(z.literal("")),
});

export type CreateBotPayload = z.infer<typeof createBotSchema>;

export const updateBotSchema = createBotSchema.partial();

export type UpdateBotPayload = z.infer<typeof updateBotSchema>;

// ---------------------------------------------------------------------------
// Chat message
// ---------------------------------------------------------------------------

export const botChatInputSchema = z.object({
  content: z
    .string()
    .min(1, "Message cannot be empty")
    .max(4000, "Message is limited to 4000 characters"),
});

export type BotChatInputPayload = z.infer<typeof botChatInputSchema>;
