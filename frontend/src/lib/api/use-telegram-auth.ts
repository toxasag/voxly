"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { channelKeys } from "@/lib/api/use-channels";
import type { TelegramSendCodeValues } from "@/schemas/channel.schema";

// Зеркалит backend/src/modules/channels/telegram-auth.types.ts.

const BASE_PATH = "/api/v1/integrations/telegram";

export interface TelegramSendCodeResult {
  tempSessionId: string;
  phoneCodeHash: string;
  /** Код пришёл в приложение Telegram, а не по SMS — меняет текст подсказки. */
  isCodeViaApp: boolean;
  expiresAt: string;
}

/**
 * Результат второго шага.
 *
 * Дискриминированное объединение по `status`: при запросе пароля никакого
 * `accountId` ещё нет, и необязательное поле в общем типе позволяло бы его
 * прочитать.
 */
export type TelegramSignInResult =
  | {
      status: "password_required";
      requires2FA: true;
      passwordHint: string | null;
      message: string;
    }
  | {
      status: "connected";
      requires2FA: false;
      accountId: string;
    };

export function useTelegramSendCode(): UseMutationResult<
  TelegramSendCodeResult,
  ApiClientError,
  TelegramSendCodeValues
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<TelegramSendCodeResult>(`${BASE_PATH}/auth/send-code`, payload)).data,
  });
}

export interface TelegramSignInInput {
  tempSessionId: string;
  code?: string;
  password?: string;
}

export function useTelegramSignIn(): UseMutationResult<
  TelegramSignInResult,
  ApiClientError,
  TelegramSignInInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<TelegramSignInResult>(`${BASE_PATH}/auth/sign-in`, payload)).data,
    onSuccess: (result) => {
      // Список обновляется только после фактического подключения: на шаге
      // пароля аккаунта ещё нет, и лишний запрос вернул бы прежний список.
      if (result.status === "connected") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram") });
      }
    },
  });
}

/** Проверка живости сохранённой сессии: пользователь мог отозвать её в Telegram. */
export function useTelegramCheckAccount(): UseMutationResult<
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
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram") });
    },
  });
}

export interface TelegramStartQrResult {
  tempSessionId: string;
  qr: string;
  expires: number;
}

export type TelegramQrStatusResult =
  | {
      status: "waiting";
      qr?: string;
      expires?: number;
    }
  | {
      status: "requires_2fa";
      passwordHint: string | null;
    }
  | {
      status: "connected";
      accountId: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        username: string | null;
        phone: string | null;
      };
    };

export function useTelegramStartQr(): UseMutationResult<
  TelegramStartQrResult,
  ApiClientError,
  { name?: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<TelegramStartQrResult>(`${BASE_PATH}/auth/qr/start`, payload ?? {})).data,
  });
}

export function useTelegramQrStatus(
  tempSessionId: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["telegram", "qr-status", tempSessionId],
    queryFn: async () => {
      if (!tempSessionId) return null;
      const res = await apiClient.get<TelegramQrStatusResult>(
        `${BASE_PATH}/auth/qr/status?tempSessionId=${encodeURIComponent(tempSessionId)}`,
      );
      if (res.data?.status === "connected") {
        void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram") });
      }
      return res.data;
    },
    enabled: Boolean(tempSessionId) && enabled,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const data = query.state.data;
      if (data?.status === "connected") return false;
      return 2000;
    },
  });
}

export function useTelegramQrPassword(): UseMutationResult<
  { status: "connected"; accountId: string },
  ApiClientError,
  { tempSessionId: string; password: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<{ status: "connected"; accountId: string }>(`${BASE_PATH}/auth/qr/password`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram") });
    },
  });
}
