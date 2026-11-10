"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export interface TenantQuotaItemDTO {
  feature_key: string;
  name: string;
  description: string;
  category: string;
  current_usage: number;
  is_unlimited: boolean;
  max_limit: number;
  allowed: boolean;
  default_limit: number;
  is_custom_override: boolean;
}

export interface UpdateTenantQuotasPayload {
  quotas: Array<{
    feature_key: string;
    is_unlimited: boolean;
    max_limit?: number;
  }>;
}

export const quotaKeys = {
  all: ["quotas"] as const,
  current: () => [...quotaKeys.all, "current"] as const,
  tenant: (tenantId: string) => [...quotaKeys.all, "admin", tenantId] as const,
};

/**
 * Запрос квот и лимитов для текущего тенанта (клиентский портал).
 */
export function useTenantQuotas() {
  return useQuery({
    queryKey: quotaKeys.current(),
    queryFn: async () => {
      const res = await apiClient.get<TenantQuotaItemDTO[]>("/api/v1/tenant/quotas/current");
      return res.data;
    },
    staleTime: 30_000,
  });
}

/**
 * Запрос квот тенанта для платформенного администратора.
 */
export function useAdminTenantQuotas(tenantId: string | null) {
  return useQuery({
    queryKey: tenantId ? quotaKeys.tenant(tenantId) : quotaKeys.all,
    queryFn: async () => {
      if (!tenantId) return [];
      const res = await apiClient.get<TenantQuotaItemDTO[]>(
        `/api/v1/admin/tenants/${tenantId}/quotas`,
      );
      return res.data;
    },
    enabled: Boolean(tenantId),
    staleTime: 10_000,
  });
}

/**
 * Обновление квот тенанта администратором платформы.
 */
export function useUpdateTenantQuotas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      quotas,
    }: {
      tenantId: string;
      quotas: UpdateTenantQuotasPayload["quotas"];
    }) => {
      const res = await apiClient.put<TenantQuotaItemDTO[]>(
        `/api/v1/admin/tenants/${tenantId}/quotas`,
        { quotas },
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: quotaKeys.tenant(variables.tenantId) });
      queryClient.invalidateQueries({ queryKey: quotaKeys.current() });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      queryClient.invalidateQueries({ queryKey: ["ai-agents"] });
    },
  });
}
