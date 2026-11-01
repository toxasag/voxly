"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { marketplaceKeys } from "@/lib/api/use-marketplace";

export interface AdminTenantChecklist {
  has_channels: boolean;
  has_deals: boolean;
  has_ai: boolean;
  has_knowledge: boolean;
  has_team: boolean;
}

// Зеркалит backend/src/modules/admin/admin-tenants.routes.ts (AdminTenantDTO).
export interface AdminTenantDTO {
  id: string;
  name: string;
  slug?: string;
  plan: string;
  status: string;
  custom_price_rubles: number | null;
  custom_plan_name: string | null;
  business_niche: string | null;
  custom_notes: string | null;
  auth_settings?: {
    require_telegram_auth: boolean;
    allow_password_auth?: boolean;
  };
  require_telegram_auth?: boolean;
  /** УСТАРЕЛО: остаток в штуках токенов. Актуален ai_balance_kopecks. */
  ai_tokens_balance: number;
  /** Баланс ИИ в копейках. */
  ai_balance_kopecks: number;
  /** Наценка платформы на стоимость токенов, % от цены провайдера. */
  ai_markup_percent: number;
  /** Списано за токены в текущем месяце, копейки. */
  ai_spent_month_kopecks: number;
  subscription_expires_at: string | null;
  created_at: string;
  users_count: number;
  modules_count: number;
  channels_count: number;
  ai_agents_count: number;
  ai_active_agents_count: number;
  knowledge_docs_count: number;
  deals_count: number;
  messages_count: number;
  owner_email: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  adoption_score: number;
  adoption_checklist: AdminTenantChecklist;
  ai_status: "not_configured" | "paused" | "active";
}

export type UpdateTenantPayload = {
  status?: "trial" | "active" | "past_due" | "suspended";
  plan?: string;
  subscription_expires_at?: string | null;
  ai_tokens_balance?: number;
  /** Наценка на токены, % от цены провайдера. Допустима отрицательная (скидка). */
  ai_markup_percent?: number;
  /** Баланс ИИ в рублях: сервер сам переводит в копейки. */
  ai_balance_rubles?: number;
  custom_price_rubles?: number | null;
  custom_plan_name?: string | null;
  business_niche?: string | null;
  custom_notes?: string | null;
  require_telegram_auth?: boolean;
  auth_settings?: {
    require_telegram_auth: boolean;
    allow_password_auth?: boolean;
  };
};

export interface ImpersonateResponse {
  access_token?: string;
  refresh_token?: string;
  accessToken?: string;
  refreshToken?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
    phone?: string | null;
    name?: string;
    role?: string;
    platform_role?: string | null;
    permissions?: string[];
  };
  tenant?: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
  };
}

// Зеркалит backend/src/modules/admin/admin-metrics.routes.ts.
export interface AdminMetricsDTO {
  counts: {
    tenants_total: number;
    tenants_active: number;
    tenants_trial: number;
    tenants_suspended: number;
    users_total: number;
    contacts_total: number;
    deals_total: number;
    repair_orders_total: number;
    messages_total: number;
  };
  database: {
    size_bytes: number;
    connections: number;
    uptime_seconds: number;
  };
  queue: {
    implemented: boolean;
    pending: number;
    failed: number;
  };
  generated_at: string;
}

// Зеркалит backend/src/modules/admin/admin-platform.routes.ts.
export interface AdminPlanDTO {
  plan: string;
  priceMonthly: number;
  tenants: number;
  active: number;
  trial: number;
  pastDue: number;
  suspended: number;
  aiTokensBalance: number;
  estimatedMonthly: number;
}

export interface AdminBillingDTO {
  plans: AdminPlanDTO[];
  totals: { tenants: number; active: number; estimatedMrr: number };
  /** Платёжный провайдер ещё не подключён — цифры оценочные. */
  billingProvider: { connected: boolean; provider: string | null };
}

export interface AdminLogDTO {
  id: string;
  tenantId: string;
  tenantName: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export const adminKeys = {
  tenants: ["admin", "tenants"] as const,
  metrics: ["admin", "metrics"] as const,
  billing: ["admin", "billing"] as const,
  logs: (filters: { limit: number; offset: number; action?: string }) =>
    ["admin", "logs", filters] as const,
};

/** Все тенанты платформы. 403 для всех, кроме platform_owner. */
export function useAdminTenants(): UseQueryResult<AdminTenantDTO[], ApiClientError> {
  return useQuery({
    queryKey: adminKeys.tenants,
    queryFn: async () => (await apiClient.get<AdminTenantDTO[]>("/api/v1/admin/tenants")).data,
  });
}

/** Платформенные метрики: счётчики сущностей, БД, очередь. */
export function useAdminMetrics(refreshMs = 30_000): UseQueryResult<AdminMetricsDTO, ApiClientError> {
  return useQuery({
    queryKey: adminKeys.metrics,
    queryFn: async () => (await apiClient.get<AdminMetricsDTO>("/api/v1/admin/metrics")).data,
    refetchInterval: refreshMs,
  });
}

/** Изменение тарифа/статуса/лимитов тенанта; инвалидирует список. */
export function useUpdateTenant(): UseMutationResult<
  AdminTenantDTO,
  ApiClientError,
  { id: string } & UpdateTenantPayload
> {
  const queryClient = useQueryClient();

  return useMutation<AdminTenantDTO, ApiClientError, { id: string } & UpdateTenantPayload>({
    mutationFn: async ({ id, ...payload }) =>
      (await apiClient.patch<AdminTenantDTO>(`/api/v1/admin/tenants/${id}`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
      void queryClient.invalidateQueries({ queryKey: adminKeys.metrics });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.modules });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.billing });
      void queryClient.invalidateQueries({ queryKey: ["tenant", "info"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant", "modules"] });
    },
  });
}

/** Полное удаление компании (тенанта); инвалидирует список и метрики. */
export function useDeleteTenant(): UseMutationResult<
  { success: boolean; message?: string },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; message?: string }, ApiClientError, string>({
    mutationFn: async (id: string) =>
      (await apiClient.delete<{ success: boolean; message?: string }>(`/api/v1/admin/tenants/${id}`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.tenants });
      void queryClient.invalidateQueries({ queryKey: adminKeys.metrics });
      void queryClient.invalidateQueries({ queryKey: adminKeys.billing });
    },
  });
}

/** Вход суперадминистратора под аккаунтом компании (Impersonation). */
export function useImpersonateTenant(): UseMutationResult<
  ImpersonateResponse,
  ApiClientError,
  string
> {
  return useMutation<ImpersonateResponse, ApiClientError, string>({
    mutationFn: async (tenantId: string) =>
      (await apiClient.post<ImpersonateResponse>(`/api/v1/admin/tenants/${tenantId}/impersonate`)).data,
  });
}

/** Сводка по тарифам и оценочная выручка. */
export function useAdminBilling(): UseQueryResult<AdminBillingDTO, ApiClientError> {
  return useQuery({
    queryKey: adminKeys.billing,
    queryFn: async () => (await apiClient.get<AdminBillingDTO>("/api/v1/admin/billing")).data,
  });
}

/** Аудит действий по всем арендаторам. */
export function useAdminLogs(filters: {
  limit: number;
  offset: number;
  action?: string;
}): UseQueryResult<{ items: AdminLogDTO[]; total: number }, ApiClientError> {
  return useQuery({
    queryKey: adminKeys.logs(filters),
    queryFn: async () => {
      const res = await apiClient.get<AdminLogDTO[]>("/api/v1/admin/logs", {
        query: {
          limit: filters.limit,
          offset: filters.offset,
          ...(filters.action !== undefined && { action: filters.action }),
        },
      });
      return { items: res.data, total: res.meta?.total ?? res.data.length };
    },
  });
}

/** Продление подписки на N дней от текущей даты окончания (или от сегодня). */
export function renewSubscriptionDate(current: string | null, days: number): string {
  const base = current !== null ? new Date(current) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

export interface AdminMarketplaceModuleDTO {
  slug: string;
  name: string;
  description: string;
  priceMonthly: number;
  billingKind: string;
  basePrice: number;
  unitPrice: number;
  includedUnits: number;
  unitLabel: string;
  isMulti: boolean;
  category: string;
  icon: string;
  trialDays: number;
  isAvailable: boolean;
  sortOrder: number;
  pendingUnitPrice: number | null;
  pendingEffectiveAt: string | null;
}

export interface AdminPlatformBillingConfigDTO {
  baseCrmPrice: number;
  baseCrmUsers: number;
  baseCrmExtraUserPrice: number;
  baseCrmIncludedAiAgents: number;
  baseCrmIncludedTelegram: number;
  baseCrmIncludedWhatsapp: number;
  baseCrmIncludedMax: number;
  baseCrmIncludedWebchat: number;
  updatedAt?: string;
}

export function useAdminMarketplaceModules(): UseQueryResult<AdminMarketplaceModuleDTO[], ApiClientError> {
  return useQuery({
    queryKey: ["admin", "marketplace", "modules"],
    queryFn: async () =>
      (await apiClient.get<AdminMarketplaceModuleDTO[]>("/api/v1/admin/marketplace/modules")).data,
  });
}

export function useUpdateMarketplaceModule(): UseMutationResult<
  { success: boolean; slug: string },
  ApiClientError,
  {
    slug: string;
    unit_price?: number;
    base_price?: number;
    included_units?: number;
    is_available?: boolean;
    delayed_for_existing?: boolean;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, ...payload }) =>
      (
        await apiClient.put<{ success: boolean; slug: string }>(
          `/api/v1/admin/marketplace/modules/${slug}`,
          payload,
        )
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "marketplace", "modules"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    },
  });
}

export function useAdminBillingConfig(): UseQueryResult<AdminPlatformBillingConfigDTO, ApiClientError> {
  return useQuery({
    queryKey: ["admin", "billing", "config"],
    queryFn: async () =>
      (await apiClient.get<AdminPlatformBillingConfigDTO>("/api/v1/admin/billing/config")).data,
  });
}

export function useUpdateAdminBillingConfig(): UseMutationResult<
  AdminPlatformBillingConfigDTO,
  ApiClientError,
  Partial<AdminPlatformBillingConfigDTO>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const snakePayload = {
        base_crm_price: payload.baseCrmPrice,
        base_crm_users: payload.baseCrmUsers,
        base_crm_extra_user_price: payload.baseCrmExtraUserPrice,
        base_crm_included_ai_agents: payload.baseCrmIncludedAiAgents,
        base_crm_included_telegram: payload.baseCrmIncludedTelegram,
        base_crm_included_whatsapp: payload.baseCrmIncludedWhatsapp,
        base_crm_included_max: payload.baseCrmIncludedMax,
        base_crm_included_webchat: payload.baseCrmIncludedWebchat,
      };
      return (
        await apiClient.put<AdminPlatformBillingConfigDTO>(
          "/api/v1/admin/billing/config",
          snakePayload,
        )
      ).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing", "config"] });
    },
  });
}

export type LlmProviderType = "gemini" | "openai" | "openrouter" | "deepseek" | "custom";

export interface AdminLlmProviderDTO {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  apiKeysCount: number;
  maskedKeys: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface AdminLlmProviderPayload {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  apiKeys?: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface AdminIntegrationsConfigDTO {
  robokassa: {
    merchantLogin: string;
    isTest: boolean;
    hashAlgo: string;
    tax: string;
    hasPassword1: boolean;
    hasPassword2: boolean;
    isConfigured: boolean;
  };
  llm: {
    baseUrl: string;
    hasApiKey: boolean;
    embeddingModel: string;
    chatModel: string;
    isConfigured: boolean;
  };
  llmProviders: AdminLlmProviderDTO[];
  updatedAt: string;
}

export interface UpdateAdminIntegrationsPayload {
  robokassa?: {
    merchantLogin?: string;
    password1?: string;
    password2?: string;
    isTest?: boolean;
    hashAlgo?: "SHA256" | "MD5";
    tax?: string;
  };
  llm?: {
    baseUrl?: string;
    apiKey?: string;
    embeddingModel?: string;
    chatModel?: string;
  };
  llmProviders?: AdminLlmProviderPayload[];
}

export function useAdminIntegrationsConfig(): UseQueryResult<AdminIntegrationsConfigDTO, ApiClientError> {
  return useQuery({
    queryKey: ["admin", "integrations", "config"],
    queryFn: async () =>
      (await apiClient.get<AdminIntegrationsConfigDTO>("/api/v1/admin/integrations/config")).data,
  });
}

export function useUpdateAdminIntegrationsConfig(): UseMutationResult<
  AdminIntegrationsConfigDTO,
  ApiClientError,
  UpdateAdminIntegrationsPayload
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.put<AdminIntegrationsConfigDTO>("/api/v1/admin/integrations/config", payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations", "config"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
      void queryClient.invalidateQueries({ queryKey: ["marketplace", "billing"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-bots"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-agent", "providers"] });
    },
  });
}

export interface LlmModelItem {
  id: string;
  name: string;
  type: "chat" | "embedding";
}

export interface LlmKeyVerifyResult {
  index: number;
  maskedKey: string;
  status: "valid" | "invalid";
  statusCode?: number;
  message: string;
  modelsCount?: number;
}

export interface VerifyLlmKeysResponse {
  success: boolean;
  summary: { total: number; valid: number; invalid: number };
  results: LlmKeyVerifyResult[];
  models?: LlmModelItem[];
  message?: string;
}

export interface FetchLlmModelsResponse {
  success: boolean;
  models: LlmModelItem[];
  message?: string;
}

export function useTestAdminLlm(): UseMutationResult<
  { success: boolean; message: string; modelsCount?: number },
  ApiClientError,
  { baseUrl?: string; apiKey?: string; providerId?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<{ success: boolean; message: string; modelsCount?: number }>("/api/v1/admin/integrations/test-llm", payload)).data,
  });
}

export function useFetchLlmModels(): UseMutationResult<
  FetchLlmModelsResponse,
  ApiClientError,
  { baseUrl?: string; apiKey?: string; providerId?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<FetchLlmModelsResponse>("/api/v1/admin/integrations/llm/models", payload)).data,
  });
}

export function useVerifyLlmKeys(): UseMutationResult<
  VerifyLlmKeysResponse,
  ApiClientError,
  { baseUrl?: string; providerId?: string; keys?: string[] }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<VerifyLlmKeysResponse>("/api/v1/admin/integrations/llm/verify-keys", payload)).data,
  });
}

export function useVerifySingleGeminiKey(): UseMutationResult<
  { success: boolean; is_active: boolean; message: string; modelsCount?: number },
  ApiClientError,
  { apiKey: string; baseUrl?: string; save?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      (
        await apiClient.post<{
          success: boolean;
          is_active: boolean;
          message: string;
          modelsCount?: number;
        }>("/api/integrations/gemini/verify", payload)
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations", "config"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-bots"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-agent", "providers"] });
    },
  });
}

export function useRemoveInvalidLlmKeys(): UseMutationResult<
  { success: boolean; removedCount: number },
  ApiClientError,
  { providerId: string; invalidKeys: string[] }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      (
        await apiClient.post<{ success: boolean; removedCount: number }>(
          "/api/v1/admin/integrations/llm/remove-invalid-keys",
          payload,
        )
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations", "config"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-bots"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant", "integrations"] });
    },
  });
}


