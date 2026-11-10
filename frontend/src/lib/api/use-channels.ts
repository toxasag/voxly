"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import type { ChannelStatus, CreateChannelAccountValues } from "@/schemas/channel.schema";
import type { ChannelSlug } from "@/types";

// Зеркалит backend/src/modules/channels/channels.types.ts.

export interface ChannelAccountLinksDTO {
  directUrl: string;
  trackingUrl: string;
  accountType: "bot" | "user_api" | "whatsapp" | "max" | "default";
  cleanIdentifier: string;
  defaultText?: string;
  startTag?: string;
  btnTag?: string;
}

export interface ChannelAccountDTO {
  id: string;
  channel: ChannelSlug;
  label: string;
  externalId: string;
  status: ChannelStatus;
  statusMessage: string;
  is_enabled?: boolean;
  isEnabled?: boolean;
  /** Признак заполненности авторизации: сами токены сервер не отдаёт. */
  hasCredentials: boolean;
  credentials?: Record<string, unknown>;
  /** Числовой id аккаунта на стороне канала; у Telegram — id пользователя. */
  remoteUserId: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
  createdAt: string;
  boundAgentId?: string | null;
  boundAgentName?: string | null;
  /** Сгенерированные прямые ссылки и трекинг сквозной аналитики */
  links?: ChannelAccountLinksDTO;
}

export interface ChannelSummaryDTO {
  channel: ChannelSlug;
  /** Сколько аккаунтов оплачено по тарифу. */
  quantity: number;
  connectedCount: number;
  total: number;
  trialEndsAt: string | null;
  trialActive: boolean;
  is_unlimited?: boolean;
  isUnlimited?: boolean;
}

export interface ChannelAccountsResult {
  items: ChannelAccountDTO[];
  summary: ChannelSummaryDTO;
}

const BASE_PATH = "/api/v1/channels";

export const channelKeys = {
  all: ["channels"] as const,
  accounts: (channel: ChannelSlug) => ["channels", channel, "accounts"] as const,
  summary: (channel: ChannelSlug) => ["channels", channel, "summary"] as const,
};

/**
 * Подключения канала и сводка по тарифу одним запросом.
 *
 * Сводка приходит в `meta`, а не отдельным эндпоинтом: шапка страницы и таблица
 * рендерятся вместе, и два запроса дали бы им разные моменты времени — счётчик
 * «2 из 3» расходился бы с числом строк.
 */
export function useChannelAccounts(
  channel: ChannelSlug,
): UseQueryResult<ChannelAccountsResult, ApiClientError> {
  return useQuery({
    queryKey: channelKeys.accounts(channel),
    queryFn: async () => {
      const res = await apiClient.get<ChannelAccountDTO[]>(`${BASE_PATH}/${channel}/accounts`);
      const summary = res.meta?.summary;

      return {
        items: res.data,
        // Нормализация на случай старого ответа без `meta.summary`: страница
        // должна отрендериться, а не упасть на чтении полей undefined.
        summary: isChannelSummary(summary)
          ? summary
          : {
              channel,
              quantity: res.data.length,
              connectedCount: res.data.filter((item) => item.status === "connected").length,
              total: res.data.length,
              trialEndsAt: null,
              trialActive: false,
            },
      };
    },
  });
}

function isChannelSummary(value: unknown): value is ChannelSummaryDTO {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.quantity === "number" && typeof candidate.total === "number";
}

export function useCreateChannelAccount(
  channel: ChannelSlug,
): UseMutationResult<ChannelAccountDTO, ApiClientError, CreateChannelAccountValues> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) =>
      (await apiClient.post<ChannelAccountDTO>(`${BASE_PATH}/${channel}/accounts`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts(channel) });
    },
  });
}

export interface UpdateChannelAccountPayload {
  id: string;
  label?: string;
  status?: ChannelStatus;
  status_message?: string;
  credentials?: Record<string, unknown>;
  agent_id?: string | null;
  is_enabled?: boolean;
}

export function useUpdateChannelAccount(
  channel: ChannelSlug,
): UseMutationResult<
  ChannelAccountDTO,
  ApiClientError,
  UpdateChannelAccountPayload
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }) =>
      (await apiClient.patch<ChannelAccountDTO>(`${BASE_PATH}/${channel}/accounts/${id}`, body))
        .data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts(channel) });
    },
  });
}

export function useToggleChannelAccount(
  channel: ChannelSlug,
): UseMutationResult<
  ChannelAccountDTO,
  ApiClientError,
  { id: string; currentStatus: ChannelStatus }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, currentStatus }) => {
      const nextStatus: ChannelStatus = currentStatus === "disabled" ? "connected" : "disabled";
      return (
        await apiClient.patch<ChannelAccountDTO>(`${BASE_PATH}/${channel}/accounts/${id}`, {
          status: nextStatus,
          is_enabled: nextStatus === "connected",
        })
      ).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts(channel) });
    },
  });
}

export function useDeleteChannelAccount(
  channel: ChannelSlug,
): UseMutationResult<void, ApiClientError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      await apiClient.delete<null>(`${BASE_PATH}/${channel}/accounts/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts(channel) });
    },
  });
}

export interface CloneChannelAccountPayload {
  id: string;
  external_id: string;
  label?: string;
  agent_id?: string | null;
}

/**
 * Клонирование (дублирование) подключения / онлайн-виджета.
 */
export function useCloneChannelAccount(channel: ChannelSlug) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CloneChannelAccountPayload) => {
      const { id, ...body } = payload;
      const res = await apiClient.post<ChannelAccountDTO>(
        `${BASE_PATH}/${channel}/accounts/${id}/clone`,
        body,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelKeys.accounts(channel) });
      queryClient.invalidateQueries({ queryKey: channelKeys.summary(channel) });
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      queryClient.invalidateQueries({ queryKey: ["quotas"] });
    },
  });
}

/** Подпись состояния соединения для интерфейса. */
export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  connected: "В сети",
  pending: "Требуется авторизация",
  error: "Ошибка соединения",
  disabled: "Отключён",
};

/** Склонение: 1 аккаунт, 2 аккаунта, 5 аккаунтов. */
export function pluralAccounts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "аккаунт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "аккаунта";
  return "аккаунтов";
}

/**
 * Хук получения и кастомизации ссылок подключения (Direct / Smart Tracking Links).
 */
export function useChannelAccountCustomLinks(
  channel: ChannelSlug,
  accountId: string | null,
  options?: { text?: string; startTag?: string; btn?: string },
): UseQueryResult<ChannelAccountLinksDTO, ApiClientError> {
  const queryParams = new URLSearchParams();
  if (options?.text) queryParams.set("text", options.text);
  if (options?.startTag) queryParams.set("startTag", options.startTag);
  if (options?.btn) queryParams.set("btn", options.btn);
  const qs = queryParams.toString();

  return useQuery({
    queryKey: ["channels", channel, "accounts", accountId, "links", qs],
    queryFn: async () => {
      const url = `${BASE_PATH}/${channel}/accounts/${accountId}/links${qs ? `?${qs}` : ""}`;
      const res = await apiClient.get<ChannelAccountLinksDTO>(url);
      return res.data;
    },
    enabled: Boolean(accountId),
  });
}
