"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";
import type {
  MonthlyPnL,
  FunnelStep,
  TopRepairDefect,
  MasterLoad,
} from "@/lib/analytics/analytics.types";

export interface AnalyticsKpi {
  revenue: number;
  revenueChange: number;
  netProfit: number;
  profitChange: number;
  closedRepairs: number;
  repairsChange: number;
  avgTicket: number;
  ticketChange: number;
}

export interface AnalyticsOverviewDTO {
  kpis: {
    revenue: number;
    revenue_change: number;
    net_profit: number;
    profit_change: number;
    closed_repairs: number;
    repairs_change: number;
    avg_ticket: number;
    ticket_change: number;
  };
  pnl: MonthlyPnL[];
  funnel: FunnelStep[];
  top_repairs: TopRepairDefect[];
  master_load: MasterLoad[];
}

export const analyticsKeys = {
  overview: ["analytics", "overview"] as const,
};

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: analyticsKeys.overview,
    queryFn: async (): Promise<AnalyticsOverviewDTO> => {
      const res = await apiClient.get<{ data: AnalyticsOverviewDTO }>("/api/v1/analytics/overview");
      return res.data.data;
    },
  });
}
