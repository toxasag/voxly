// Типы данных аналитики — зеркалят backend/src/modules/analytics/analytics.types.ts

export interface MonthlyPnL {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface FunnelStep {
  name: string;
  count: number;
  percentage: number;
}

export interface TopRepairDefect {
  name: string;
  count: number;
  avg_cost: number;
}

export interface MasterLoad {
  name: string;
  active: number;
  completed: number;
}

export interface AnalyticsKPI {
  revenue: number;
  revenue_change: number;
  net_profit: number;
  profit_change: number;
  closed_repairs: number;
  repairs_change: number;
  avg_ticket: number;
  ticket_change: number;
}

export interface AnalyticsOverviewDTO {
  kpis: AnalyticsKPI;
  pnl: MonthlyPnL[];
  funnel: FunnelStep[];
  top_repairs: TopRepairDefect[];
  master_load: MasterLoad[];
}
