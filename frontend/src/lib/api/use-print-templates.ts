"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./apiClient";

export interface PrintTemplateDTO {
  id: string;
  slug: "work_order" | "completion_act" | "warranty_ticket" | "receipt";
  name: string;
  description: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  bodyTemplate: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePrintTemplatePayload {
  name?: string;
  description?: string;
  page_size?: "A4" | "A5" | "thermal_80mm";
  orientation?: "portrait" | "landscape";
  body_template: string;
}

export const printTemplateKeys = {
  all: ["print-templates"] as const,
  list: () => [...printTemplateKeys.all, "list"] as const,
  detail: (slug: string) => [...printTemplateKeys.all, "detail", slug] as const,
};

export function usePrintTemplates() {
  return useQuery({
    queryKey: printTemplateKeys.list(),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateDTO[]>("/api/v1/print-templates");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function usePrintTemplate(slug: string) {
  return useQuery({
    queryKey: printTemplateKeys.detail(slug),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateDTO>(`/api/v1/print-templates/${slug}`);
      return res.data;
    },
    enabled: Boolean(slug),
  });
}

export function useUpdatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdatePrintTemplatePayload }) => {
      const res = await apiClient.put<PrintTemplateDTO>(`/api/v1/print-templates/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all });
    },
  });
}

export function getPrintRenderUrl(slug: string, orderId: string): string {
  return `/api/v1/print-templates/${slug}/render?orderId=${encodeURIComponent(orderId)}`;
}
