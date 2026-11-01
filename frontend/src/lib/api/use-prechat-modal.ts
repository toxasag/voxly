"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export type PreChatABMode = "split_50_50" | "always_modal" | "always_direct";

export interface PreChatModalConfigDTO {
  id?: string;
  isEnabled: boolean;
  abMode: PreChatABMode;
  greetingTemplate: string;
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  whatsappNumber: string | null;
  telegramUsername: string | null;
}

export interface PreChatABStatsDTO {
  direct: {
    impressions: number;
    clicks: number;
    chatsStarted: number;
    conversionRate: number;
  };
  modal: {
    impressions: number;
    modalOpens: number;
    submits: number;
    chatsStarted: number;
    conversionRate: number;
  };
  summary: {
    totalImpressions: number;
    totalChats: number;
    winnerVariant: "modal" | "direct" | "insufficient_data";
    conversionLift: number;
  };
}

export const preChatModalKeys = {
  config: ["analytics", "preChatConfig"] as const,
  stats: ["analytics", "preChatStats"] as const,
};

export function usePreChatConfig() {
  return useQuery({
    queryKey: preChatModalKeys.config,
    queryFn: async (): Promise<PreChatModalConfigDTO> => {
      const res = await apiClient.get<PreChatModalConfigDTO>("/api/v1/analytics/pre-chat-config");
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useUpdatePreChatConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<PreChatModalConfigDTO>): Promise<PreChatModalConfigDTO> => {
      const res = await apiClient.put<PreChatModalConfigDTO>(
        "/api/v1/analytics/pre-chat-config",
        payload,
      );
      return res.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(preChatModalKeys.config, updated);
      void queryClient.invalidateQueries({ queryKey: preChatModalKeys.config });
    },
  });
}

export function usePreChatStats() {
  return useQuery({
    queryKey: preChatModalKeys.stats,
    queryFn: async (): Promise<PreChatABStatsDTO> => {
      const res = await apiClient.get<PreChatABStatsDTO>("/api/v1/analytics/pre-chat-stats");
      return res.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
