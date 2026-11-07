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

export const consultantSourceValues = ["manual", "chat_widget"] as const;
export type ConsultantSource = (typeof consultantSourceValues)[number];

export const wizardConfigSchema = z
  .object({
    presetId: z.string().optional(),
    companyName: z.string().optional(),
    company_name_override: z.string().optional(),
    companyNameOverride: z.string().optional(),
    consultantSource: z.enum(consultantSourceValues).optional().default("manual"),
    consultant_source: z.enum(consultantSourceValues).optional().default("manual"),
    consultantName: z.string().optional(),
    consultantRole: z.string().optional(),
    businessNiche: z.string().optional(),
    clientProfile: z.string().optional(),
    client_profile: z.string().optional(),
    targetAction: z.string().optional(),
    constraints: z.string().optional(),
    handoffSpecialist: z.string().optional(),
    fallbackModels: z.array(z.string()).optional(),
    fallback_models: z.array(z.string()).optional(),
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

export const createAgentSchema = z.object({
  name: z.string().trim().min(2, "Название минимум 2 символа").max(80),
  description: z.string().trim().max(300).optional().default(""),
  model: z.string().trim().min(1, "Укажите модель").max(100).default("gpt-4o-mini"),
  mode: z.enum(agentModeValues).default("suggester"),
  status: z.enum(agentStatusValues).default("active"),
  accent: z.enum(agentAccentValues).default("sky"),
  temperature: z.number().min(0, "Минимум 0").max(1, "Максимум 1").default(0.7),
  max_tokens: z.number().int().min(128, "Минимум 128").max(8192, "Максимум 8192").default(2048),
  system_prompt: z
    .string()
    .trim()
    .min(20, "Системный промпт минимум 20 символов")
    .max(50000, "Системный промпт до 50000 символов")
    .default("Ты — вежливый AI-ассистент компании. Отвечай кратко, дружелюбно и по существу."),
  context_entities: z.array(z.enum(agentContextEntityValues)).default([]),
  company_name_override: z.string().trim().optional().nullable(),
  companyNameOverride: z.string().trim().optional().nullable(),
  consultant_source: z.enum(consultantSourceValues).default("manual"),
  consultantSource: z.enum(consultantSourceValues).optional(),
  consultant_name: z.string().trim().optional().nullable(),
  consultantName: z.string().trim().optional().nullable(),
  consultant_role: z.string().trim().optional().nullable(),
  consultantRole: z.string().trim().optional().nullable(),
  fallback_models: z.array(z.string()).default([]),
  fallbackModels: z.array(z.string()).optional(),
  target_page_url: z.string().optional().nullable(),
  targetPageUrl: z.string().optional().nullable(),
  generated_system_prompt: z.string().optional().nullable(),
  generatedSystemPrompt: z.string().optional().nullable(),
  knowledge_base_md: z.string().optional().default(""),
  knowledgeBaseMd: z.string().optional(),
  feedback_learning_enabled: z.boolean().optional().default(true),
  feedbackLearningEnabled: z.boolean().optional(),
  wizard_config: wizardConfigSchema,
  website_url: z.string().optional().or(z.literal("")),
  websiteUrl: z.string().optional().or(z.literal("")),
  map_reviews_url: z.string().optional().or(z.literal("")),
  mapReviewsUrl: z.string().optional().or(z.literal("")),
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
  companyNameOverride?: string | null;
  consultantSource?: ConsultantSource;
  consultantName?: string | null;
  consultantRole?: string | null;
  fallbackModels?: string[];
  targetPageUrl?: string | null;
  generatedSystemPrompt?: string | null;
  knowledgeBaseMd: string;
  feedbackLearningEnabled: boolean;
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

// ---------------------------------------------------------------------------
// Генеративный синтез системного промпта из контекста и URL страницы
// ---------------------------------------------------------------------------

export const generatePromptSchema = z.object({
  target_page_url: z.string().trim().optional().nullable(),
  targetPageUrl: z.string().trim().optional().nullable(),
  business_niche: z.string().trim().optional().nullable(),
  businessNiche: z.string().trim().optional().nullable(),
  company_name: z.string().trim().optional().nullable(),
  companyName: z.string().trim().optional().nullable(),
  client_profile: z.string().trim().optional().nullable(),
  clientProfile: z.string().trim().optional().nullable(),
  target_action: z.string().trim().optional().nullable(),
  targetAction: z.string().trim().optional().nullable(),
  constraints: z.string().trim().optional().nullable(),
  handoff_specialist: z.string().trim().optional().nullable(),
  handoffSpecialist: z.string().trim().optional().nullable(),
  consultant_name: z.string().trim().optional().nullable(),
  consultantName: z.string().trim().optional().nullable(),
  consultant_role: z.string().trim().optional().nullable(),
  consultantRole: z.string().trim().optional().nullable(),
});

export type GeneratePromptPayload = z.infer<typeof generatePromptSchema>;

export interface GeneratedPromptResult {
  systemPrompt: string;
  businessNiche: string;
  clientProfile: string;
  targetAction: string;
  constraints: string;
  consultantName: string;
  consultantRole: string;
  handoffSpecialist: string;
  knowledgeBaseDraftMd: string;
}

// ---------------------------------------------------------------------------
// Синхронизация Markdown базы знаний агента
// ---------------------------------------------------------------------------

export const syncKnowledgeMdSchema = z.object({
  knowledge_base_md: z.string().optional(),
  knowledgeBaseMd: z.string().optional(),
});

export type SyncKnowledgeMdPayload = z.infer<typeof syncKnowledgeMdSchema>;

// ---------------------------------------------------------------------------
// Петля обучения через обратную связь диалогов (Dialogue Feedback Loop)
// ---------------------------------------------------------------------------

export const createDialogueFeedbackSchema = z.object({
  agent_id: z.string().uuid().optional().nullable(),
  agentId: z.string().uuid().optional().nullable(),
  deal_id: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  rating: z.number().int().min(1).max(5),
  user_comment: z.string().trim().min(1, "Комментарий обязателен"),
  userComment: z.string().trim().optional(),
  clarification_answer: z.string().trim().optional().nullable(),
  clarificationAnswer: z.string().trim().optional().nullable(),
});

export type CreateDialogueFeedbackPayload = z.infer<typeof createDialogueFeedbackSchema>;

export interface AgentDialogueFeedbackDTO {
  id: string;
  agentId: string;
  dealId?: string | null;
  dealTitle?: string | null;
  contactName?: string | null;
  conversationId?: string | null;
  lastMessagePreview?: string | null;
  rating: number;
  userComment: string;
  clarificationQa: Array<{ question: string; answer?: string | null }>;
  compiledRule?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface RebuildAgentPromptResult {
  agentId: string;
  systemPrompt: string;
  knowledgeBaseMd: string;
  summaryOfChanges: string;
  feedbacksCount: number;
}

