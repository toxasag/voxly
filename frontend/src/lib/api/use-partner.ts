"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export interface AuthSettings {
  require_telegram_auth: boolean;
  allow_password_auth?: boolean;
}

export interface PartnerChildTenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  parent_tenant_id: string | null;
  auth_settings: AuthSettings;
  custom_pricing: Record<string, unknown> | null;
  custom_price_rubles: number | null;
  users_count?: number;
  contacts_count?: number;
  deals_count?: number;
  admin?: {
    id: string;
    email: string;
    name: string;
    phone: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePartnerTenantPayload {
  name: string;
  slug: string;
  admin_email: string;
  admin_password: string;
  admin_name?: string;
  admin_phone?: string;
  telegram_id?: string | number;
  telegram_username?: string;
  plan?: string;
  price_override?: number | null;
  is_complimentary?: boolean;
  auth_settings?: AuthSettings;
  custom_pricing?: Record<string, unknown>;
}

export interface CreatePartnerTenantResponse {
  tenant: PartnerChildTenantDTO;
  admin: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export const partnerKeys = {
  all: ["partner"] as const,
  tenants: () => [...partnerKeys.all, "tenants"] as const,
};

/**
 * Список дочерних тенантов партнера
 */
export function usePartnerChildTenants(): UseQueryResult<PartnerChildTenantDTO[], ApiClientError> {
  return useQuery({
    queryKey: partnerKeys.tenants(),
    queryFn: async () => {
      const res = await apiClient.get<PartnerChildTenantDTO[]>("/api/v1/partner/tenants");
      return res.data;
    },
  });
}

/**
 * Создание дочернего тенанта
 */
export function useCreatePartnerTenant(): UseMutationResult<
  CreatePartnerTenantResponse,
  ApiClientError,
  CreatePartnerTenantPayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreatePartnerTenantPayload) => {
      const res = await apiClient.post<CreatePartnerTenantResponse>(
        "/api/v1/partner/tenants",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnerKeys.tenants() });
    },
  });
}

/**
 * Обновление настроек авторизации дочернего тенанта
 */
export function useUpdateTenantAuthSettings(): UseMutationResult<
  PartnerChildTenantDTO,
  ApiClientError,
  { tenantId: string; auth_settings: AuthSettings }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tenantId, auth_settings }) => {
      const res = await apiClient.patch<PartnerChildTenantDTO>(
        `/api/v1/partner/tenants/${tenantId}/auth-settings`,
        auth_settings,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnerKeys.tenants() });
    },
  });
}
