import { z } from "zod";
import { AppError } from "../../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Классы задач моделей (Tiers)
// ---------------------------------------------------------------------------

export const modelTierValues = ["FAST_CHEAP", "REASONING_HEAVY", "FALLBACK_SAFE"] as const;
export type ModelTier = (typeof modelTierValues)[number];

export const ModelTierSchema = z.enum(modelTierValues);

// ---------------------------------------------------------------------------
// Лимиты пропускной способности (RPM, TPM, RPD)
// ---------------------------------------------------------------------------

export const ModelLimitsSchema = z.object({
  rpm: z.number().int().positive("RPM должен быть больше 0"),
  tpm: z.number().int().positive("TPM должен быть больше 0"),
  rpd: z.number().int().nonnegative("RPD не может быть отрицательным").optional(),
  maxContext: z.number().int().positive("Контекстное окно должно быть положительным"),
});

export type ModelLimits = z.infer<typeof ModelLimitsSchema>;

// ---------------------------------------------------------------------------
// Профиль модели в шлюзе
// ---------------------------------------------------------------------------

export const ModelProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  tier: ModelTierSchema,
  limits: ModelLimitsSchema,
  fallbackModelId: z.string().optional(),
  priority: z.number().int().default(100),
  costInPer1k: z.number().nonnegative().default(0),
  costOutPer1k: z.number().nonnegative().default(0),
});

export type ModelProfile = z.infer<typeof ModelProfileSchema>;

// ---------------------------------------------------------------------------
// Схема слота API-ключа
// ---------------------------------------------------------------------------

export const KeyStatusSchema = z.enum(["active", "cooldown", "disabled", "invalid"]);
export type KeyStatus = z.infer<typeof KeyStatusSchema>;

export const ProviderKeySlotSchema = z.object({
  id: z.string(),
  provider: z.string(),
  key: z.string(),
  maskedKey: z.string(),
  status: KeyStatusSchema,
  tenantId: z.string().uuid().optional(),
  cooldownUntil: z.number().default(0),
  cooldownReason: z.string().optional(),
  loadScore: z.number().default(0),
  baseUrl: z.string().optional(),
  providerId: z.string().optional(),
});

export type ProviderKeySlot = z.infer<typeof ProviderKeySlotSchema>;

// ---------------------------------------------------------------------------
// Результат бронирования слота
// ---------------------------------------------------------------------------

export interface AcquiredSlot {
  keyId: string;
  apiKey: string;
  maskedKey: string;
  provider: string;
  model: string;
  originalModel: string;
  tier: ModelTier;
  isFallback: boolean;
  loadScore: number;
  baseUrl?: string;
  providerId?: string;
}

// ---------------------------------------------------------------------------
// Мониторинг доступности и здоровья модели
// ---------------------------------------------------------------------------

export interface ModelHealthStatus {
  providerId: string;
  providerType: string;
  modelId: string;
  status: "healthy" | "degraded" | "unavailable";
  latencyMs?: number;
  lastCheckedAt: number;
  failureReason?: string;
  statusCode?: number;
  expiresAt: number;
}

export interface SlotReservationCheck {
  allowed: boolean;
  reason?: "COOLDOWN" | "CIRCUIT_OPEN" | "RPM_LIMIT" | "TPM_LIMIT" | "RPD_LIMIT";
  retryAfterSeconds?: number;
  loadScore: number;
}

// ---------------------------------------------------------------------------
// Входные параметры вызова через SmartModelRouter
// ---------------------------------------------------------------------------

export interface GatewayChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GatewayExecutionOptions {
  tenantId?: string;
  tierHint?: ModelTier;
  fallbackModels?: string[];
  maxAttempts?: number;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GatewayExecutionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  originalModel: string;
  provider: string;
  tier: ModelTier;
  isFallback: boolean;
  keyId: string;
  latencyMs: number;
}

export interface GatewayStreamChunk {
  delta: string;
  model: string;
  isComplete: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

// ---------------------------------------------------------------------------
// Ошибки шлюза LLM
// ---------------------------------------------------------------------------

export class LlmGatewayExhaustedError extends AppError {
  public readonly retryAfterSeconds: number;
  public readonly modelsChecked: string[];

  constructor(message: string, retryAfterSeconds = 15, modelsChecked: string[] = []) {
    super(
      429,
      "LLM_GATEWAY_QUOTA_EXHAUSTED",
      `${message} (Повторите попытку через ${retryAfterSeconds} с)`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
    this.modelsChecked = modelsChecked;
  }
}

export class LlmCircuitBreakerOpenError extends AppError {
  public readonly provider: string;
  public readonly model: string;
  public readonly cooloffSeconds: number;

  constructor(provider: string, model: string, cooloffSeconds = 30) {
    super(
      503,
      "LLM_CIRCUIT_BREAKER_OPEN",
      `Провайдер ${provider} (модель ${model}) временно исключен из пула из-за серии ошибок 5xx. Восстановление через ${cooloffSeconds} с`,
    );
    this.provider = provider;
    this.model = model;
    this.cooloffSeconds = cooloffSeconds;
  }
}
