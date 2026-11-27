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
  paginated: (params: { search?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string }) =>
    [...serviceKeys.all, "paginated", params] as const,
  detail: (id: string) => [...serviceKeys.all, "detail", id] as const,
};

export function useServices(search?: string, enabled = true) {
  return useQuery({
    queryKey: serviceKeys.list(search),
    queryFn: async () => {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await apiClient.get<ServiceItemDTO[]>(`/api/v1/services${q}`);
      return res.data;
    },
    staleTime: 30_000,
    enabled,
  });
}

export function useServicesPaginated(params: {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
} = {}) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  return useQuery({
    queryKey: serviceKeys.paginated({ ...params, page, limit }),
    queryFn: async () => {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("limit", String(limit));
      if (params.search && params.search.trim()) q.set("search", params.search.trim());
      if (params.sortBy) {
        q.set("sort_by", params.sortBy);
        if (params.sortDir) q.set("sort_dir", params.sortDir);
      }
      const res = await apiClient.get<ServiceItemDTO[]>(`/api/v1/services?${q.toString()}`);
      const m = res.meta ?? {};
      const total = Number(m.total ?? res.data.length);
      return {
        items: res.data ?? [],
        meta: {
          total,
          page: Number(m.page ?? page),
          limit: Number(m.limit ?? limit),
          pages: Number(m.pages ?? (total === 0 ? 0 : Math.ceil(total / limit))),
        },
      };
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
      void queryClient.invalidateQueries({ queryKey: ["repair-services-catalog"] });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateServicePayload }) => {
      try {
        const res = await apiClient.put<ServiceItemDTO>(`/api/services/${id}`, payload);
        return res.data;
      } catch {
        const res = await apiClient.patch<ServiceItemDTO>(`/api/v1/services/${id}`, payload);
        return res.data;
      }
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
      void queryClient.invalidateQueries({ queryKey: serviceKeys.detail(vars.id) });
      void queryClient.invalidateQueries({ queryKey: ["repairs", "services-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["repair-services-catalog"] });
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
