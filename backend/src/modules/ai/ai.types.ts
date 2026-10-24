import { z } from "zod";


// ---------------------------------------------------------------------------
// AI-агенты и баланс ИИ.
// ---------------------------------------------------------------------------

export const agentAccentValues = ["amber", "sky", "emerald", "orange", "rose"] as const;
export const agentStatusValues = ["active", "paused"] as const;
export const agentModeValues = ["suggester", "autoreply", "disabled"] as const;
export const agentContextEntityValues = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "repairs",
  "invoices",
] as const;

export type AgentStatus = (typeof agentStatusValues)[number];
export type AgentMode = (typeof agentModeValues)[number];

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

export const createAgentSchema = z.object({
  name: z.string().trim().min(2, "Название минимум 2 символа").max(80),
  description: z.string().trim().max(300).optional(),
  model: z.string().trim().min(1, "Укажите модель").max(100),
  mode: z.enum(agentModeValues),
  status: z.enum(agentStatusValues),
  accent: z.enum(agentAccentValues),
  temperature: z.number().min(0, "Минимум 0").max(1, "Максимум 1"),
  max_tokens: z.number().int().min(128, "Минимум 128").max(8192, "Максимум 8192"),
  system_prompt: z
    .string()
    .trim()
    .min(20, "Системный промпт минимум 20 символов")
    .max(8000, "Системный промпт до 8000 символов"),
  context_entities: z.array(z.enum(agentContextEntityValues)).default([]),
  wizard_config: wizardConfigSchema,
  website_url: z.string().url().optional().or(z.literal("")),
  map_reviews_url: z.string().url().optional().or(z.literal("")),
  sync_crm: z.boolean().optional(),
  whatsapp_chat_text: z.string().optional(),
});

export type CreateAgentPayload = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = createAgentSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Нечего обновлять: не передано ни одного поля" },
);

export type UpdateAgentPayload = z.infer<typeof updateAgentSchema>;

/**
 * Пополнение баланса ИИ.
 *
 * Сумма принимается в рублях, потому что её вводит человек, и сразу переводится в
 * копейки на сервере. Минимум 100 ₽ отсекает бессмысленные пополнения, максимум
 * 500 000 ₽ — защита от опечатки на порядок.
 */
export const topupBalanceSchema = z.object({
  amount_rubles: z
    .number()
    .int("Сумма указывается в целых рублях")
    .min(100, "Минимальная сумма пополнения — 100 ₽")
    .max(500_000, "Максимальная сумма за одну операцию — 500 000 ₽"),
});

export type TopupBalancePayload = z.infer<typeof topupBalanceSchema>;

export interface AiAgentDTO {
  id: string;
  name: string;
  description: string;
  accent: (typeof agentAccentValues)[number];
  model: string;
  status: AgentStatus;
  mode: AgentMode;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  contextEntities: string[];
  wizardConfig?: WizardConfig | null;
  /** Агрегаты из ai_usage_log: список агентов показывает расход по каждому. */
  tokensUsed: number;
  requestsCount: number;
  avgLatencyMs: number;
  spentKopecks: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiBalanceDTO {
  balanceKopecks: number;
  /** Расход за текущий календарный месяц. */
  spentThisMonthKopecks: number;
  spentTotalKopecks: number;
  requestsThisMonth: number;
  markupPercent: number;
  /** Оценка остатка в токенах по средней модели — для подписи под суммой. */
  estimatedTokensLeft: number;
  lastTopupAt: string | null;
}
