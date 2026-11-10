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

export type Bitrix24SyncStatus = "success" | "error" | "skipped" | "pending";

export interface Bitrix24SyncLogDTO {
  id: string;
  deal_id: string | null;
  deal_title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: Bitrix24SyncStatus;
  bitrix_lead_id: string | null;
  response_status: number | null;
  error_message: string | null;
  lead_source: string | null;
  widget_name: string | null;
  request_payload: Record<string, unknown> | null;
  response_body: Record<string, unknown> | null;
  created_at: string;
}

export interface Bitrix24LogsResponse {
  data: Bitrix24SyncLogDTO[];
  logs: Bitrix24SyncLogDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const bitrix24Keys = {
  all: ["settings", "integrations", "bitrix24"] as const,
  config: () => [...bitrix24Keys.all, "config"] as const,
  widgets: () => [...bitrix24Keys.all, "widgets"] as const,
  logs: (params?: { limit?: number; page?: number }) => [...bitrix24Keys.all, "logs", params] as const,
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

export function useBitrix24Logs(params: { limit?: number; page?: number } = {}) {
  const limit = params.limit ?? 50;
  const page = params.page ?? 1;

  return useQuery({
    queryKey: bitrix24Keys.logs({ limit, page }),
    queryFn: async () => {
      const res = await apiClient.get<Bitrix24LogsResponse>(
        `/api/v1/settings/integrations/bitrix24/logs?limit=${limit}&page=${page}`,
      );
      return res.data;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useRetryBitrix24Sync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (logOrDealId: string) => {
      const res = await apiClient.post<{ success: boolean; leadId?: number | string; error?: string }>(
        `/api/v1/settings/integrations/bitrix24/retry/${logOrDealId}`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bitrix24Keys.logs() });
      void queryClient.invalidateQueries({ queryKey: bitrix24Keys.config() });
    },
  });
}
