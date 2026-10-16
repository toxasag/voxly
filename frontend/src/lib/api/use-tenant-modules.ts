"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export interface TenantModuleDTO {
  slug: string;
  name: string;
  installedAt: string;
  quantity: number;
  trialEndsAt: string | null;
}

export const tenantModuleKeys = {
  current: (tenantId: string) => ["tenant", "modules", tenantId] as const,
  all: ["tenant", "modules"] as const,
};

/**
 * Источник истины для Sidebar и Guard.
 *
 * `enabled` привязан к tenantId: до восстановления сессии запрос не уходит,
 * после logout старый список не показывается другому пользователю.
 */
export function useTenantModules(
  tenantId: string | null,
): UseQueryResult<TenantModuleDTO[], ApiClientError> {
  return useQuery({
    queryKey: tenantId === null ? tenantModuleKeys.all : tenantModuleKeys.current(tenantId),
    queryFn: async () => (await apiClient.get<TenantModuleDTO[]>("/api/v1/tenant/modules")).data,
    enabled: tenantId !== null,
    staleTime: 0,
  });
}

/** Используется мутацией маркетплейса для мгновенной синхронизации сайдбара. */
export function useInvalidateTenantModules(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tenantModuleKeys.all });
}
