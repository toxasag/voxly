"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export type AnalyticsProvider = "yandex" | "ga4" | "google_ads" | "meta" | "vk";

export interface AnalyticsIntegrationDTO {
  id: string;
  provider: AnalyticsProvider;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateIntegrationPayload {
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

export const analyticsIntegrationsKeys = {
  all: ["analytics", "integrations"] as const,
  detail: (provider: string) => ["analytics", "integrations", provider] as const,
};

export function useAnalyticsIntegrations() {
  return useQuery({
    queryKey: analyticsIntegrationsKeys.all,
    queryFn: async (): Promise<AnalyticsIntegrationDTO[]> => {
      const res = await apiClient.get<{ data: AnalyticsIntegrationDTO[] }>(
        "/api/v1/analytics/integrations",
      );
      return res.data.data;
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
      const res = await apiClient.put<{ data: AnalyticsIntegrationDTO }>(
        `/api/v1/analytics/integrations/${provider}`,
        payload,
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsIntegrationsKeys.all });
    },
  });
}

export function useTestAnalyticsIntegration() {
  return useMutation({
    mutationFn: async (provider: AnalyticsProvider): Promise<TestIntegrationResult> => {
      const res = await apiClient.post<{ data: TestIntegrationResult }>(
        `/api/v1/analytics/integrations/${provider}/test`,
        {},
      );
      return res.data.data;
    },
  });
}
