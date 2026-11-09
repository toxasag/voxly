// ---------------------------------------------------------------------------
// AI Bots module — domain types
// Module slug: ai_bots
// ---------------------------------------------------------------------------

import type { WizardConfig } from "@/schemas/ai-bot.schema";

export type BotStatus = "active" | "paused";

export type BotMode = "suggester" | "autoreply" | "disabled";

export type LlmProvider = "openai" | "anthropic" | "deepseek" | "google";

export type BotModel = string;

/** CRM entities whose data may be injected into the bot context at runtime. */
export type BotContextEntity =
  | "contacts"
  | "companies"
  | "deals"
  | "tasks"
  | "repairs"
  | "invoices";

/** Matches the `source` column on timeline / chat messages (see .cursorrules §13). */
export type ChatMessageSource = "human" | "ai" | "system" | "ai_bot";

export type AiLogStatus = "success" | "error";

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: BotModel;
  label: string;
  provider: LlmProvider;
  /** Context window in tokens. */
  context_window: number;
  /** Price in RUB per 1 000 input tokens. */
  price_in_per_1k: number;
  /** Price in RUB per 1 000 output tokens. */
  price_out_per_1k: number;
  isConfigured?: boolean;
}

export const MODEL_CATALOG: ModelInfo[] = [
  { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite (Fast)", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.05, price_out_per_1k: 0.20 },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.05, price_out_per_1k: 0.20 },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.10, price_out_per_1k: 0.40 },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.05, price_out_per_1k: 0.20 },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.10, price_out_per_1k: 0.40 },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", context_window: 2_000_000, price_in_per_1k: 1.25, price_out_per_1k: 5.00 },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.10, price_out_per_1k: 0.40 },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", context_window: 128_000, price_in_per_1k: 0.45, price_out_per_1k: 1.35 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", context_window: 128_000, price_in_per_1k: 0.03, price_out_per_1k: 0.11 },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic", context_window: 200_000, price_in_per_1k: 0.27, price_out_per_1k: 1.35 },
  { id: "claude-opus-4", label: "Claude Opus 4", provider: "anthropic", context_window: 200_000, price_in_per_1k: 1.35, price_out_per_1k: 6.75 },
  { id: "deepseek-v3", label: "DeepSeek V3", provider: "deepseek", context_window: 64_000, price_in_per_1k: 0.02, price_out_per_1k: 0.09 },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", provider: "google", context_window: 1_000_000, price_in_per_1k: 0.11, price_out_per_1k: 0.45 },
];

const MODEL_INDEX: Record<string, ModelInfo> = MODEL_CATALOG.reduce(
  (acc, model) => {
    acc[model.id] = model;
    return acc;
  },
  {} as Record<string, ModelInfo>,
);

export function getModelInfo(model: string): ModelInfo {
  return (
    MODEL_INDEX[model] ?? {
      id: model,
      label: model,
      provider: model.includes("gemini")
        ? "google"
        : model.includes("claude")
          ? "anthropic"
          : model.includes("deepseek")
            ? "deepseek"
            : "openai",
      context_window: 128_000,
      price_in_per_1k: 0.05,
      price_out_per_1k: 0.15,
    }
  );
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

export interface AiBot {
  id: string;
  name: string;
  description: string;
  /** Tailwind palette key used to tint the bot avatar. */
  accent: "amber" | "sky" | "emerald" | "orange" | "rose";
  model: BotModel;
  status: BotStatus;
  mode: BotMode;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  context_entities: BotContextEntity[];
  company_name_override?: string;
  companyNameOverride?: string;
  consultant_source?: "manual" | "chat_widget";
  consultantSource?: "manual" | "chat_widget";
  consultant_name?: string;
  consultantName?: string;
  consultant_role?: string;
  consultantRole?: string;
  fallback_models?: string[];
  fallbackModels?: string[];
  target_page_url?: string | null;
  generated_system_prompt?: string | null;
  knowledge_base_md?: string;
  feedback_learning_enabled?: boolean;
  wizard_config?: WizardConfig | null;
  website_url?: string;
  crawl_status?: "idle" | "pending" | "in_progress" | "ready" | "failed";
  crawl_pages_scanned?: number;
  crawl_pages_indexed?: number;
  crawl_error?: string;
  tokens_used: number;
  tokens_limit: number;
  requests_count: number;
  avg_latency_ms: number;
  cost_rub: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Prompt templates (stored in DB, never hardcoded — see .cursorrules §13)
// ---------------------------------------------------------------------------

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  /** Variable tokens discovered in `body`, e.g. `contact.name`. */
  variables: string[];
  updated_at: string;
}

/** Variables the backend resolves at runtime before the LLM call. */
export interface PromptVariable {
  token: string;
  label: string;
  example: string;
}

export const PROMPT_VARIABLES: PromptVariable[] = [
  { token: "tenant.name", label: "Название компании", example: "Название вашей компании" },
  { token: "company.name", label: "Название компании / Бренд", example: "Название компании" },
  { token: "consultant.name", label: "Имя консультанта", example: "Имя сотрудника" },
  { token: "consultant.role", label: "Должность / роль консультанта", example: "ведущий специалист" },
  { token: "business.niche", label: "Ниша / профиль компании", example: "профиль вашей компании" },
  { token: "client.profile", label: "Портрет целевого клиента", example: "клиенты, которым требуется консультация" },
  { token: "constraints", label: "Ограничения и стоп-факторы", example: "запреты и рамки безопасности" },
  { token: "target.action", label: "Целевое действие", example: "согласование деталей заказа" },
  { token: "handoff.specialist", label: "Специалист для эскалации", example: "старший специалист" },
  { token: "channel_type", label: "Канал связи", example: "чат на сайте" },
  { token: "current_time", label: "Текущее время", example: "текущее время диалога" },
  { token: "knowledge_base_context", label: "Контекст базы знаний", example: "актуальные документы и прайсы" },
  { token: "website_context", label: "Материалы сайта", example: "информация со страниц сайта" },
  { token: "reviews_and_reputation", label: "Отзывы клиентов", example: "отзывы с Яндекс Карт и 2ГИС" },
  { token: "successful_crm_patterns", label: "Успешный опыт CRM", example: "примеры закрытых сделок" },
  { token: "user.name", label: "Текущий пользователь", example: "Имя менеджера" },
  { token: "contact.name", label: "Имя контакта", example: "Имя клиента" },
  { token: "contact.phone", label: "Телефон контакта", example: "+7 999 000 00 00" },
  { token: "deal.title", label: "Название сделки", example: "Тема сделки" },
  { token: "deal.budget", label: "Бюджет сделки", example: "Сумма сделки" },
  { token: "repair.ticket_number", label: "Номер заказ-наряда", example: "Номер заказа" },
];

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

/** Extracts unique `{{entity.field}}` tokens from a prompt body. */
export function extractPromptVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    const token = match[1];
    if (token) found.add(token);
  }
  return [...found];
}

/** Tokens present in the body that are not part of the supported catalog. */
export function findUnknownVariables(body: string): string[] {
  const supported = new Set(PROMPT_VARIABLES.map((v) => v.token));
  return extractPromptVariables(body).filter((token) => !supported.has(token));
}

export interface PromptPreviewRealContext {
  tenantName?: string;
  knowledgeBaseContext?: string;
  websiteContext?: string;
  reviewsContext?: string;
  crmPatternsContext?: string;
  channelType?: string;
  currentTime?: string;
  [key: string]: string | undefined;
}

/**
 * Подставляет реальные данные в шаблон промпта и очищает XML-обёртки
 * (<character_and_identity>, <director_system_prompt> и др.) для корректного отображения.
 */
export function renderPromptPreview(
  body: string,
  bot?: {
    name?: string;
    description?: string;
    companyNameOverride?: string;
    company_name_override?: string;
    consultantName?: string;
    consultant_name?: string;
    consultantRole?: string;
    consultant_role?: string;
    wizard_config?: WizardConfig;
  },
  contextOrTenantName?: string | PromptPreviewRealContext,
): string {
  const context: PromptPreviewRealContext =
    typeof contextOrTenantName === "string"
      ? { tenantName: contextOrTenantName }
      : (contextOrTenantName ?? {});

  const wc = (bot?.wizard_config ?? {}) as Record<string, unknown>;
  const tenant = context.tenantName || "Компания";

  const getString = (val: unknown): string | null =>
    typeof val === "string" && val.trim().length > 0 ? val.trim() : null;

  const companyOverride =
    (bot?.companyNameOverride && bot.companyNameOverride.trim().length > 0 ? bot.companyNameOverride.trim() : null) ||
    (bot?.company_name_override && bot.company_name_override.trim().length > 0 ? bot.company_name_override.trim() : null) ||
    getString(wc.company_name_override) ||
    getString(wc.companyName);

  const effectiveCompany = companyOverride || tenant;

  const consultantName =
    (bot?.consultantName && bot.consultantName.trim().length > 0 ? bot.consultantName.trim() : null) ||
    (bot?.consultant_name && bot.consultant_name.trim().length > 0 ? bot.consultant_name.trim() : null) ||
    getString(wc.consultantName) ||
    bot?.name ||
    "Консультант";

  const consultantRole =
    (bot?.consultantRole && bot.consultantRole.trim().length > 0 ? bot.consultantRole.trim() : null) ||
    (bot?.consultant_role && bot.consultant_role.trim().length > 0 ? bot.consultant_role.trim() : null) ||
    getString(wc.consultantRole) ||
    "ведущий специалист";

  const businessNiche =
    getString(wc.businessNiche) ||
    (bot?.description && bot.description.trim().length > 5 ? bot.description.trim() : null) ||
    "оказание профильных услуг и консультация клиентов";

  const clientProfile =
    getString(wc.clientProfile) ||
    getString(wc.client_profile) ||
    "клиенты, которым требуется экспертная консультация и решение их задачи";

  const constraints =
    getString(wc.constraints) ||
    "Не выдумывать условия, которых нет в базе знаний. При любых сложных юридических или финансовых вопросах мягко переводить на старшего специалиста.";
    "Не выдумывать условия, которых нет в базе знаний. При любых сложных юридических или финансовых вопросах мягко переводить на старшего специалиста.";

  const resolvedValues = new Map<string, string>();
  resolvedValues.set("tenant.name", effectiveCompany);
  resolvedValues.set("company.name", effectiveCompany);
  resolvedValues.set("consultant.name", consultantName);
  resolvedValues.set("consultant.role", consultantRole);
  resolvedValues.set("business.niche", businessNiche);
  resolvedValues.set("client.profile", clientProfile);
  resolvedValues.set("constraints", constraints);
  resolvedValues.set("target.action", getString(wc.targetAction) || "согласование деталей заказа и обмен контактами");
  resolvedValues.set("handoff.specialist", getString(wc.handoffSpecialist) || "старший специалист");
  resolvedValues.set(
    "current_time",
    context.currentTime ||
      new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " МСК",
  );
  resolvedValues.set("channel_type", context.channelType || "чат на сайте");
  resolvedValues.set(
    "knowledge_base_context",
    context.knowledgeBaseContext ||
      "Динамические выдержки из базы знаний и прайса подставляются в блок <retrieved_facts> при каждом запросе клиента на основе векторного поиска.",
  );
  resolvedValues.set(
    "website_context",
    context.websiteContext || "Материалы сайта подгружаются динамически через RAG (<retrieved_facts>).",
  );
  resolvedValues.set(
    "reviews_and_reputation",
    context.reviewsContext || "Отзывы клиентов подгружаются динамически через RAG (<retrieved_facts>).",
  );
  resolvedValues.set(
    "successful_crm_patterns",
    context.crmPatternsContext ||
      "Паттерны успешных диалогов из закрытых сделок передаются в блоке <retrieved_facts>.",
  );

  // Fallback for CRM entity tokens
  resolvedValues.set("user.name", "Имя сотрудника");
  resolvedValues.set("contact.name", "Имя клиента");
  resolvedValues.set("contact.phone", "+7 999 000 00 00");
  resolvedValues.set("deal.title", "Сделка клиента");
  resolvedValues.set("deal.budget", "от 100 000 ₽");
  resolvedValues.set("repair.ticket_number", "ЗН-0001");

  // Interpolate tokens
  let result = body.replace(VARIABLE_PATTERN, (whole, token: string) => resolvedValues.get(token) ?? whole);

  // Strip XML container tags so <character_and_identity> never leaks to human preview
  result = result
    .replace(
      /<\/?(?:director_system_prompt|character_and_identity|context_and_knowledge|style_and_formatting|dialogue_management|golden_cage_rules_and_security|primary_objective|scene_rehearsals)>/gi,
      "",
    )
    .replace(/^\s*<[/]?[a-zA-Z0-9_]+>\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return result;
}

/**
 * Rough client-side token estimate (~4 characters per token for mixed
 * Latin/Cyrillic text). The authoritative count comes from the provider
 * response and is persisted in `ai_logs`.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface BotChatMessage {
  id: string;
  bot_id: string;
  source: ChatMessageSource;
  content: string;
  created_at: string;
  tokens: number | null;
  latency_ms: number | null;
  /** True while chunks are still arriving over the stream. */
  streaming: boolean;
  /** Set when the stream failed; enables the Regenerate action. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Usage & logs
// ---------------------------------------------------------------------------

export interface AiLogEntry {
  id: string;
  bot_id: string;
  bot_name: string;
  model: BotModel;
  user_name: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_rub: number;
  status: AiLogStatus;
  created_at: string;
}

export interface DailyUsage {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  requests: number;
  tokens: number;
  avg_latency_ms: number;
}

/** Estimated cost in RUB for a given token split on a given model. */
export function estimateCost(model: BotModel, tokensIn: number, tokensOut: number): number {
  const info = getModelInfo(model);
  const cost = (tokensIn / 1000) * info.price_in_per_1k + (tokensOut / 1000) * info.price_out_per_1k;
  return Math.round(cost * 100) / 100;
}

// ---------------------------------------------------------------------------
// Labels & palette
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<BotStatus, string> = {
  active: "Активен",
  paused: "На паузе",
};

const MODE_LABELS: Record<BotMode, string> = {
  suggester: "Подсказки",
  autoreply: "Автоответы",
  disabled: "Отключён",
};

const MODE_DESCRIPTIONS: Record<BotMode, string> = {
  suggester: "ИИ готовит черновик ответа, менеджер проверяет и отправляет",
  autoreply: "ИИ отвечает клиенту сам в чате сделки",
  disabled: "Бот настроен, но не срабатывает",
};

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
};

const ACCENT_CLASSES: Record<AiBot["accent"], string> = {
  amber: "bg-[#4a38f5]/10 text-[#4a38f5]",
  sky: "bg-sky-500/10 text-sky-400",
  emerald: "bg-emerald-500/10 text-emerald-400",
  orange: "bg-orange-400/10 text-orange-400",
  rose: "bg-rose-500/10 text-rose-400",
};

export function getBotStatusLabel(status: BotStatus): string {
  return STATUS_LABELS[status];
}

export function getBotModeLabel(mode: BotMode): string {
  return MODE_LABELS[mode];
}

export function getBotModeDescription(mode: BotMode): string {
  return MODE_DESCRIPTIONS[mode];
}

export function getProviderLabel(provider: LlmProvider | string): string {
  if (provider in PROVIDER_LABELS) {
    return PROVIDER_LABELS[provider as LlmProvider];
  }
  return provider;
}

export function getAccentClasses(accent: AiBot["accent"]): string {
  return ACCENT_CLASSES[accent];
}

const CONTEXT_ENTITY_LABELS: Record<BotContextEntity, string> = {
  contacts: "Контакты",
  companies: "Компании",
  deals: "Сделки",
  tasks: "Задачи",
  repairs: "Ремонты",
  invoices: "Счета",
};

export function getContextEntityLabel(entity: BotContextEntity): string {
  return CONTEXT_ENTITY_LABELS[entity];
}

export const CONTEXT_ENTITIES: BotContextEntity[] = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "repairs",
  "invoices",
];

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

export interface AgentDialogueFeedbackDTO {
  id: string;
  agentId: string;
  dealId?: string | null;
  conversationId?: string | null;
  rating: number;
  userComment: string;
  clarificationQa: Array<{ question: string; answer?: string | null }>;
  compiledRule?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}
