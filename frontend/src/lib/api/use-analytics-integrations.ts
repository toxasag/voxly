"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export type AnalyticsProvider = "yandex" | "ga4" | "google_ads" | "meta" | "vk";

export interface AnalyticsIntegrationDTO {
  id: string;
  provider: AnalyticsProvider;
  siteName: string;
  siteUrl: string | null;
  counterId: string | null;
  channelAccountId: string | null;
  isDefault: boolean;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationPayload {
  provider: AnalyticsProvider;
  siteName: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config: Record<string, unknown>;
}

export interface UpdateIntegrationPayload {
  id?: string;
  siteName?: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config: Record<string, unknown>;
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
      provider,
      payload,
    }: {
      provider: AnalyticsProvider;
      payload: UpdateIntegrationPayload;
    }): Promise<AnalyticsIntegrationDTO> => {
      const url = payload.id
        ? `/api/v1/analytics/integrations/by-id/${payload.id}`
        : `/api/v1/analytics/integrations/${provider}`;

      const res = await apiClient.put<AnalyticsIntegrationDTO>(url, payload);
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
      await apiClient.delete(`/api/v1/analytics/integrations/by-id/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsIntegrationsKeys.all });
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
