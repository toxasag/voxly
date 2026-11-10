import { z } from "zod";

export interface FeatureQuotaDefinition {
  key: string;
  name: string;
  description: string;
  defaultLimit: number;
  category: "widgets" | "ai" | "channels" | "crm";
}

export const SYSTEM_FEATURE_QUOTAS: readonly FeatureQuotaDefinition[] = [
  {
    key: "webchat_widgets",
    name: "Онлайн-виджеты (WebChat)",
    description: "Количество активных виджетов онлайн-чата на внешних сайтах",
    defaultLimit: 1,
    category: "widgets",
  },
  {
    key: "ai_agents",
    name: "AI-агенты / боты",
    description: "Количество созданных AI-агентов для переписки и автоответов",
    defaultLimit: 2,
    category: "ai",
  },
  {
    key: "telegram_channels",
    name: "Telegram-аккаунты",
    description: "Количество подключенных аккаунтов или ботов Telegram",
    defaultLimit: 2,
    category: "channels",
  },
  {
    key: "whatsapp_channels",
    name: "WhatsApp-аккаунты",
    description: "Количество подключенных номеров WhatsApp",
    defaultLimit: 2,
    category: "channels",
  },
  {
    key: "max_channels",
    name: "MAX-аккаунты",
    description: "Количество подключенных аккаунтов мессенджера MAX",
    defaultLimit: 2,
    category: "channels",
  },
  {
    key: "custom_pipelines",
    name: "Воронки продаж",
    description: "Количество воронок продаж (Pipelines) в CRM",
    defaultLimit: 5,
    category: "crm",
  },
] as const;

export interface QuotaCheckResult {
  allowed: boolean;
  isUnlimited: boolean;
  current: number;
  maxLimit: number | null;
}

export interface TenantQuotaItemDTO {
  feature_key: string;
  name: string;
  description: string;
  category: string;
  current_usage: number;
  is_unlimited: boolean;
  max_limit: number;
  allowed: boolean;
  default_limit: number;
  is_custom_override: boolean;
}

export const quotaItemUpdateSchema = z.object({
  feature_key: z.string().min(1),
  is_unlimited: z.boolean(),
  max_limit: z.number().int().min(-1).optional(),
});

export const updateTenantQuotasSchema = z.object({
  quotas: z.array(quotaItemUpdateSchema),
});

export type UpdateTenantQuotasPayload = z.infer<typeof updateTenantQuotasSchema>;
