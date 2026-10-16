"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

// Зеркалит backend/src/modules/admin/admin-tenants.routes.ts (AdminTenantDTO).
export interface AdminTenantDTO {
  id: string;
  name: string;
  plan: string;
  status: string;
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
}

export type UpdateTenantPayload = {
  status?: "trial" | "active" | "past_due" | "suspended";
  plan?: "trial" | "start" | "business" | "enterprise";
  subscription_expires_at?: string | null;
  ai_tokens_balance?: number;
  /** Наценка на токены, % от цены провайдера. Допустима отрицательная (скидка). */
  ai_markup_percent?: number;
  /** Баланс ИИ в рублях: сервер сам переводит в копейки. */
  ai_balance_rubles?: number;
};

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
    },
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
