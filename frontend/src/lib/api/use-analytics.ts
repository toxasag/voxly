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

export const DEFAULT_ANALYTICS_OVERVIEW: AnalyticsOverviewDTO = {
  kpis: {
    revenue: 0,
    revenue_change: 0,
    net_profit: 0,
    profit_change: 0,
    closed_repairs: 0,
    repairs_change: 0,
    avg_ticket: 0,
    ticket_change: 0,
  },
  pnl: [],
  funnel: [],
  top_repairs: [],
  master_load: [],
};

export const analyticsKeys = {
  overview: ["analytics", "overview"] as const,
};

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: analyticsKeys.overview,
    queryFn: async (): Promise<AnalyticsOverviewDTO> => {
      const res = await apiClient.get<AnalyticsOverviewDTO>("/api/v1/analytics/overview");
      const raw = res.data;
      if (!raw) return DEFAULT_ANALYTICS_OVERVIEW;

      return {
        kpis: {
          revenue: Number(raw.kpis?.revenue ?? 0),
          revenue_change: Number(raw.kpis?.revenue_change ?? 0),
          net_profit: Number(raw.kpis?.net_profit ?? 0),
          profit_change: Number(raw.kpis?.profit_change ?? 0),
          closed_repairs: Number(raw.kpis?.closed_repairs ?? 0),
          repairs_change: Number(raw.kpis?.repairs_change ?? 0),
          avg_ticket: Number(raw.kpis?.avg_ticket ?? 0),
          ticket_change: Number(raw.kpis?.ticket_change ?? 0),
        },
        pnl: Array.isArray(raw.pnl) ? raw.pnl : [],
        funnel: Array.isArray(raw.funnel) ? raw.funnel : [],
        top_repairs: Array.isArray(raw.top_repairs) ? raw.top_repairs : [],
        master_load: Array.isArray(raw.master_load) ? raw.master_load : [],
      };
    },
  });
}
