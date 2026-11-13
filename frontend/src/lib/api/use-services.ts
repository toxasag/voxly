"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export interface ServiceItemDTO {
  id: string;
  name: string;
  description: string;
  price: number;
  defaultPrice: number;
  unit: string;
  durationMinutes: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateServicePayload {
  name: string;
  description?: string;
  price?: number;
  default_price?: number;
  unit?: string;
  duration_minutes?: number | null;
}

export interface UpdateServicePayload {
  name?: string;
  description?: string;
  price?: number;
  default_price?: number;
  unit?: string;
  duration_minutes?: number | null;
}

export const serviceKeys = {
  all: ["services"] as const,
  list: (search?: string) => [...serviceKeys.all, "list", search ?? ""] as const,
  detail: (id: string) => [...serviceKeys.all, "detail", id] as const,
};

export function useServices(search?: string) {
  return useQuery({
    queryKey: serviceKeys.list(search),
    queryFn: async () => {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await apiClient.get<ServiceItemDTO[]>(`/api/v1/services${q}`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useService(id: string | null | undefined) {
  return useQuery({
    queryKey: serviceKeys.detail(id ?? ""),
    queryFn: async () => {
      if (!id) return null;
      const res = await apiClient.get<ServiceItemDTO>(`/api/v1/services/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateServicePayload) => {
      const res = await apiClient.post<ServiceItemDTO>("/api/v1/services", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
      // Invalidate service center catalog queries as well for cross-compatibility
      void queryClient.invalidateQueries({ queryKey: ["repairs", "services-catalog"] });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateServicePayload }) => {
      const res = await apiClient.patch<ServiceItemDTO>(`/api/v1/services/${id}`, payload);
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
      void queryClient.invalidateQueries({ queryKey: serviceKeys.detail(vars.id) });
      void queryClient.invalidateQueries({ queryKey: ["repairs", "services-catalog"] });
    },
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ success: boolean; id: string }>(`/api/v1/services/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["repairs", "services-catalog"] });
    },
  });
}
