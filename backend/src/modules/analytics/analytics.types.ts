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

export const ANALYTICS_PROVIDERS = [
  "yandex",
  "ga4",
  "google_ads",
  "meta",
  "vk",
  "yandex_metrika",
  "google_analytics_4",
  "meta_pixel",
  "vk_ads",
] as const;

export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export type CanonicalAnalyticsProvider = "yandex" | "ga4" | "google_ads" | "meta" | "vk";

export function normalizeAnalyticsProvider(provider: string): CanonicalAnalyticsProvider {
  switch (provider) {
    case "yandex_metrika":
    case "yandex":
      return "yandex";
    case "google_analytics_4":
    case "ga4":
      return "ga4";
    case "meta_pixel":
    case "meta":
      return "meta";
    case "vk_ads":
    case "vk":
      return "vk";
    case "google_ads":
    default:
      return "google_ads";
  }
}

export interface AnalyticsEventRules {
  onLeadCreated?: boolean;
  onDealWon?: boolean;
  onFirstMessage?: boolean;
  stageIds?: string[];
}

export interface AnalyticsIntegrationRow {
  id: string;
  tenant_id: string;
  provider: AnalyticsProvider;
  site_name: string;
  name?: string | null;
  site_url: string | null;
  counter_id: string | null;
  channel_account_id: string | null;
  is_default: boolean;
  config: Record<string, unknown>;
  event_rules?: AnalyticsEventRules | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AnalyticsIntegrationDTO {
  id: string;
  provider: AnalyticsProvider;
  canonicalProvider: CanonicalAnalyticsProvider;
  name: string;
  siteName: string;
  siteUrl: string | null;
  counterId: string | null;
  channelAccountId: string | null;
  isDefault: boolean;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  eventRules: AnalyticsEventRules;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalyticsIntegrationPayload {
  provider: AnalyticsProvider;
  name?: string;
  siteName?: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  eventRules?: AnalyticsEventRules;
}

export interface UpdateAnalyticsIntegrationPayload {
  name?: string;
  siteName?: string;
  siteUrl?: string | null;
  counterId?: string | null;
  channelAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  eventRules?: AnalyticsEventRules;
}

export interface ConversionEventPayload {
  tenantId: string;
  dealId?: string | null;
  dealTitle?: string;
  stageId?: string;
  stageName?: string;
  isWon?: boolean;
  isLost?: boolean;
  budget?: number;
  currency?: string;
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
  isTest?: boolean;
  jobId?: string | null;
  channelAccountId?: string | null;
  sourceUrl?: string | null;
}

export interface ConversionResult {
  provider: AnalyticsProvider;
  success: boolean;
  eventName: string;
  status: number;
  responseSnippet?: string;
  error?: string;
}

export interface ConversionDeliveryAttemptRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  provider: AnalyticsProvider;
  event_key: string;
  event_name: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  response_snippet: string | null;
  delivered_at: Date | string | null;
  locked_until: Date | string | null;
  is_test?: boolean;
  job_id?: string | null;
}

// ---------------------------------------------------------------------------
// Сквозная атрибуция и клик-сессии мессенджеров
// ---------------------------------------------------------------------------

export type MessengerType = "telegram" | "whatsapp" | "vk" | "max" | "webchat";
export type AttributionStatus = "clicked" | "opened" | "first_message_received" | "channel_subscribed";

export interface AnalyticsSessionDTO {
  id: string;
  sessionToken: string;
  gaClientId?: string | null;
  ymClientId?: string | null;
  yandexuid?: string | null;
  gclid?: string | null;
  yclid?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
  referrer?: string | null;
  pageUrl?: string | null;
  channelAccountId?: string | null;
  messengerType: MessengerType;
  messengerUserId?: string | null;
  status: AttributionStatus;
  createdAt: string;
  firstMessageAt?: string | null;
}

export interface CreateAnalyticsClickPayload {
  messenger: MessengerType;
  channelAccountId?: string | null;
  gaClientId?: string | null;
  ymClientId?: string | null;
  yandexuid?: string | null;
  gclid?: string | null;
  yclid?: string | null;
  fbclid?: string | null;
  vkclid?: string | null;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  referrer?: string;
  pageUrl?: string;
}

export interface CreateAnalyticsClickResult {
  sessionToken: string;
  deepLink: string;
}

export interface TestQueueResult {
  jobId: string;
  provider: AnalyticsProvider;
  status: "enqueued" | "failed";
  message: string;
}

export interface TestQueueStatus {
  jobId: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  deliveredAt: string | null;
}
