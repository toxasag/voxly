"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export type WidgetFunnelPeriod = "today" | "7d" | "30d" | "all" | "custom";

export interface WidgetFunnelStageDTO {
  key: "visit" | "open" | "chat" | "lead" | "won";
  label: string;
  count: number;
  conversionRateToPrevious: number; // % от предыдущего шага
  conversionRateToFirst: number; // % сквозной конверсии от посетителей
  dropOffCount: number;
  dropOffRate: number; // % отвала
}

export interface WidgetDailyDynamicDTO {
  date: string; // YYYY-MM-DD
  visitors: number;
  opens: number;
  chats: number;
  leads: number;
  won: number;
  revenue: number;
}

export interface WidgetFunnelStatsDTO {
  widgetId: string;
  widgetLabel: string;
  siteDomain: string;
  period: string;
  startDate: string;
  endDate: string;
  stages: WidgetFunnelStageDTO[];
  summary: {
    totalVisitors: number;
    totalOpens: number;
    totalChats: number;
    totalLeads: number;
    totalWonDeals: number;
    totalWonRevenue: number;
    overallConversionRate: number;
  };
  daily: WidgetDailyDynamicDTO[];
}

export interface WidgetAnalyticsOptions {
  period?: WidgetFunnelPeriod;
  from?: string;
  to?: string;
  enabled?: boolean;
}

export function useWidgetAnalytics(
  widgetId: string | null,
  options: WidgetAnalyticsOptions = {},
): UseQueryResult<WidgetFunnelStatsDTO, ApiClientError> {
  const { period = "30d", from, to, enabled = true } = options;

  return useQuery({
    queryKey: ["channels", "webchat", "stats", widgetId, period, from, to] as const,
    queryFn: async () => {
      if (!widgetId) throw new Error("widgetId is required");
      const params = new URLSearchParams();
      params.set("period", period);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await apiClient.get<WidgetFunnelStatsDTO>(
        `/api/v1/channels/webchat/accounts/${widgetId}/stats?${params.toString()}`,
      );
      return res.data;
    },
    enabled: Boolean(widgetId) && enabled,
    staleTime: 30 * 1000,
  });
}
