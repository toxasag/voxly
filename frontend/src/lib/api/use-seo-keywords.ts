"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";
import type {
  KeywordSearchResponse,
  RecentSearchItem,
  SearchTrendPoint,
  SerpOrganicResult,
} from "@/types/seo.types";

export const seoKeys = {
  all: ["marketing", "seo"] as const,
  keywords: (query: string, country?: string, location?: string) =>
    [...seoKeys.all, "keywords", query, country, location] as const,
  trends: (query: string, country?: string, location?: string) =>
    [...seoKeys.all, "trends", query, country, location] as const,
  serp: (query: string, country?: string, location?: string) =>
    [...seoKeys.all, "serp", query, country, location] as const,
  recent: () => [...seoKeys.all, "recent"] as const,
};

export interface SearchKeywordParams {
  query: string;
  country?: string;
  location?: string;
  currency?: string;
}

export function useKeywordSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SearchKeywordParams) => {
      const res = await apiClient.post<KeywordSearchResponse>(
        "/api/v1/marketing/seo/keywords/search",
        params,
      );
      return res.data;
    },
    onSuccess: (data, variables) => {
      // Кэшируем результат в React Query
      queryClient.setQueryData(
        seoKeys.keywords(variables.query, variables.country, variables.location),
        data,
      );
      // Инвалидируем недавние поиски, чтобы обновить ленту табов
      void queryClient.invalidateQueries({ queryKey: seoKeys.recent() });
    },
  });
}

export function useRecentSearches() {
  return useQuery({
    queryKey: seoKeys.recent(),
    queryFn: async () => {
      const res = await apiClient.get<RecentSearchItem[]>(
        "/api/v1/marketing/seo/recent-searches",
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useDeleteRecentSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ success: boolean }>(
        `/api/v1/marketing/seo/recent-searches/${id}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seoKeys.recent() });
    },
  });
}

export function useKeywordTrends(query: string, country?: string, location?: string) {
  return useQuery({
    queryKey: seoKeys.trends(query, country, location),
    queryFn: async () => {
      const res = await apiClient.get<SearchTrendPoint[]>(
        "/api/v1/marketing/seo/keywords/trends",
        { query: { q: query, country, location } },
      );
      return res.data;
    },
    enabled: Boolean(query.trim()),
    staleTime: 300_000,
  });
}

export function useKeywordSerp(query: string, country?: string, location?: string) {
  return useQuery({
    queryKey: seoKeys.serp(query, country, location),
    queryFn: async () => {
      const res = await apiClient.get<SerpOrganicResult[]>(
        "/api/v1/marketing/seo/keywords/serp",
        { query: { q: query, country, location } },
      );
      return res.data;
    },
    enabled: Boolean(query.trim()),
    staleTime: 300_000,
  });
}
