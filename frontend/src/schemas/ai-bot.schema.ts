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
    clientProfile: z.string().optional(),
    targetAction: z.string().optional(),
    constraints: z.string().optional(),
    handoffSpecialist: z.string().optional(),
    isCustomEdited: z.boolean().optional(),
    crawl_status: z.enum(["idle", "pending", "in_progress", "ready", "failed"]).optional(),
    website_url: z.string().optional(),
    crawl_pages_scanned: z.number().optional(),
    crawl_pages_indexed: z.number().optional(),
    crawl_error: z.string().optional(),
    crawl_updated_at: z.string().optional(),
  })
  .passthrough()
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
    .min(20, "Системный промпт должен содержать минимум 20 символов")
    .max(50000, "Системный промпт ограничен 50 000 символов"),
  context_entities: z
    .array(z.enum(botContextEntityValues))
    .min(1, "Select at least one context entity"),
  wizard_config: wizardConfigSchema,
  website_url: z.string().url("Укажите корректный URL (http:// или https://)").optional().or(z.literal("")),
  map_reviews_url: z.string().url("Укажите корректный URL (http:// или https://)").optional().or(z.literal("")),
  sync_crm: z.boolean().optional(),
  whatsapp_chat_text: z.string().optional(),
  company_name_override: z.string().max(120).optional().or(z.literal("")),
  consultant_source: z.enum(["manual", "chat_widget"]).optional(),
  consultant_name: z.string().max(100).optional().or(z.literal("")),
  consultant_role: z.string().max(150).optional().or(z.literal("")),
  fallback_models: z.array(z.string()).optional(),
  target_page_url: z.string().optional().or(z.literal("")),
  generated_system_prompt: z.string().optional().or(z.literal("")),
  knowledge_base_md: z.string().optional(),
  feedback_learning_enabled: z.boolean().optional(),
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
