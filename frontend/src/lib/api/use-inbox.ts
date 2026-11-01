"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export interface InboxThreadDTO {
  id: string;
  dealId: string;
  dealTitle: string;
  dealBudget: number;
  stageName: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  telegramUsername: string;
  channel: string;
  lastMessage: string;
  lastMessageAt: string;
  lastSenderName: string;
  lastDirection: "inbound" | "outbound" | "neutral";
  unreadCount: number;
}

export interface InboxQueryParams {
  channel?: string;
  unread_only?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export const inboxKeys = {
  all: ["inbox"] as const,
  threads: (params?: InboxQueryParams) => ["inbox", "threads", params] as const,
};

export function useInboxThreads(
  params?: InboxQueryParams,
  options?: { refetchInterval?: number | false },
): UseQueryResult<InboxThreadDTO[], ApiClientError> {
  const channel = params?.channel && params.channel !== "all" ? params.channel : undefined;
  const unread_only = params?.unread_only ? true : undefined;
  const search = params?.search?.trim() ? params.search.trim() : undefined;

  return useQuery({
    queryKey: inboxKeys.threads({ channel, unread_only, search }),
    queryFn: async () => {
      const res = await apiClient.get<InboxThreadDTO[]>("/api/v1/crm/inbox/threads", {
        query: {
          channel,
          unread_only: unread_only ? "true" : undefined,
          search,
          limit: params?.limit ?? 50,
          offset: params?.offset ?? 0,
        },
      });
      return res.data;
    },
    refetchInterval: options?.refetchInterval ?? 5000,
  });
}
