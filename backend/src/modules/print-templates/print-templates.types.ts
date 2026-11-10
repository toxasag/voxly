import { z } from "zod";

export const printTemplateSlugSchema = z.enum([
  "work_order",
  "completion_act",
  "warranty_ticket",
  "receipt",
]);
export type PrintTemplateSlug = z.infer<typeof printTemplateSlugSchema>;

export const updatePrintTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  page_size: z.enum(["A4", "A5", "thermal_80mm"]).default("A4").optional(),
  orientation: z.enum(["portrait", "landscape"]).default("portrait").optional(),
  body_template: z.string().min(1, "Template cannot be empty"),
});
export type UpdatePrintTemplatePayload = z.infer<typeof updatePrintTemplateSchema>;

export interface PrintTemplateRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string;
  page_size: string;
  orientation: string;
  body_template: string;
  is_default: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PrintTemplateDTO {
  id: string;
  slug: PrintTemplateSlug;
  name: string;
  description: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  bodyTemplate: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RenderTemplateOptions {
  orderId: string;
}
