"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

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
