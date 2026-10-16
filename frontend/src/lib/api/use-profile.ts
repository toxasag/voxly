"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { tenantUserKeys } from "@/lib/api/use-tenant-users";
import { teamKeys } from "@/lib/api/use-team";
import type { AuthChannel } from "@/lib/auth/use-auth";
import type { Role } from "@/types";

// Зеркалит backend/src/modules/profile/profile.service.ts.

export interface ChannelBindingDTO {
  channel: AuthChannel;
  linked: boolean;
  /** Идентификатор чата — показывается для сверки. */
  externalId: string | null;
  botUsername: string;
  /** Настроен ли транспорт на сервере; иначе привязка невозможна. */
  available: boolean;
}

export interface ProfileDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  createdAt: string;
  /** У приглашённого сотрудника пароля ещё нет — сменить его нельзя. */
  hasPassword: boolean;
  channels: ChannelBindingDTO[];
}

export interface UpdateProfilePayload {
  name?: string;
  phone?: string;
  /** `null` — снять аватар, строка — заменить, отсутствие — не менять. */
  avatar_url?: string | null;
}

export interface ChangePasswordPayload {
  current_password: string;
  password: string;
  /** Refresh-токен текущей сессии: она не будет отозвана. */
  keep_refresh_token?: string;
}

/** Ответ запроса привязки: ссылка на бота. */
export interface ChannelLinkDTO {
  session_id: string;
  channel: AuthChannel;
  delivered: boolean;
  deep_link: string | null;
  bot_username: string;
  expires_in_minutes: number;
}

export const profileKeys = { current: ["profile"] as const };

export const CHANNEL_LABELS: Record<AuthChannel, string> = {
  telegram: "Telegram",
  max: "MAX",
};

export function useProfile(): UseQueryResult<ProfileDTO, ApiClientError> {
  return useQuery({
    queryKey: profileKeys.current,
    queryFn: async () => (await apiClient.get<ProfileDTO>("/api/v1/profile")).data,
  });
}

/**
 * Профиль влияет на списки пользователей: имя и аватар показываются в таблице
 * сотрудников и в выпадающих списках исполнителей. Без этой инвалидации там
 * оставались бы прежние значения до перезагрузки.
 */
function useProfileInvalidation(): () => void {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: profileKeys.current });
    void queryClient.invalidateQueries({ queryKey: tenantUserKeys.all });
    void queryClient.invalidateQueries({ queryKey: teamKeys.list });
  };
}

export function useUpdateProfile(): UseMutationResult<
  ProfileDTO,
  ApiClientError,
  UpdateProfilePayload
> {
  const invalidate = useProfileInvalidation();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.patch<ProfileDTO>("/api/v1/profile", payload)).data,
    onSuccess: invalidate,
  });
}

export function useChangePassword(): UseMutationResult<
  { message: string },
  ApiClientError,
  ChangePasswordPayload
> {
  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<{ message: string }>("/api/v1/profile/password", payload)).data,
  });
}

/** Запрос ссылки на бота для привязки канала. */
export function useLinkChannel(): UseMutationResult<
  ChannelLinkDTO,
  ApiClientError,
  { channel: AuthChannel }
> {
  return useMutation({
    mutationFn: async ({ channel }) =>
      (await apiClient.post<ChannelLinkDTO>(`/api/v1/profile/channels/${channel}/link`, {})).data,
  });
}

/** Подтверждение привязки кодом из бота. */
export function useVerifyChannel(): UseMutationResult<
  ProfileDTO,
  ApiClientError,
  { session_id: string; code: string }
> {
  const invalidate = useProfileInvalidation();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<ProfileDTO>("/api/v1/profile/channels/verify", payload)).data,
    onSuccess: invalidate,
  });
}

export function useUnlinkChannel(): UseMutationResult<
  ProfileDTO,
  ApiClientError,
  { channel: AuthChannel }
> {
  const invalidate = useProfileInvalidation();

  return useMutation({
    mutationFn: async ({ channel }) =>
      (await apiClient.delete<ProfileDTO>(`/api/v1/profile/channels/${channel}`)).data,
    onSuccess: invalidate,
  });
}

/** Опрос доставки кода после открытия бота. */
export async function fetchChannelStatus(
  sessionId: string,
): Promise<{ delivered: boolean; verified: boolean; expired: boolean }> {
  const res = await apiClient.get<{ delivered: boolean; verified: boolean; expired: boolean }>(
    `/api/v1/profile/channels/status?session_id=${encodeURIComponent(sessionId)}`,
  );
  return res.data;
}
