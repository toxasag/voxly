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
  last_lead_id: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface UpdateBitrix24ConfigPayload {
  webhook_url?: string;
  is_enabled?: boolean;
  allowed_sources?: (LeadSource | string)[];
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
  SOURCE_ID: string; // строго "UC_VWN1ZK" по ТЗ
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
