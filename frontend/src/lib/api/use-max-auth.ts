"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { channelKeys } from "@/lib/api/use-channels";

const BASE_PATH = "/api/v1/integrations/max";

export type MaxProviderType = "max-bridge" | "native-ts";

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

export interface MaxSessionRecord {
  id: number | string;
  deviceId?: string;
  current?: boolean;
  userAgent?: string;
  appVersion?: string;
  deviceName?: string;
  deviceType?: string;
  platform?: string;
  ip?: string;
  location?: string;
  created?: number;
  updated?: number;
  lastActivity?: number;
}

export interface MaxSessionsListResult {
  provider: MaxProviderType;
  sessions: MaxSessionRecord[];
  unsupportedReason?: string;
}

export interface MaxPhoneStartResult {
  authSessionId: string;
  codeLength: number;
  requestMaxDuration: number;
  altActionDuration: number;
  hasCallTrack: boolean;
}

export interface MaxPhoneVerifyResult {
  status: "authorized" | "waiting_password" | "waiting_call";
  botId?: string;
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
  { name: string; botId?: string; provider?: MaxProviderType }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxStartQrResult>(`${BASE_PATH}/auth/qr/start`, payload)).data,
  });
}

export function useMaxQrStatus(
  name: string | null,
  enabled: boolean,
  botId?: string,
  provider?: MaxProviderType,
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["max", "qr-status", botId ?? null, provider ?? null, name],
    queryFn: async () => {
      if (!name) return null;
      const botParam = botId ? `&botId=${encodeURIComponent(botId)}` : "";
      const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : "";
      const res = await apiClient.get<MaxStatusResult>(
        `${BASE_PATH}/auth/qr/status?name=${encodeURIComponent(name)}${botParam}${providerParam}`,
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
  { name: string; password: string; botId?: string; provider?: MaxProviderType }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<{ ok: boolean; status: string }>(`${BASE_PATH}/auth/qr/password`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
    },
  });
}

export function useMaxPhoneStart(): UseMutationResult<
  MaxPhoneStartResult,
  ApiClientError,
  { phone: string; name: string; botId?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxPhoneStartResult>(`${BASE_PATH}/auth/phone/start`, payload)).data,
  });
}

export function useMaxPhoneVerify(): UseMutationResult<
  MaxPhoneVerifyResult,
  ApiClientError,
  { authSessionId: string; code: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxPhoneVerifyResult>(`${BASE_PATH}/auth/phone/verify`, payload)).data,
    onSuccess: (res) => {
      if (res.status === "authorized") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
        void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
      }
    },
  });
}

export function useMaxPhoneCallCheck(): UseMutationResult<
  MaxPhoneVerifyResult,
  ApiClientError,
  { authSessionId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxPhoneVerifyResult>(`${BASE_PATH}/auth/phone/call-check`, payload)).data,
    onSuccess: (res) => {
      if (res.status === "authorized") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
        void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
      }
    },
  });
}

export function useMaxPhonePassword(): UseMutationResult<
  MaxPhoneVerifyResult,
  ApiClientError,
  { authSessionId: string; password: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<MaxPhoneVerifyResult>(`${BASE_PATH}/auth/phone/password`, payload)).data,
    onSuccess: (res) => {
      if (res.status === "authorized") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
        void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
      }
    },
  });
}

/** Проверка живости сохранённой сессии MAX (с восстановлением при необходимости). */
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

/** Активные устройства/сессии MAX (opcode 96 для native-ts). */
export function useMaxSessions(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["max", "sessions", id],
    queryFn: async () => {
      if (!id) return null;
      return (await apiClient.get<MaxSessionsListResult>(`${BASE_PATH}/accounts/${id}/sessions`)).data;
    },
    enabled: Boolean(id) && enabled,
  });
}

/** Завершить все другие активные сессии MAX, кроме текущей (opcode 97). */
export function useMaxCloseOtherSessions(): UseMutationResult<
  { ok: boolean; closed: boolean },
  ApiClientError,
  { id: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) =>
      (await apiClient.post<{ ok: boolean; closed: boolean }>(`${BASE_PATH}/accounts/${id}/sessions/close-others`, {}))
        .data,
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["max", "sessions", vars.id] });
    },
  });
}

/** Безопасное переключение транспорта MAX аккаунта между native-ts и max-bridge без потери токена. */
export function useMaxSwitchProvider(): UseMutationResult<
  { ok: boolean; provider: MaxProviderType; connected?: boolean },
  ApiClientError,
  { id: string; provider: MaxProviderType }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, provider }) =>
      (
        await apiClient.post<{ ok: boolean; provider: MaxProviderType; connected?: boolean }>(
          `${BASE_PATH}/accounts/${id}/provider`,
          { provider },
        )
      ).data,
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("max") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("max") });
      void queryClient.invalidateQueries({ queryKey: ["max", "sessions", vars.id] });
    },
  });
}
