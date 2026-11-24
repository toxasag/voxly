import { z } from "zod";
import {
  vatModeSchema,
  type InvoiceIssuerSnapshot,
  type VatMode,
} from "./finance-organizations.types.js";

export const accountIdSchema = z.string().uuid("account_id must be a UUID");
export const accountTypeSchema = z.enum(["bank", "cash", "acquiring", "safe"]);
export const transactionTypeSchema = z.enum(["income", "expense"]);
export const invoiceStatusSchema = z.enum(["draft", "sent", "paid", "overdue", "cancelled"]);

const optionalUuid = z.string().uuid().optional().nullable().or(z.literal(""));
const isoDate = z.string().datetime("Use an ISO 8601 timestamp");
const flexibleDate = z.string().optional().nullable().or(z.literal("")).refine((val) => {
  if (!val || !val.trim()) return true;
  return !isNaN(Date.parse(val));
}, "Use a valid timestamp (ISO 8601 or YYYY-MM-DDTHH:mm)");

export const createAccountSchema = z.object({
  name: z.string().min(1).max(120),
  account_type: accountTypeSchema.default("cash"),
  currency: z.string().length(3).default("RUB"),
  opening_balance: z.number().nonnegative().default(0),
  is_default: z.boolean().default(false),
});

export const transferSchema = z.object({
  from_account_id: accountIdSchema,
  to_account_id: accountIdSchema,
  amount: z.number().positive("Transfer amount must be positive"),
  description: z.string().max(500).optional().nullable().or(z.literal("")),
  occurred_at: flexibleDate.optional(),
}).refine((value) => value.from_account_id !== value.to_account_id, {
  message: "Source and destination accounts must differ",
  path: ["to_account_id"],
});

export const createTransactionSchema = z.object({
  account_id: accountIdSchema,
  type: transactionTypeSchema,
  amount: z.number().positive(),
  currency: z.string().length(3).default("RUB"),
  category_id: z.string().optional().nullable().or(z.literal("")),
  category_name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable().or(z.literal("")),
  counterparty_name: z.string().max(200).optional().nullable().or(z.literal("")),
  counterparty_inn: z.string().max(20).optional().nullable().or(z.literal("")),
  deal_id: optionalUuid,
  repair_order_id: optionalUuid,
  invoice_id: optionalUuid,
  occurred_at: flexibleDate.optional(),
});

export const updateTransactionSchema = z.object({
  account_id: accountIdSchema.optional(),
  type: transactionTypeSchema.optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  category_id: z.string().optional().nullable().or(z.literal("")),
  category_name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable().or(z.literal("")),
  counterparty_name: z.string().max(200).optional().nullable().or(z.literal("")),
  counterparty_inn: z.string().max(20).optional().nullable().or(z.literal("")),
  deal_id: optionalUuid,
  repair_order_id: optionalUuid,
  invoice_id: optionalUuid,
  occurred_at: flexibleDate.optional(),
});

export const pnlQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const invoiceItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unit_price: z.number().nonnegative(),
  source: z.enum(["manual", "repair_work", "repair_part", "deal"]).default("manual"),
  source_label: z.string().max(200).optional().or(z.literal("")),
});

export const createInvoiceSchema = z.object({
  issuer_organization_id: optionalUuid,
  company_id: optionalUuid,
  company_name: z.string().min(1).max(200),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: optionalUuid,
  repair_order_id: optionalUuid,
  due_date: isoDate,
  vat_mode: vatModeSchema.optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
  sync_to_elba: z.boolean().optional(),
  line_items: z.array(invoiceItemSchema).min(1).max(100),
});

export const updateInvoiceSchema = z.object({
  status: invoiceStatusSchema.optional(),
  issuer_organization_id: optionalUuid,
  company_id: optionalUuid,
  company_name: z.string().trim().min(1).max(200).optional(),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  due_date: isoDate.optional(),
  vat_mode: vatModeSchema.optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  line_items: z.array(invoiceItemSchema).min(1).max(100).optional(),
});

export const bulkUpdateInvoicesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["draft", "sent", "overdue", "cancelled"]).optional(),
  due_date: isoDate.optional(),
  notes: z.string().max(2000).optional(),
});

export const bulkDeleteInvoicesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const markInvoicePaidSchema = z.object({
  account_id: optionalUuid,
  occurred_at: isoDate.optional(),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const batchPaymentSchema = z.object({
  repair_order_ids: z.array(z.string().uuid()).min(1),
  cash_account_id: accountIdSchema,
  category_id: optionalUuid,
  works_category_id: optionalUuid,
  parts_category_id: optionalUuid,
  split_works_and_parts: z.boolean().default(true),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const createInvoiceFromActsSchema = z.object({
  repair_order_ids: z.array(z.string().uuid()).min(1),
  issuer_organization_id: optionalUuid,
  company_id: optionalUuid,
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: optionalUuid,
  due_date: isoDate.optional(),
  vat_mode: vatModeSchema.optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
  sync_to_elba: z.boolean().optional(),
});

export const sendInvoiceSchema = z.object({
  channel_type: z.enum(["telegram", "whatsapp", "max", "all"]).default("all"),
});

export const bulkTransactionsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least 1 transaction"),
});

export type AccountType = z.infer<typeof accountTypeSchema>;
export type BulkTransactionsPayload = z.infer<typeof bulkTransactionsSchema>;
export type CreateAccountPayload = z.infer<typeof createAccountSchema>;
export type TransferPayload = z.infer<typeof transferSchema>;
export type CreateTransactionPayload = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionPayload = z.infer<typeof updateTransactionSchema>;
export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
export type CreateInvoiceFromActsPayload = z.infer<typeof createInvoiceFromActsSchema>;
export type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;
export type BulkUpdateInvoicesPayload = z.infer<typeof bulkUpdateInvoicesSchema>;
export type BulkDeleteInvoicesPayload = z.infer<typeof bulkDeleteInvoicesSchema>;
export type MarkInvoicePaidPayload = z.infer<typeof markInvoicePaidSchema>;
export type BatchPaymentPayload = z.infer<typeof batchPaymentSchema>;
export type SendInvoicePayload = z.infer<typeof sendInvoiceSchema>;
export type InvoiceItemPayload = z.infer<typeof invoiceItemSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export interface AccountDTO {
  id: string;
  name: string;
  accountType: AccountType;
  accountNumber?: string;
  organizationId?: string | null;
  currency: string;
  balance: number;
  isDefault: boolean;
}

export interface TransactionDTO {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string | null;
  categoryName: string;
  description: string;
  accountId: string;
  accountName: string;
  dealId: string | null;
  repairOrderId: string | null;
  invoiceId: string | null;
  counterpartyName: string;
  counterpartyInn: string;
  occurredAt: string;
  createdById?: string | null;
  createdByName?: string | null;
}

export interface InvoiceItemDTO {
  id: string; description: string; quantity: number; unitPrice: number; total: number;
  source: string; sourceLabel: string | null;
}

export interface InvoiceDTO {
  id: string; invoiceNumber: string; status: InvoiceStatus; issueDate: string;
  dueDate: string; companyId: string | null; companyName: string; companyInn: string;
  companyAddress: string; contactName: string; contactPhone: string;
  dealId: string | null; repairOrderId: string | null; subtotal: number;
  vatMode: VatMode; vatRate: number; vatAmount: number; total: number; currency: string;
  notes: string; paidAt: string | null; paidAccountId: string | null;
  issuerOrganizationId: string | null;
  issuerSnapshot: InvoiceIssuerSnapshot | null;
  elbaBillId: string;
  elbaSyncedAt: string | null;
  elbaSyncError: string;
  lineItems: InvoiceItemDTO[];
}

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  type: z.enum(["income", "expense"]),
  parent_id: z.string().uuid().optional().nullable().or(z.literal("")),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["income", "expense"]).optional(),
  parent_id: z.string().uuid().optional().nullable().or(z.literal("")),
});

export type CreateCategoryPayload = z.infer<typeof createCategorySchema>;
export type UpdateCategoryPayload = z.infer<typeof updateCategorySchema>;

export interface FinanceCategoryDTO {
  id: string;
  name: string;
  type: "income" | "expense";
  parentId: string | null;
  createdAt: string;
}

export interface PnlCategoryDTO { categoryName: string; amount: number; percentage: number; }

export interface PnlCogsBreakdownItemDTO {
  movementId: string;
  itemName: string;
  batchNumber: string;
  supplierName: string;
  ticketNumber: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  occurredAt: string;
}

export interface PnlCogsSummaryDTO {
  partsRevenue: number;
  repairPartsRevenue?: number;
  dealProductsRevenue?: number;
  worksRevenue: number;
  partsCogs: number;
  partsGrossProfit: number;
  /** Наценка от партионной себестоимости: (partsRevenue - partsCogs) / partsCogs * 100 */
  partsMarkupPercent: number;
  /** Маржа от цены продажи: (partsRevenue - partsCogs) / partsRevenue * 100 */
  partsMarginPercent: number;
  /** Валовая прибыль по начислению: (partsRevenue + worksRevenue) - partsCogs */
  accrualGrossProfit: number;
  /** Оценка остатков склада по фактическим ценам партий */
  stockValuation: number;
  writeOffsCount: number;
  breakdown: PnlCogsBreakdownItemDTO[];
}

export interface PnlDTO {
  from: string; to: string; income: number; expenses: number; netProfit: number;
  incomeByCategory: PnlCategoryDTO[]; expensesByCategory: PnlCategoryDTO[];
  cogs?: PnlCogsSummaryDTO;
}
