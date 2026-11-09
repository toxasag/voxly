"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export const LEAD_SOURCES = [
  "whatsapp",
  "max",
  "telegram_personal",
  "telegram_bot",
  "site_widget",
  "manual",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface SimpleWidgetDTO {
  id: string;
  name: string;
  site_domain: string;
  status: string;
  created_at?: string;
}

export interface Bitrix24ConfigDTO {
  webhook_url: string;
  is_enabled: boolean;
  allowed_sources?: LeadSource[];
  selected_widget_ids?: string[];
  custom_source_id?: string;
  send_utm_marks?: boolean;
  send_geo_data?: boolean;
  last_lead_id: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface UpdateBitrix24Payload {
  webhook_url?: string;
  is_enabled?: boolean;
  allowed_sources?: (LeadSource | string)[];
  selected_widget_ids?: string[];
  custom_source_id?: string;
  send_utm_marks?: boolean;
  send_geo_data?: boolean;
}

export interface TestBitrix24Response {
  success: boolean;
  leadId?: number | string;
  message: string;
  error?: string;
  details?: string;
}

export const bitrix24Keys = {
  all: ["settings", "integrations", "bitrix24"] as const,
  config: () => [...bitrix24Keys.all, "config"] as const,
  widgets: () => [...bitrix24Keys.all, "widgets"] as const,
};

export function useTenantWidgets() {
  return useQuery({
    queryKey: bitrix24Keys.widgets(),
    queryFn: async () => {
      const res = await apiClient.get<SimpleWidgetDTO[]>(
        "/api/v1/settings/integrations/bitrix24/widgets",
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useBitrix24Config() {
  return useQuery({
    queryKey: bitrix24Keys.config(),
    queryFn: async () => {
      const res = await apiClient.get<Bitrix24ConfigDTO>(
        "/api/v1/settings/integrations/bitrix24",
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateBitrix24Config() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateBitrix24Payload) => {
      const res = await apiClient.put<Bitrix24ConfigDTO>(
        "/api/v1/settings/integrations/bitrix24",
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(bitrix24Keys.config(), data);
    },
  });
}

export function useTestBitrix24Connection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload?: { webhook_url?: string }) => {
      const res = await apiClient.post<TestBitrix24Response>(
        "/api/v1/settings/integrations/bitrix24/test",
        payload ?? {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bitrix24Keys.config() });
    },
  });
}
