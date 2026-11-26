"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { channelKeys } from "@/lib/api/use-channels";

const BASE_PATH = "/api/v1/integrations/max";

export interface MaxStartQrResult {
  ok: boolean;
  status: string;
  name: string;
  botId?: string | null;
  qr?: string | null;
}

export interface MaxStatusResult {
  ok: boolean;
  status: "preparing" | "qr_ready" | "authorized" | "waiting_password" | "processing_password" | "error" | "unknown";
  botId?: string;
  qr?: string | null;
  qrExpiresAt?: number | null;
  error?: string | null;
  passwordHint?: string | null;
  user?: {
    id: string;
    username?: string;
    firstName?: string;
  } | null;
}

export function useMaxStartQr(): UseMutationResult<
  MaxStartQrResult,
  ApiClientError,
  { name: string; botId?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxStartQrResult>(`${BASE_PATH}/auth/qr/start`, payload)).data,
  });
}

export function useMaxQrStatus(name: string | null, enabled: boolean, botId?: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["max", "qr-status", botId ?? null, name],
    queryFn: async () => {
      if (!name) return null;
      const botParam = botId ? `&botId=${encodeURIComponent(botId)}` : "";
      const res = await apiClient.get<MaxStatusResult>(
        `${BASE_PATH}/auth/qr/status?name=${encodeURIComponent(name)}${botParam}`,
      );
      if (res.data?.status === "authorized") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
        void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
      }
      return res.data;
    },
    enabled: Boolean(name) && enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "authorized") return false;
      return 2500;
    },
  });
}

export function useMaxPassword(): UseMutationResult<
  { ok: boolean; status: string },
  ApiClientError,
  { name: string; password: string; botId?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<{ ok: boolean; status: string }>(`${BASE_PATH}/auth/qr/password`, payload)).data,
  });
}

/** Проверка живости сохранённой сессии MAX (с восстановлением в max-bridge при необходимости). */
export function useMaxCheckAccount(): UseMutationResult<
  { alive: boolean; reason?: string },
  ApiClientError,
  { id: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) =>
      (await apiClient.post<{ alive: boolean; reason?: string }>(`${BASE_PATH}/accounts/${id}/check`, {}))
        .data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
    },
  });
}
