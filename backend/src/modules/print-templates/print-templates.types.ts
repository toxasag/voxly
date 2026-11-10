import { z } from "zod";

export const printTemplateSlugSchema = z.enum([
  "work_order",
  "completion_act",
  "warranty_ticket",
  "receipt",
]);
export type PrintTemplateSlug = z.infer<typeof printTemplateSlugSchema>;

export const printDocumentTypeSchema = z.enum([
  "work_order",
  "completion_act",
  "warranty_ticket",
  "receipt",
]);
export type PrintDocumentType = z.infer<typeof printDocumentTypeSchema>;

export const printLayoutColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  visible: z.boolean(),
  widthPercent: z.number().optional(),
});
export type PrintLayoutColumn = z.infer<typeof printLayoutColumnSchema>;

export const printSectionTypeSchema = z.enum([
  "header",
  "customer",
  "equipment",
  "works_table",
  "parts_table",
  "totals",
  "terms",
  "signatures",
  "tear_off_ticket",
]);
export type PrintSectionType = z.infer<typeof printSectionTypeSchema>;

export const printLayoutConfigSchema = z.object({
  sectionsOrder: z.array(z.string()).default([
    "header",
    "customer",
    "equipment",
    "works_table",
    "parts_table",
    "totals",
    "terms",
    "signatures",
    "tear_off_ticket",
  ]),
  theme: z
    .object({
      fontFamily: z.enum(["Inter", "Arial", "Times New Roman", "Roboto"]).default("Inter"),
      fontSize: z.enum(["small", "medium", "large"]).default("medium"),
      primaryColor: z.string().default("#111111"),
      margins: z.enum(["compact", "normal", "spacious"]).default("normal"),
      accentHeaders: z.boolean().default(true),
      showBorders: z.boolean().default(true),
    })
    .default({
      fontFamily: "Inter",
      fontSize: "medium",
      primaryColor: "#111111",
      margins: "normal",
      accentHeaders: true,
      showBorders: true,
    }),
  header: z
    .object({
      showLogo: z.boolean().default(true),
      logoUrl: z.string().optional(),
      logoWidth: z.number().default(140),
      showCompanyDetails: z.boolean().default(true),
      companyName: z.string().default(""),
      companyAddress: z.string().default(""),
      companyPhone: z.string().default(""),
      companyEmail: z.string().optional(),
      companyWebsite: z.string().optional(),
      companyInn: z.string().optional(),
      companyOgrn: z.string().optional(),
      workingHours: z.string().optional(),
      documentTitle: z.string().default("ЗАКАЗ-НАРЯД"),
      documentSubtitle: z.string().optional(),
      showDate: z.boolean().default(true),
      showDocNumber: z.boolean().default(true),
    })
    .default({
      showLogo: true,
      logoWidth: 140,
      showCompanyDetails: true,
      companyName: "",
      companyAddress: "",
      companyPhone: "",
      documentTitle: "ЗАКАЗ-НАРЯД",
      showDate: true,
      showDocNumber: true,
    }),
  customer: z
    .object({
      visible: z.boolean().default(true),
      title: z.string().default("Заказчик / Клиент"),
      showName: z.boolean().default(true),
      showPhone: z.boolean().default(true),
      showEmail: z.boolean().default(false),
      showAddress: z.boolean().default(false),
      showPassport: z.boolean().default(false),
    })
    .default({
      visible: true,
      title: "Заказчик / Клиент",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: false,
      showPassport: false,
    }),
  equipment: z
    .object({
      visible: z.boolean().default(true),
      title: z.string().default("Оборудование и неисправность"),
      showTypeBrandModel: z.boolean().default(true),
      showSerial: z.boolean().default(true),
      showDefect: z.boolean().default(true),
      showAppearance: z.boolean().default(true),
      showPackage: z.boolean().default(true),
      showMaster: z.boolean().default(true),
      showEstimatedCost: z.boolean().default(true),
    })
    .default({
      visible: true,
      title: "Оборудование и неисправность",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: true,
      showAppearance: true,
      showPackage: true,
      showMaster: true,
      showEstimatedCost: true,
    }),
  table: z
    .object({
      visible: z.boolean().default(true),
      worksTitle: z.string().default("Выполненные работы и услуги"),
      partsTitle: z.string().default("Использованные запчасти и материалы"),
      columns: z
        .array(printLayoutColumnSchema)
        .default([
          { id: "num", label: "№", visible: true, widthPercent: 5 },
          { id: "name", label: "Наименование", visible: true, widthPercent: 45 },
          { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
          { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
          { id: "price", label: "Цена", visible: true, widthPercent: 15 },
          { id: "total", label: "Сумма", visible: true, widthPercent: 15 },
        ]),
      showWorks: z.boolean().default(true),
      showParts: z.boolean().default(true),
      showVat: z.boolean().default(false),
      vatRate: z.number().default(20),
      showDiscount: z.boolean().default(false),
      showTotals: z.boolean().default(true),
      showGrandTotalWords: z.boolean().default(true),
    })
    .default({
      visible: true,
      worksTitle: "Выполненные работы и услуги",
      partsTitle: "Использованные запчасти и материалы",
      columns: [
        { id: "num", label: "№", visible: true, widthPercent: 5 },
        { id: "name", label: "Наименование", visible: true, widthPercent: 45 },
        { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
        { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
        { id: "price", label: "Цена", visible: true, widthPercent: 15 },
        { id: "total", label: "Сумма", visible: true, widthPercent: 15 },
      ],
      showWorks: true,
      showParts: true,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: true,
      showGrandTotalWords: true,
    }),
  terms: z
    .object({
      visible: z.boolean().default(true),
      title: z.string().default("Условия и гарантийные обязательства"),
      termsText: z.string().default(""),
      showPdnConsent: z.boolean().default(true),
      pdnText: z.string().default(""),
      showWarrantyText: z.boolean().default(true),
      warrantyDays: z.number().default(30),
    })
    .default({
      visible: true,
      title: "Условия и гарантийные обязательства",
      termsText: "",
      showPdnConsent: true,
      pdnText: "",
      showWarrantyText: true,
      warrantyDays: 30,
    }),
  signatures: z
    .object({
      visible: z.boolean().default(true),
      showExecutor: z.boolean().default(true),
      executorTitle: z.string().default("Исполнитель"),
      showClient: z.boolean().default(true),
      clientTitle: z.string().default("Заказчик"),
      showStamp: z.boolean().default(true),
      stampText: z.string().default("М.П."),
    })
    .default({
      visible: true,
      showExecutor: true,
      executorTitle: "Исполнитель",
      showClient: true,
      clientTitle: "Заказчик",
      showStamp: true,
      stampText: "М.П.",
    }),
  tearOffTicket: z
    .object({
      visible: z.boolean().default(true),
      title: z.string().default("Отрывной талон клиента"),
      showBarcodeOrQr: z.boolean().default(true),
      customNote: z
        .string()
        .default(
          "Предъявите данный талон при получении оборудования из сервисного центра.",
        ),
    })
    .default({
      visible: true,
      title: "Отрывной талон клиента",
      showBarcodeOrQr: true,
      customNote: "Предъявите данный талон при получении оборудования из сервисного центра.",
    }),
});
export type PrintLayoutConfig = z.infer<typeof printLayoutConfigSchema>;

export const createPrintTemplateSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  description: z.string().max(500).default(""),
  document_type: z.string().default("work_order"),
  page_size: z.enum(["A4", "A5", "thermal_80mm"]).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  layout_config: printLayoutConfigSchema.optional(),
  body_template: z.string().optional(),
  is_default: z.boolean().default(false),
  clone_from_id: z.string().uuid().optional(),
});
export type CreatePrintTemplatePayload = z.infer<typeof createPrintTemplateSchema>;

export const updatePrintTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  document_type: z.string().optional(),
  page_size: z.enum(["A4", "A5", "thermal_80mm"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  layout_config: printLayoutConfigSchema.optional(),
  body_template: z.string().optional(),
  is_default: z.boolean().optional(),
});
export type UpdatePrintTemplatePayload = z.infer<typeof updatePrintTemplateSchema>;

export interface PrintTemplateRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string;
  document_type: string;
  page_size: string;
  orientation: string;
  body_template: string;
  layout_config: PrintLayoutConfig | Record<string, unknown>;
  is_default: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PrintTemplateDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  documentType: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  bodyTemplate: string;
  layoutConfig: PrintLayoutConfig;
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
