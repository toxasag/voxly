"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { channelKeys, type ChannelAccountDTO } from "@/lib/api/use-channels";
import type {
  CompleteManagedTelegramBotValues,
  ConnectTelegramBotValues,
  CreateManagedTelegramBotValues,
} from "@/schemas/channel.schema";

const BASE_PATH = "/api/v1/integrations/telegram-bot";

export interface TelegramBotInfoDTO {
  id: number;
  isBot: boolean;
  firstName: string;
  username: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
  supportsInlineQueries?: boolean;
}

export interface TelegramBotManagerInfoDTO {
  configured: boolean;
  managerUsername: string;
  deepLinkTemplate: string;
  features: {
    managedBots: boolean;
    directCreation: boolean;
    tokenRotation: boolean;
  };
}

export interface TelegramBotCreateManagedResultDTO {
  account: ChannelAccountDTO;
  deepLink: string;
  isPending: boolean;
  message: string;
}

/** Информация о платформенном Bot Manager. */
export function useTelegramBotManagerInfo(): UseQueryResult<TelegramBotManagerInfoDTO, ApiClientError> {
  return useQuery({
    queryKey: ["telegram-bot", "manager-info"],
    queryFn: async () => (await apiClient.get<TelegramBotManagerInfoDTO>(`${BASE_PATH}/manager-info`)).data,
    staleTime: 60_000,
  });
}

/** Быстрая проверка токена бота без создания записи в базе. */
export function useVerifyTelegramBotToken(): UseMutationResult<
  TelegramBotInfoDTO,
  ApiClientError,
  { token: string }
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<TelegramBotInfoDTO>(`${BASE_PATH}/verify`, payload)).data,
  });
}

/** Подключение существующего бота по токену @BotFather. */
export function useConnectTelegramBot(): UseMutationResult<
  ChannelAccountDTO,
  ApiClientError,
  ConnectTelegramBotValues
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<ChannelAccountDTO>(`${BASE_PATH}/connect`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram_bot") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("telegram_bot") });
    },
  });
}

/** Создание нового бота через Telegram Bot Manager (Managed Bots). */
export function useCreateManagedTelegramBot(): UseMutationResult<
  TelegramBotCreateManagedResultDTO,
  ApiClientError,
  CreateManagedTelegramBotValues
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<TelegramBotCreateManagedResultDTO>(`${BASE_PATH}/create-managed`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram_bot") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("telegram_bot") });
    },
  });
}

/** Завершение привязки токена для бота в статусе pending. */
export function useCompleteManagedTelegramBot(): UseMutationResult<
  ChannelAccountDTO,
  ApiClientError,
  { accountId: string; values: CompleteManagedTelegramBotValues }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, values }) =>
      (await apiClient.post<ChannelAccountDTO>(`${BASE_PATH}/accounts/${accountId}/complete`, values)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("telegram_bot") });
      void queryClient.invalidateQueries({ queryKey: channelKeys.summary("telegram_bot") });
    },
  });
}
