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

// ---------------------------------------------------------------------------
// Print Template Settings (Реквизиты, брендинг, правила и тумблеры видимости)
// ---------------------------------------------------------------------------

export const updatePrintTemplateSettingsSchema = z.object({
  company_name: z.string().max(255).optional(),
  company_address: z.string().max(500).optional(),
  company_phone: z.string().max(100).optional(),
  company_email: z.string().max(100).optional(),
  company_website: z.string().max(255).optional(),
  company_inn: z.string().max(50).optional(),
  company_ogrn: z.string().max(50).optional(),
  working_hours: z.string().max(200).optional(),
  logo_url: z.string().max(1000).optional(),

  numbering_format: z.enum(["compact", "full"]).default("compact").optional(),
  numbering_prefix: z.string().max(50).default("№").optional(),

  intake_terms: z.string().max(5000).optional(),
  intake_pdn_consent: z.string().max(2000).optional(),
  show_equipment_serial: z.boolean().optional(),
  show_appearance: z.boolean().optional(),
  show_package_contents: z.boolean().optional(),
  show_defect_description: z.boolean().optional(),
  show_estimated_cost: z.boolean().optional(),
  show_client_tear_off_ticket: z.boolean().optional(),
  show_intake_signatures: z.boolean().optional(),

  warranty_terms: z.string().max(5000).optional(),
  return_policy: z.string().max(3000).optional(),
  show_works_table: z.boolean().optional(),
  show_parts_table: z.boolean().optional(),
  show_completion_signatures: z.boolean().optional(),
  show_completion_stamp: z.boolean().optional(),
});
export type UpdatePrintTemplateSettingsPayload = z.infer<typeof updatePrintTemplateSettingsSchema>;

export interface PrintTemplateSettingsRow {
  id: string;
  tenant_id: string;
  company_name: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  company_inn: string;
  company_ogrn: string;
  working_hours: string;
  logo_url: string;
  numbering_format: "compact" | "full";
  numbering_prefix: string;
  intake_terms: string;
  intake_pdn_consent: string;
  show_equipment_serial: boolean;
  show_appearance: boolean;
  show_package_contents: boolean;
  show_defect_description: boolean;
  show_estimated_cost: boolean;
  show_client_tear_off_ticket: boolean;
  show_intake_signatures: boolean;
  warranty_terms: string;
  return_policy: string;
  show_works_table: boolean;
  show_parts_table: boolean;
  show_completion_signatures: boolean;
  show_completion_stamp: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PrintTemplateSettingsDTO {
  id: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyInn: string;
  companyOgrn: string;
  workingHours: string;
  logoUrl: string;
  numberingFormat: "compact" | "full";
  numberingPrefix: string;
  intakeTerms: string;
  intakePdnConsent: string;
  showEquipmentSerial: boolean;
  showAppearance: boolean;
  showPackageContents: boolean;
  showDefectDescription: boolean;
  showEstimatedCost: boolean;
  showClientTearOffTicket: boolean;
  showIntakeSignatures: boolean;
  warrantyTerms: string;
  returnPolicy: string;
  showWorksTable: boolean;
  showPartsTable: boolean;
  showCompletionSignatures: boolean;
  showCompletionStamp: boolean;
  updatedAt: string;
}
