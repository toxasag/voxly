"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { channelKeys } from "@/lib/api/use-channels";

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
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["whatsapp", "qr-status", instanceName],
    queryFn: async () => {
      if (!instanceName) return null;
      const res = await apiClient.get<WhatsappStatusResult>(
        `${BASE_PATH}/auth/qr/status?instanceName=${encodeURIComponent(instanceName)}&label=${encodeURIComponent(label)}`,
      );
      if (res.data?.status === "connected") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("whatsapp") });
      }
      return res.data;
    },
    enabled: Boolean(instanceName) && enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "connected") return false;
      return 2500;
    },
  });
}
