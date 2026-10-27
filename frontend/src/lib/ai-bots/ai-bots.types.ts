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
  { token: "tenant.name", label: "Название компании", example: "ООО Ромашка" },
  { token: "consultant.name", label: "Имя консультанта", example: "Алексей" },
  { token: "consultant.role", label: "Должность / роль консультанта", example: "старший мастер-приёмщик" },
  { token: "business.niche", label: "Ниша / профиль компании", example: "сервис технического обслуживания автомобилей" },
  { token: "target.action", label: "Целевое действие", example: "согласование времени для бесплатной диагностики" },
  { token: "handoff.specialist", label: "Специалист для эскалации", example: "руководитель сервисного отдела" },
  { token: "channel_type", label: "Канал связи", example: "онлайн-чат на сайте" },
  { token: "current_time", label: "Текущее время", example: "14:30 МСК" },
  { token: "knowledge_base_context", label: "Контекст базы знаний", example: "Выдержки из актуального прайса" },
  { token: "website_context", label: "Материалы сайта", example: "Информация о гарантиях и услугах с сайта" },
  { token: "reviews_and_reputation", label: "Отзывы клиентов", example: "Рейтинг 4.9 на Яндекс.Картах (более 200 отзывов)" },
  { token: "successful_crm_patterns", label: "Успешный опыт CRM", example: "Примеры выигранных диалогов менеджеров" },
  { token: "user.name", label: "Текущий пользователь", example: "Иван Петров" },
  { token: "contact.name", label: "Имя контакта", example: "Сергей Волков" },
  { token: "contact.phone", label: "Телефон контакта", example: "+7 999 123 45 67" },
  { token: "company.name", label: "Название организации", example: "ООО ТехКорп" },
  { token: "deal.title", label: "Название сделки", example: "Внедрение CRM" },
  { token: "deal.budget", label: "Бюджет сделки", example: "450 000 ₽" },
  { token: "repair.ticket_number", label: "Номер заказ-наряда", example: "ЗН-2026-0042" },
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

/** Substitutes every known variable with its example value or bot-specific value (preview only). */
export function renderPromptPreview(
  body: string,
  bot?: { name?: string; wizard_config?: WizardConfig },
  tenantName?: string,
): string {
  const examples = new Map(PROMPT_VARIABLES.map((v) => [v.token, v.example]));
  const wc = bot?.wizard_config;

  if (tenantName) {
    examples.set("tenant.name", tenantName);
    examples.set("company.name", tenantName);
  }
  if (wc?.consultantName || bot?.name) {
    examples.set("consultant.name", wc?.consultantName || bot?.name || "Консультант");
  }
  if (wc?.consultantRole) {
    examples.set("consultant.role", wc.consultantRole);
  }
  if (wc?.businessNiche) {
    examples.set("business.niche", wc.businessNiche);
  }
  if (wc?.targetAction) {
    examples.set("target.action", wc.targetAction);
  }
  if (wc?.handoffSpecialist) {
    examples.set("handoff.specialist", wc.handoffSpecialist);
  }

  return body.replace(VARIABLE_PATTERN, (whole, token: string) => examples.get(token) ?? whole);
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
