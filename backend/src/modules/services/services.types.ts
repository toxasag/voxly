import { z } from "zod";

export const createServiceSchema = z.object({
  name: z.string().min(1, "Наименование обязательно").max(200),
  description: z.string().max(2000).optional().default(""),
  price: z.number().nonnegative("Цена не может быть отрицательной").optional().default(0),
  default_price: z.number().nonnegative().optional(),
  unit: z.string().max(30).optional().default("усл"),
  duration_minutes: z.number().int().nonnegative().nullable().optional(),
});

export type CreateServicePayload = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative().optional(),
  default_price: z.number().nonnegative().optional(),
  unit: z.string().max(30).optional(),
  duration_minutes: z.number().int().nonnegative().nullable().optional(),
});

export type UpdateServicePayload = z.infer<typeof updateServiceSchema>;

export interface ServiceItemRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  default_price: string | number;
  unit: string | null;
  duration_minutes: number | null;
  created_at: Date | string;
  updated_at?: Date | string;
}

export interface ServiceItemDTO {
  id: string;
  name: string;
  description: string;
  price: number;
  defaultPrice: number;
  unit: string;
  durationMinutes: number | null;
  createdAt: string;
  updatedAt?: string;
}
