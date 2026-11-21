import { z } from "zod";

export const orgTypeSchema = z.enum(["ip", "ooo", "self_employed"]);
export type OrgType = z.infer<typeof orgTypeSchema>;

export const vatModeSchema = z.enum([
  "none",
  "included_5",
  "included_7",
  "included_10",
  "included_20",
]);
export type VatMode = z.infer<typeof vatModeSchema>;

export const invoiceFormConfigSchema = z.object({
  showLogo: z.boolean().default(true),
  showQrCode: z.boolean().default(true),
  showContactsHeader: z.boolean().default(true),
  showEdo: z.boolean().default(true),
  showNotice: z.boolean().default(false),
  noticeText: z
    .string()
    .max(1000)
    .default(
      "Внимание! Оплата данного счёта означает согласие с условиями поставки товара / оказания услуг.",
    ),
  showBasis: z.boolean().default(false),
  showAccountant: z.boolean().default(false),
  showStamp: z.boolean().default(true),
  showSignature: z.boolean().default(true),
  invoiceNumberPrefix: z.string().max(20).default("СЧ"),
  accentColor: z.string().max(30).default("#4a38f5"),
  footerNote: z.string().max(1000).default(""),
});

export type InvoiceFormConfig = z.infer<typeof invoiceFormConfigSchema>;

export const DEFAULT_INVOICE_FORM_CONFIG: InvoiceFormConfig = {
  showLogo: true,
  showQrCode: true,
  showContactsHeader: true,
  showEdo: true,
  showNotice: false,
  noticeText:
    "Внимание! Оплата данного счёта означает согласие с условиями поставки товара / оказания услуг.",
  showBasis: false,
  showAccountant: false,
  showStamp: true,
  showSignature: true,
  invoiceNumberPrefix: "СЧ",
  accentColor: "#4a38f5",
  footerNote: "",
};

export function normalizeInvoiceFormConfig(raw: unknown): InvoiceFormConfig {
  const parsed = invoiceFormConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_INVOICE_FORM_CONFIG };
}

export function vatModeToRate(mode: VatMode): number {
  switch (mode) {
    case "included_5":
      return 5;
    case "included_7":
      return 7;
    case "included_10":
      return 10;
    case "included_20":
      return 20;
    case "none":
    default:
      return 0;
  }
}

export function vatRateToMode(rate: number): VatMode {
  if (rate === 5) return "included_5";
  if (rate === 7) return "included_7";
  if (rate === 10) return "included_10";
  if (rate === 20) return "included_20";
  return "none";
}

/**
 * Расчёт НДС по стандарту РФ «в том числе НДС» (или Без НДС).
 * Итоговая сумма к оплате равна сумме позиций (subtotal),
 * а НДС выделяется из неё по формуле: total * rate / (100 + rate).
 */
export function calculateInvoiceTotals(
  itemsSum: number,
  vatMode: VatMode,
  explicitVatRate?: number,
): { subtotal: number; vatRate: number; vatAmount: number; total: number; vatMode: VatMode } {
  const resolvedMode =
    explicitVatRate !== undefined ? vatRateToMode(explicitVatRate) : vatMode;
  const vatRate =
    explicitVatRate !== undefined ? explicitVatRate : vatModeToRate(resolvedMode);
  const roundedTotal = Math.round(itemsSum * 100) / 100;

  if (vatRate <= 0 || resolvedMode === "none") {
    return {
      subtotal: roundedTotal,
      vatRate: 0,
      vatAmount: 0,
      total: roundedTotal,
      vatMode: "none",
    };
  }

  const vatAmount = Math.round(((roundedTotal * vatRate) / (100 + vatRate)) * 100) / 100;
  return {
    subtotal: roundedTotal,
    vatRate,
    vatAmount,
    total: roundedTotal,
    vatMode: resolvedMode,
  };
}

export const createOrganizationSchema = z.object({
  is_default: z.boolean().optional(),
  org_type: orgTypeSchema.default("ip"),
  name: z.string().trim().min(1, "Наименование обязательно").max(400),
  short_name: z.string().trim().max(200).optional().default(""),
  inn: z.string().trim().max(20).optional().default(""),
  kpp: z.string().trim().max(20).optional().default(""),
  ogrn: z.string().trim().max(25).optional().default(""),
  legal_address: z.string().trim().max(500).optional().default(""),
  actual_address: z.string().trim().max(500).optional().default(""),
  phone: z.string().trim().max(60).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  website: z.string().trim().max(200).optional().default(""),
  edo_info: z.string().trim().max(200).optional().default(""),
  bank_name: z.string().trim().max(300).optional().default(""),
  bik: z.string().trim().max(20).optional().default(""),
  corr_account: z.string().trim().max(30).optional().default(""),
  settlement_account: z.string().trim().max(30).optional().default(""),
  director_title: z.string().trim().max(160).optional().default("Индивидуальный предприниматель"),
  director_name: z.string().trim().max(160).optional().default(""),
  accountant_name: z.string().trim().max(160).optional().default(""),
  vat_mode: vatModeSchema.default("none"),
  logo_url: z.string().max(1_500_000).optional().default(""),
  logo_width: z.number().int().min(40).max(320).optional().default(140),
  stamp_url: z.string().max(1_500_000).optional().default(""),
  signature_url: z.string().max(1_500_000).optional().default(""),
  invoice_config: invoiceFormConfigSchema.partial().optional(),
  elba_enabled: z.boolean().optional().default(false),
  elba_api_key: z.string().trim().max(500).optional(),
  elba_organization_id: z.string().trim().max(100).optional().default(""),
  elba_organization_name: z.string().trim().max(300).optional().default(""),
  elba_bank_account_id: z.string().trim().max(100).optional().default(""),
  elba_auto_sync_invoices: z.boolean().optional().default(false),
});

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  clear_elba_api_key: z.boolean().optional(),
});

export const elbaTestSchema = z.object({
  api_key: z.string().trim().min(1).max(500).optional(),
});

export const elbaBankAccountsSchema = z.object({
  api_key: z.string().trim().min(1).max(500).optional(),
  elba_organization_id: z.string().trim().min(1).max(100),
});

export type CreateOrganizationPayload = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationPayload = z.infer<typeof updateOrganizationSchema>;

export interface FinanceOrganizationDTO {
  id: string;
  isDefault: boolean;
  orgType: OrgType;
  name: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  edoInfo: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  settlementAccount: string;
  directorTitle: string;
  directorName: string;
  accountantName: string;
  vatMode: VatMode;
  vatRate: number;
  logoUrl: string;
  logoWidth: number;
  stampUrl: string;
  signatureUrl: string;
  invoiceConfig: InvoiceFormConfig;
  elbaEnabled: boolean;
  elbaHasApiKey: boolean;
  elbaApiKeyHint: string;
  elbaOrganizationId: string;
  elbaOrganizationName: string;
  elbaBankAccountId: string;
  elbaAutoSyncInvoices: boolean;
  elbaLastSyncAt: string | null;
  elbaLastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceIssuerSnapshot {
  organizationId?: string;
  orgType?: OrgType;
  name: string;
  shortName?: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  edoInfo: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  settlementAccount: string;
  directorTitle: string;
  directorName: string;
  accountantName: string;
  logoUrl: string;
  logoWidth: number;
  stampUrl: string;
  signatureUrl: string;
  invoiceConfig: InvoiceFormConfig;
}
