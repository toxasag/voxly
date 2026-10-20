export interface MonthlyPnLDTO {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface FunnelStepDTO {
  name: string;
  count: number;
  percentage: number;
}

export interface TopRepairDefectDTO {
  name: string;
  count: number;
  avg_cost: number;
}

export interface MasterLoadDTO {
  name: string;
  active: number;
  completed: number;
}

export interface AnalyticsKpiDTO {
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
  kpis: AnalyticsKpiDTO;
  pnl: MonthlyPnLDTO[];
  funnel: FunnelStepDTO[];
  top_repairs: TopRepairDefectDTO[];
  master_load: MasterLoadDTO[];
}
