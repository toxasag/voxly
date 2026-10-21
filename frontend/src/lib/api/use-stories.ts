"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export type StoryChannel = "telegram" | "max" | "whatsapp";
export type StoryMediaType = "photo" | "video";
export type StoryStatus = "draft" | "scheduled" | "published" | "failed";

export interface StoryPostDTO {
  id: string;
  tenantId: string;
  channelAccountId: string | null;
  channel: StoryChannel;
  mediaUrl: string;
  mediaType: StoryMediaType;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  viewsCount: number;
  reactionsCount: number;
  status: StoryStatus;
  scheduledAt: string | null;
  postedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStoryPayload {
  channelAccountId?: string | null;
  channel?: StoryChannel;
  mediaUrl: string;
  mediaType?: StoryMediaType;
  text?: string;
  linkUrl?: string | null;
  linkText?: string | null;
  scheduledAt?: string | null;
}

export const STORIES_QUERY_KEY = ["stories"] as const;

export function useStories(options?: {
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): UseQueryResult<{ items: StoryPostDTO[]; total: number }, ApiClientError> {
  const queryParams = new URLSearchParams();
  if (options?.channel) queryParams.set("channel", options.channel);
  if (options?.status) queryParams.set("status", options.status);
  if (options?.limit) queryParams.set("limit", String(options.limit));
  if (options?.offset) queryParams.set("offset", String(options.offset));
  const qs = queryParams.toString();

  return useQuery({
    queryKey: [...STORIES_QUERY_KEY, options],
    queryFn: async () => {
      const res = await apiClient.get<{ items: StoryPostDTO[]; total: number }>(
        `/stories${qs ? `?${qs}` : ""}`,
      );
      return res.data;
    },
  });
}

export function useCreateStory(): UseMutationResult<StoryPostDTO, ApiClientError, CreateStoryPayload> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<StoryPostDTO>("/stories", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORIES_QUERY_KEY });
    },
  });
}

export function usePublishStory(): UseMutationResult<StoryPostDTO, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<StoryPostDTO>(`/stories/${id}/publish`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORIES_QUERY_KEY });
    },
  });
}

export function useDeleteStory(): UseMutationResult<void, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete<void>(`/stories/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORIES_QUERY_KEY });
    },
  });
}
