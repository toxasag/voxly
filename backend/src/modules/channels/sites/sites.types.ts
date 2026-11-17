import { z } from "zod";

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "Укажите название сайта").max(255),
  site_url: z.string().trim().max(500).optional().or(z.literal("")),
  target_pipeline_id: z.string().uuid("Некорректный ID воронки").optional().or(z.literal("")),
  target_stage_id: z.string().uuid("Некорректный ID этапа").optional().or(z.literal("")),
  field_mapping: z.record(z.string()).optional(),
  is_active: z.boolean().optional().default(true),
});

export type CreateSitePayload = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1, "Укажите название сайта").max(255).optional(),
  site_url: z.string().trim().max(500).optional().or(z.literal("")),
  target_pipeline_id: z.string().uuid("Некорректный ID воронки").nullable().optional().or(z.literal("")),
  target_stage_id: z.string().uuid("Некорректный ID этапа").nullable().optional().or(z.literal("")),
  field_mapping: z.record(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export type UpdateSitePayload = z.infer<typeof updateSiteSchema>;

export const siteParamsSchema = z.object({
  id: z.string().uuid("ID сайта должен быть валидным UUID"),
});

export const siteWebhookParamsSchema = z.object({
  token: z.string().trim().min(8, "Некорректный токен вебхука"),
});

export interface SiteIntegrationRow {
  id: string;
  tenant_id: string;
  name: string;
  site_url: string | null;
  webhook_token: string;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  field_mapping: Record<string, string>;
  is_active: boolean;
  leads_count: number;
  last_lead_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  target_pipeline_name?: string | null;
  target_stage_name?: string | null;
}

export interface SiteIntegrationDTO {
  id: string;
  tenant_id: string;
  name: string;
  site_url: string | null;
  webhook_token: string;
  webhook_url: string;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  target_pipeline_name?: string | null;
  target_stage_name?: string | null;
  field_mapping: Record<string, string>;
  is_active: boolean;
  leads_count: number;
  last_lead_at: string | null;
  created_at: string;
  updated_at: string;
}
