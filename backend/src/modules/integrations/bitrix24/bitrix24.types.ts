// ---------------------------------------------------------------------------
// Типы и интерфейсы модуля интеграции с Битрикс24 (исходящие лиды / crm.lead.add).
// ---------------------------------------------------------------------------

export const LEAD_SOURCES = [
  "whatsapp",
  "max",
  "telegram_personal",
  "telegram_bot",
  "site_widget",
  "manual",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface Bitrix24ConfigRow {
  tenant_id: string;
  webhook_url: string;
  is_enabled: boolean;
  allowed_sources: string[] | null;
  selected_widget_ids: string[] | null;
  custom_source_id: string | null;
  send_utm_marks: boolean | null;
  send_geo_data: boolean | null;
  last_lead_id: string | null;
  last_sync_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Bitrix24ConfigDTO {
  webhook_url: string;
  is_enabled: boolean;
  allowed_sources: LeadSource[];
  selected_widget_ids: string[];
  custom_source_id: string;
  send_utm_marks: boolean;
  send_geo_data: boolean;
  last_lead_id: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface UpdateBitrix24ConfigPayload {
  webhook_url?: string;
  is_enabled?: boolean;
  allowed_sources?: (LeadSource | string)[];
  selected_widget_ids?: string[];
  custom_source_id?: string;
  send_utm_marks?: boolean;
  send_geo_data?: boolean;
}

export interface SimpleWidgetDTO {
  id: string;
  name: string;
  site_domain: string;
  status: string;
  created_at?: string;
}

export interface Bitrix24PhoneEntry {
  VALUE: string;
  VALUE_TYPE: "WORK" | "MOBILE" | "OTHER";
}

export interface Bitrix24EmailEntry {
  VALUE: string;
  VALUE_TYPE: "WORK" | "HOME" | "OTHER";
}

export interface Bitrix24LeadFields {
  TITLE: string;
  NAME?: string;
  LAST_NAME?: string;
  PHONE?: Bitrix24PhoneEntry[];
  EMAIL?: Bitrix24EmailEntry[];
  SOURCE_ID: string; // строго "UC_VWN1ZK" или кастомный SOURCE_ID тенанта
  SOURCE_DESCRIPTION?: string; // Название виджета, URL сайта, Referrer
  UF_CRM_YA_CID?: string; // Client ID Яндекс.Метрики
  COMMENTS?: string;
  STATUS_ID?: string;
  UTM_SOURCE?: string;
  UTM_MEDIUM?: string;
  UTM_CAMPAIGN?: string;
  UTM_CONTENT?: string;
  UTM_TERM?: string;
  OPPORTUNITY?: number;
  CURRENCY_ID?: string;
}

export interface Bitrix24LeadAddRequest {
  fields: Bitrix24LeadFields;
  params?: {
    REGISTER_SONET_EVENT?: "Y" | "N";
  };
}

export interface Bitrix24LeadAddResponse {
  result?: number | string;
  time?: Record<string, unknown>;
  error?: string;
  error_description?: string;
}

export interface Bitrix24TestResult {
  success: boolean;
  leadId?: number | string;
  message: string;
  error?: string;
}

export type Bitrix24SyncStatus = "success" | "error" | "skipped" | "pending";

export interface Bitrix24SyncLogRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  entity_type: string;
  direction: string;
  status: Bitrix24SyncStatus;
  bitrix_lead_id: string | null;
  webhook_url: string | null;
  request_payload: Record<string, unknown> | null;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  error_message: string | null;
  lead_source: string | null;
  widget_id: string | null;
  created_at: Date | string;
}

export interface Bitrix24SyncLogDTO {
  id: string;
  deal_id: string | null;
  deal_title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: Bitrix24SyncStatus;
  bitrix_lead_id: string | null;
  response_status: number | null;
  error_message: string | null;
  lead_source: string | null;
  widget_name: string | null;
  request_payload: Record<string, unknown> | null;
  response_body: Record<string, unknown> | null;
  created_at: string;
}
