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

// ---------------------------------------------------------------------------
// Серверные конверсии и трекеры (Server-Side Conversion Tracking)
// ---------------------------------------------------------------------------

export const ANALYTICS_PROVIDERS = ["yandex", "ga4", "google_ads", "meta", "vk"] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export interface AnalyticsIntegrationRow {
  id: string;
  tenant_id: string;
  provider: AnalyticsProvider;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AnalyticsIntegrationDTO {
  id: string;
  provider: AnalyticsProvider;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAnalyticsIntegrationPayload {
  isActive?: boolean;
  config: Record<string, unknown>;
}

export interface ConversionEventPayload {
  tenantId: string;
  dealId: string;
  dealTitle: string;
  stageId: string;
  stageName: string;
  isWon: boolean;
  isLost: boolean;
  budget: number;
  currency: string;
  contactId?: string | null;
  clientId?: string | null;
  ymUid?: string | null;
  yandexuid?: string | null;
  gaId?: string | null;
  fbId?: string | null;
  tmrLvid?: string | null;
  email?: string | null;
  phone?: string | null;
  eventName: string;
  timestamp?: string;
}

export interface ConversionResult {
  provider: AnalyticsProvider;
  success: boolean;
  eventName: string;
  status: number;
  responseSnippet?: string;
  error?: string;
}
