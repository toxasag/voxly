import { z } from "zod";

export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

export const authSettingsSchema = z.object({
  require_telegram_auth: z.boolean().default(false),
  allow_password_auth: z.boolean().default(true),
});

export type AuthSettings = z.infer<typeof authSettingsSchema>;

export const createPartnerTenantSchema = z.object({
  name: z.string().trim().min(1, "Название компании обязательно").max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Поддомен должен быть от 3 символов")
    .max(63, "Поддомен не более 63 символов")
    .regex(SLUG_REGEX, "Поддомен может содержать только строчные латинские буквы, цифры и дефисы"),
  admin_email: z.string().trim().toLowerCase().email("Некорректный e-mail администратора"),
  admin_password: z.string().min(6, "Пароль должен содержать не менее 6 символов"),
  admin_name: z.string().trim().max(100).optional().default("Администратор"),
  admin_phone: z.string().trim().optional(),
  telegram_id: z.union([z.string(), z.number()]).optional(),
  telegram_username: z.string().trim().optional(),
  plan: z.string().trim().optional().default("pro"),
  price_override: z.number().min(0).nullable().optional(),
  is_complimentary: z.boolean().optional().default(false),
  auth_settings: authSettingsSchema.optional().default({
    require_telegram_auth: false,
    allow_password_auth: true,
  }),
  custom_pricing: z.record(z.unknown()).optional(),
});

export type CreatePartnerTenantInput = z.infer<typeof createPartnerTenantSchema>;

export const updateAuthSettingsSchema = z.object({
  require_telegram_auth: z.boolean(),
  allow_password_auth: z.boolean().optional().default(true),
});

export type UpdateAuthSettingsInput = z.infer<typeof updateAuthSettingsSchema>;

export interface PartnerChildTenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  parent_tenant_id: string | null;
  auth_settings: AuthSettings;
  custom_pricing: Record<string, unknown> | null;
  custom_price_rubles: number | null;
  users_count?: number;
  contacts_count?: number;
  deals_count?: number;
  admin?: {
    id: string;
    email: string;
    name: string;
    phone: string;
  } | null;
  created_at: string;
  updated_at: string;
}
