"use client";

import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

const BASE_PATH = "/api/v1/integrations/whatsapp";

export interface WhatsappStartQrResult {
  ok: boolean;
  instanceName: string;
  qr: string | null;
  status: "qr_ready" | "preparing" | "connected";
}

export interface WhatsappStatusResult {
  ok: boolean;
  status: "connected" | "qr_ready" | "preparing";
  qr?: string | null;
  phone?: string;
  accountId?: string;
}

export function useWhatsappStartQr(): UseMutationResult<
  WhatsappStartQrResult,
  ApiClientError,
  { label: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<WhatsappStartQrResult>(`${BASE_PATH}/auth/qr/start`, payload)).data,
  });
}

export function useWhatsappQrStatus(
  instanceName: string | null,
  label: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["whatsapp", "qr-status", instanceName],
    queryFn: async () => {
      if (!instanceName) return null;
      const res = await apiClient.get<WhatsappStatusResult>(
        `${BASE_PATH}/auth/qr/status?instanceName=${encodeURIComponent(instanceName)}&label=${encodeURIComponent(label)}`,
      );
      return res.data;
    },
    enabled: Boolean(instanceName) && enabled,
    retry: 1,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "connected") return false;
      if (query.state.status === "error") return 5000;
      return 2500;
    },
  });
}
