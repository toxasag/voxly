"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export type NotificationChannelType = "email" | "telegram" | "whatsapp" | "bitrix24";

export interface NotificationChannelDTO {
  id: string;
  tenant_id: string;
  channel_type: NotificationChannelType;
  destination: string;
  target_value: string;
  extra_meta: Record<string, unknown>;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreateNotificationChannelPayload {
  channel_type: NotificationChannelType;
  destination?: string;
  target_value?: string;
  extra_meta?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateNotificationChannelPayload {
  id: string;
  destination?: string;
  target_value?: string;
  extra_meta?: Record<string, unknown>;
  is_active?: boolean;
}

export interface TelegramBindLinkDTO {
  ok: boolean;
  deep_link: string;
  bot_username: string;
}

export const notificationChannelKeys = {
  all: ["settings", "notifications"] as const,
  list: () => [...notificationChannelKeys.all, "list"] as const,
  bindLink: () => [...notificationChannelKeys.all, "telegram-bind-link"] as const,
};

export function useNotificationChannels(): UseQueryResult<NotificationChannelDTO[], ApiClientError> {
  return useQuery({
    queryKey: notificationChannelKeys.list(),
    queryFn: async (): Promise<NotificationChannelDTO[]> => {
      const res = await apiClient.get<NotificationChannelDTO[]>("/api/v1/settings/notifications");
      return res.data;
    },
  });
}

export function useTelegramBindLink(): UseQueryResult<TelegramBindLinkDTO, ApiClientError> {
  return useQuery({
    queryKey: notificationChannelKeys.bindLink(),
    queryFn: async (): Promise<TelegramBindLinkDTO> => {
      const res = await apiClient.get<TelegramBindLinkDTO>(
        "/api/v1/settings/notifications/telegram/bind-link",
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useCreateNotificationChannel(): UseMutationResult<
  NotificationChannelDTO,
  ApiClientError,
  CreateNotificationChannelPayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateNotificationChannelPayload): Promise<NotificationChannelDTO> => {
      const res = await apiClient.post<NotificationChannelDTO>(
        "/api/v1/settings/notifications",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationChannelKeys.list() });
    },
  });
}

export function useUpdateNotificationChannel(): UseMutationResult<
  NotificationChannelDTO,
  ApiClientError,
  UpdateNotificationChannelPayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateNotificationChannelPayload): Promise<NotificationChannelDTO> => {
      const res = await apiClient.put<NotificationChannelDTO>(
        `/api/v1/settings/notifications/${id}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationChannelKeys.list() });
    },
  });
}

export function useDeleteNotificationChannel(): UseMutationResult<
  boolean,
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelId: string): Promise<boolean> => {
      const res = await apiClient.delete<{ ok: boolean }>(
        `/api/v1/settings/notifications/${channelId}`,
      );
      return res.data.ok;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationChannelKeys.list() });
    },
  });
}

export function useToggleNotificationChannel(): UseMutationResult<
  NotificationChannelDTO,
  ApiClientError,
  { id: string; isActive: boolean }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, isActive }): Promise<NotificationChannelDTO> => {
      const res = await apiClient.patch<NotificationChannelDTO>(
        `/api/v1/settings/notifications/${id}`,
        { is_active: isActive },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationChannelKeys.list() });
    },
  });
}

export function useSendTestNotification(): UseMutationResult<
  { ok: boolean; delivered: boolean; message: string },
  ApiClientError,
  { id?: string; channel_type?: NotificationChannelType; destination?: string }
> {
  return useMutation({
    mutationFn: async (payload): Promise<{ ok: boolean; delivered: boolean; message: string }> => {
      const res = await apiClient.post<{ ok: boolean; delivered: boolean; message: string }>(
        "/api/v1/settings/notifications/test",
        payload,
      );
      return res.data;
    },
  });
}
