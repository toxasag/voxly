"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import type { AiBot, BotContextEntity, BotModel, BotStatus } from "@/lib/ai-bots/ai-bots.types";
import type { CreateBotPayload, UpdateBotPayload } from "@/schemas/ai-bot.schema";

// ---------------------------------------------------------------------------
// AI-агенты: реальные данные вместо моков.
//
// Прежний `use-bots.ts` держал список в `useState(MOCK_BOTS)`: карточки
// «Помощник по продажам» и «Статус ремонта» были захардкожены, одинаковы у всех
// арендаторов и исчезали при перезагрузке. Создание агента там же работало «до
// F5», что выглядело как сохранение, но им не было.
// ---------------------------------------------------------------------------

const BASE_PATH = "/api/v1/ai";

export const aiKeys = {
  agents: ["ai", "agents"] as const,
  agent: (id: string) => ["ai", "agents", id] as const,
  balance: ["ai", "balance"] as const,
};

/** DTO сервера. camelCase, в отличие от snake_case доменного типа `AiBot`. */
interface AiAgentDTO {
  id: string;
  name: string;
  description: string;
  accent: AiBot["accent"];
  model: string;
  status: BotStatus;
  mode: AiBot["mode"];
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  contextEntities: string[];
  wizardConfig?: {
    presetId?: string;
    consultantName?: string;
    consultantRole?: string;
    businessNiche?: string;
    targetAction?: string;
    handoffSpecialist?: string;
    isCustomEdited?: boolean;
    crawl_status?: "idle" | "pending" | "in_progress" | "ready" | "failed";
    website_url?: string;
    crawl_pages_scanned?: number;
    crawl_pages_indexed?: number;
    crawl_error?: string;
    crawl_updated_at?: string;
  } | null;
  tokensUsed: number;
  requestsCount: number;
  avgLatencyMs: number;
  spentKopecks: number;
  targetPageUrl?: string | null;
  generatedSystemPrompt?: string | null;
  knowledgeBaseMd?: string;
  feedbackLearningEnabled?: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Приведение DTO к доменному типу страницы.
 *
 * `tokens_limit` больше не приходит с сервера: лимит на агента заменён общим
 * балансом ИИ в деньгах — у разных моделей цена 1k токенов различается в
 * десятки раз, поэтому «остаток токенов» на агента ничего не значил. Поле
 * оставлено в типе ради существующих карточек и равно 0, что интерфейс трактует
 * как «лимита нет».
 */
function toAiBot(dto: AiAgentDTO): AiBot {
  const wizardConfig = dto.wizardConfig;
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    accent: dto.accent,
    model: dto.model as BotModel,
    status: dto.status,
    mode: dto.mode,
    temperature: dto.temperature,
    max_tokens: dto.maxTokens,
    system_prompt: dto.systemPrompt,
    context_entities: dto.contextEntities as BotContextEntity[],
    target_page_url: dto.targetPageUrl,
    generated_system_prompt: dto.generatedSystemPrompt,
    knowledge_base_md: dto.knowledgeBaseMd ?? "",
    feedback_learning_enabled: dto.feedbackLearningEnabled ?? true,
    wizard_config: wizardConfig,
    website_url: wizardConfig?.website_url,
    crawl_status: wizardConfig?.crawl_status,
    crawl_pages_scanned: wizardConfig?.crawl_pages_scanned,
    crawl_pages_indexed: wizardConfig?.crawl_pages_indexed,
    crawl_error: wizardConfig?.crawl_error,
    tokens_used: dto.tokensUsed,
    tokens_limit: 0,
    requests_count: dto.requestsCount,
    avg_latency_ms: dto.avgLatencyMs,
    cost_rub: dto.spentKopecks / 100,
    last_used_at: dto.lastUsedAt,
    created_at: dto.createdAt,
    updated_at: dto.updatedAt,
  };
}

function toPayload(payload: CreateBotPayload | UpdateBotPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (payload.name !== undefined) body.name = payload.name;
  if (payload.description !== undefined) body.description = payload.description;
  if (payload.model !== undefined) body.model = payload.model;
  if (payload.mode !== undefined) body.mode = payload.mode;
  if (payload.status !== undefined) body.status = payload.status;
  if (payload.accent !== undefined) body.accent = payload.accent;
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.max_tokens !== undefined) body.max_tokens = payload.max_tokens;
  if (payload.system_prompt !== undefined) body.system_prompt = payload.system_prompt;
  if (payload.context_entities !== undefined) body.context_entities = payload.context_entities;
  if (payload.wizard_config !== undefined) body.wizard_config = payload.wizard_config;
  if (payload.website_url !== undefined) body.website_url = payload.website_url;
  if (payload.map_reviews_url !== undefined) body.map_reviews_url = payload.map_reviews_url;
  if (payload.sync_crm !== undefined) body.sync_crm = payload.sync_crm;
  if (payload.whatsapp_chat_text !== undefined) body.whatsapp_chat_text = payload.whatsapp_chat_text;
  if (payload.target_page_url !== undefined) body.target_page_url = payload.target_page_url;
  if (payload.generated_system_prompt !== undefined) body.generated_system_prompt = payload.generated_system_prompt;
  if (payload.knowledge_base_md !== undefined) body.knowledge_base_md = payload.knowledge_base_md;
  if (payload.feedback_learning_enabled !== undefined) body.feedback_learning_enabled = payload.feedback_learning_enabled;

  return body;
}

export function useAiAgents(): UseQueryResult<AiBot[], ApiClientError> {
  return useQuery({
    queryKey: aiKeys.agents,
    queryFn: async () => {
      const res = await apiClient.get<AiAgentDTO[]>(`${BASE_PATH}/agents`);
      return res.data.map(toAiBot);
    },
  });
}

export function useAiAgent(id: string): UseQueryResult<AiBot, ApiClientError> {
  return useQuery({
    queryKey: aiKeys.agent(id),
    queryFn: async () => {
      const res = await apiClient.get<AiAgentDTO>(`${BASE_PATH}/agents/${id}`);
      return toAiBot(res.data);
    },
    // Один повтор вместо трёх: 404 у несуществующего агента повторять бессмысленно.
    retry: (count, error) => (error.status === 404 ? false : count < 1),
  });
}

export function useCreateAiAgent(): UseMutationResult<AiBot, ApiClientError, CreateBotPayload> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<AiAgentDTO>(`${BASE_PATH}/agents`, toPayload(payload));
      return toAiBot(res.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.agents });
    },
  });
}

export function useUpdateAiAgent(): UseMutationResult<
  AiBot,
  ApiClientError,
  { id: string; payload: UpdateBotPayload }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<AiAgentDTO>(
        `${BASE_PATH}/agents/${id}`,
        toPayload(payload),
      );
      return toAiBot(res.data);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.agents });
      void queryClient.invalidateQueries({ queryKey: aiKeys.agent(variables.id) });
    },
  });
}

export function useDeleteAiAgent(): UseMutationResult<void, ApiClientError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      await apiClient.delete<null>(`${BASE_PATH}/agents/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.agents });
    },
  });
}

export interface PromptPreviewResponse {
  resolvedPrompt: string;
  variables: Record<string, string>;
}

export function useAgentPromptPreview(
  agentId: string,
  systemPrompt?: string,
): UseQueryResult<PromptPreviewResponse, ApiClientError> {
  return useQuery({
    queryKey: ["ai", "agents", agentId, "prompt-preview", systemPrompt ?? ""],
    queryFn: async () => {
      const res = await apiClient.post<PromptPreviewResponse>(
        `${BASE_PATH}/agents/${agentId}/prompt-preview`,
        systemPrompt ? { system_prompt: systemPrompt } : {},
      );
      return res.data;
    },
    enabled: Boolean(agentId),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Баланс ИИ
// ---------------------------------------------------------------------------

export interface AiBalance {
  balanceKopecks: number;
  spentThisMonthKopecks: number;
  spentTotalKopecks: number;
  requestsThisMonth: number;
  markupPercent: number;
  estimatedTokensLeft: number;
  lastTopupAt: string | null;
}

export function useAiBalance(enabled = true): UseQueryResult<AiBalance, ApiClientError> {
  return useQuery({
    queryKey: aiKeys.balance,
    queryFn: async () => (await apiClient.get<AiBalance>(`${BASE_PATH}/balance`)).data,
    enabled,
    // 403 у роли без billing:manage повторять незачем.
    retry: (count, error) => (error.status === 403 ? false : count < 1),
  });
}

export function useTopupAiBalance(): UseMutationResult<
  AiBalance,
  ApiClientError,
  { amountRubles: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amountRubles }) =>
      (
        await apiClient.post<AiBalance>(`${BASE_PATH}/balance/topup`, {
          amount_rubles: amountRubles,
        })
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.balance });
    },
  });
}

/** Копейки в рубли для отображения: деление выполняется только на выводе. */
export function formatKopecks(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
}

export interface ActiveProviderInfo {
  name: string;
  providerType: string;
  chatModel?: string;
  isConfigured: boolean;
}

export interface AiModelItem {
  id: string;
  label: string;
  provider: string;
  contextWindow: number;
  costInPer1k: number;
  costOutPer1k: number;
  isConfigured?: boolean;
}

export interface AiModelsResponse {
  activeProvider: ActiveProviderInfo;
  data: AiModelItem[];
}

export function useAiModels(): UseQueryResult<AiModelsResponse, ApiClientError> {
  return useQuery({
    queryKey: ["ai", "models"],
    queryFn: async () => {
      const res = await apiClient.get<unknown>(`${BASE_PATH}/models`);
      const body = res.data;

      // Формат 1: body это { activeProvider, data: [...] }
      if (body && typeof body === "object" && !Array.isArray(body) && "activeProvider" in body) {
        const casted = body as { activeProvider?: ActiveProviderInfo; data?: AiModelItem[] };
        return {
          activeProvider: casted.activeProvider ?? {
            name: "Google Gemini",
            providerType: "gemini",
            isConfigured: true,
          },
          data: Array.isArray(casted.data) ? casted.data : [],
        };
      }

      // Формат 2: body это сразу массив моделей data: AiModelItem[]
      if (Array.isArray(body)) {
        const envelope = res as unknown as { activeProvider?: ActiveProviderInfo };
        return {
          activeProvider: envelope.activeProvider ?? {
            name: "Google Gemini",
            providerType: "gemini",
            isConfigured: true,
          },
          data: body as AiModelItem[],
        };
      }

      return {
        activeProvider: {
          name: "Google Gemini",
          providerType: "gemini",
          isConfigured: true,
        },
        data: [],
      };
    },
    staleTime: 60_000,
  });
}
