"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export interface SiteIntegrationDTO {
  id: string;
  tenant_id: string;
  name: string;
  site_url: string | null;
  webhook_token: string;
  webhook_url: string;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  target_pipeline_name?: string | null;
  target_stage_name?: string | null;
  field_mapping: Record<string, string>;
  is_active: boolean;
  leads_count: number;
  last_lead_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSitePayload {
  name: string;
  site_url?: string;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  field_mapping?: Record<string, string>;
  is_active?: boolean;
}

export interface UpdateSitePayload {
  id: string;
  name?: string;
  site_url?: string;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  field_mapping?: Record<string, string>;
  is_active?: boolean;
}

const BASE_PATH = "/api/v1/channels/sites";

export const siteKeys = {
  all: ["sites"] as const,
  lists: () => [...siteKeys.all, "list"] as const,
  detail: (id: string) => [...siteKeys.all, "detail", id] as const,
};

export function useSiteIntegrations(): UseQueryResult<SiteIntegrationDTO[], ApiClientError> {
  return useQuery({
    queryKey: siteKeys.lists(),
    queryFn: async () => {
      const response = await apiClient.get<SiteIntegrationDTO[]>(BASE_PATH);
      return response.data;
    },
  });
}

export function useSiteIntegration(id: string | null): UseQueryResult<SiteIntegrationDTO, ApiClientError> {
  return useQuery({
    queryKey: siteKeys.detail(id ?? ""),
    queryFn: async () => {
      const response = await apiClient.get<SiteIntegrationDTO>(`${BASE_PATH}/${id ?? ""}`);
      return response.data;
    },
    enabled: Boolean(id),
  });
}

export function useCreateSiteIntegration(): UseMutationResult<
  SiteIntegrationDTO,
  ApiClientError,
  CreateSitePayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const response = await apiClient.post<SiteIntegrationDTO>(BASE_PATH, payload);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.all });
    },
  });
}

export function useUpdateSiteIntegration(): UseMutationResult<
  SiteIntegrationDTO,
  ApiClientError,
  UpdateSitePayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      const response = await apiClient.patch<SiteIntegrationDTO>(`${BASE_PATH}/${id}`, body);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.all });
    },
  });
}

export function useDeleteSiteIntegration(): UseMutationResult<
  void,
  ApiClientError,
  { id: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      await apiClient.delete<null>(`${BASE_PATH}/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.all });
    },
  });
}

export function useRegenerateSiteToken(): UseMutationResult<
  SiteIntegrationDTO,
  ApiClientError,
  { id: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      const response = await apiClient.post<SiteIntegrationDTO>(`${BASE_PATH}/${id}/regenerate-token`);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.all });
    },
  });
}

export function useToggleSiteActive(): UseMutationResult<
  SiteIntegrationDTO,
  ApiClientError,
  { id: string; is_active: boolean }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }) => {
      const response = await apiClient.patch<SiteIntegrationDTO>(`${BASE_PATH}/${id}`, { is_active });
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.all });
    },
  });
}
