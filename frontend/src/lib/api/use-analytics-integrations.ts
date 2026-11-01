"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export type AnalyticsProvider =
  | "yandex"
  | "ga4"
  | "google_ads"
  | "meta"
  | "vk"
  | "yandex_metrika"
  | "google_analytics_4"
  | "meta_pixel"
  | "vk_ads";

export type CanonicalAnalyticsProvider = "yandex" | "ga4" | "google_ads" | "meta" | "vk";

export function normalizeAnalyticsProvider(provider: string): CanonicalAnalyticsProvider {
  switch (provider) {
    case "yandex_metrika":
    case "yandex":
      return "yandex";
    case "google_analytics_4":
    case "ga4":
      return "ga4";
    case "meta_pixel":
    case "meta":
      return "meta";
    case "vk_ads":
    case "vk":
      return "vk";
    case "google_ads":
    default:
      return "google_ads";
  }
}

export interface AnalyticsEventRules {
  onLeadCreated?: boolean;
  onDealWon?: boolean;
  onFirstMessage?: boolean;
  stageIds?: string[];
}

export interface AnalyticsIntegrationDTO {
  id: string;
  provider: AnalyticsProvider;
  canonicalProvider?: CanonicalAnalyticsProvider;
  name?: string;
  siteName: string;
  siteUrl: string | null;
  counterId: string | null;
  channelAccountId: string | null;
  isDefault: boolean;
  config: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  eventRules?: AnalyticsEventRules;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationPayload {
  provider: AnalyticsProvider;
  name?: string;
  siteName?: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  eventRules?: AnalyticsEventRules;
}

export interface UpdateIntegrationPayload {
  id?: string;
  name?: string;
  siteName?: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  eventRules?: AnalyticsEventRules;
}

export interface TestIntegrationResult {
  provider: AnalyticsProvider;
  success: boolean;
  eventName: string;
  status: number;
  responseSnippet?: string;
  error?: string;
}

export interface TestQueueResult {
  jobId: string;
  provider: AnalyticsProvider;
  status: "enqueued" | "failed";
  message: string;
}

export interface TestQueueStatus {
  jobId: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  deliveredAt: string | null;
}

export const analyticsIntegrationsKeys = {
  all: ["analytics", "integrations"] as const,
  detail: (provider: string) => ["analytics", "integrations", provider] as const,
  jobStatus: (jobId: string) => ["analytics", "jobStatus", jobId] as const,
};

export function useAnalyticsIntegrations() {
  return useQuery({
    queryKey: analyticsIntegrationsKeys.all,
    queryFn: async (): Promise<AnalyticsIntegrationDTO[]> => {
      const res = await apiClient.get<AnalyticsIntegrationDTO[]>(
        "/api/v1/analytics/integrations",
      );
      return res.data ?? [];
    },
  });
}

export function useCreateAnalyticsIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateIntegrationPayload): Promise<AnalyticsIntegrationDTO> => {
      const res = await apiClient.post<AnalyticsIntegrationDTO>(
        "/api/v1/analytics/integrations",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsIntegrationsKeys.all });
    },
  });
}

export function useUpdateAnalyticsIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      provider,
      payload,
    }: {
      id?: string;
      provider?: AnalyticsProvider;
      payload: UpdateIntegrationPayload;
    }): Promise<AnalyticsIntegrationDTO> => {
      const targetId = id || payload.id;
      const url = targetId
        ? `/api/v1/analytics/integrations/${targetId}`
        : `/api/v1/analytics/integrations/${provider || "yandex"}`;

      const res = await apiClient.patch<AnalyticsIntegrationDTO>(url, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsIntegrationsKeys.all });
    },
  });
}

export function useDeleteAnalyticsIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/api/v1/analytics/integrations/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsIntegrationsKeys.all });
    },
  });
}

export function useTestAnalyticsIntegrationById() {
  return useMutation({
    mutationFn: async (id: string): Promise<TestIntegrationResult> => {
      const res = await apiClient.post<TestIntegrationResult>(
        `/api/v1/analytics/integrations/${id}/test`,
        {},
      );
      return res.data;
    },
  });
}

export function useTestAnalyticsIntegration() {
  return useMutation({
    mutationFn: async (provider: AnalyticsProvider): Promise<TestIntegrationResult> => {
      const res = await apiClient.post<TestIntegrationResult>(
        `/api/v1/analytics/integrations/${provider}/test`,
        {},
      );
      return res.data;
    },
  });
}

export function useTestQueueAnalyticsIntegration() {
  return useMutation({
    mutationFn: async (provider: AnalyticsProvider): Promise<TestQueueResult> => {
      const res = await apiClient.post<TestQueueResult>(
        `/api/v1/analytics/integrations/${provider}/test-queue`,
        {},
      );
      return res.data;
    },
  });
}

export function useTestQueueStatus(provider: AnalyticsProvider, jobId: string | null) {
  return useQuery({
    queryKey: analyticsIntegrationsKeys.jobStatus(jobId || ""),
    queryFn: async (): Promise<TestQueueStatus> => {
      const res = await apiClient.get<TestQueueStatus>(
        `/api/v1/analytics/integrations/${provider}/test-queue/${jobId}`,
      );
      return res.data;
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "sent" || status === "failed") {
        return false;
      }
      return 1500;
    },
  });
}
