import { z } from "zod";

export const accountIdSchema = z.string().uuid("account_id must be a UUID");
export const transactionTypeSchema = z.enum(["income", "expense"]);
export const invoiceStatusSchema = z.enum(["draft", "sent", "paid", "overdue", "cancelled"]);

const optionalUuid = z.string().uuid().optional().or(z.literal(""));
const isoDate = z.string().datetime("Use an ISO 8601 timestamp");

export const createAccountSchema = z.object({
  name: z.string().min(1).max(120),
  currency: z.string().length(3).default("RUB"),
  opening_balance: z.number().nonnegative().default(0),
  is_default: z.boolean().default(false),
});

export const transferSchema = z.object({
  from_account_id: accountIdSchema,
  to_account_id: accountIdSchema,
  amount: z.number().positive("Transfer amount must be positive"),
  description: z.string().max(500).optional().or(z.literal("")),
  occurred_at: isoDate.optional(),
}).refine((value) => value.from_account_id !== value.to_account_id, {
  message: "Source and destination accounts must differ",
  path: ["to_account_id"],
});

export const createTransactionSchema = z.object({
  account_id: accountIdSchema,
  type: transactionTypeSchema,
  amount: z.number().positive(),
  currency: z.string().length(3).default("RUB"),
  category_id: optionalUuid,
  category_name: z.string().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  counterparty_name: z.string().max(200).optional().or(z.literal("")),
  counterparty_inn: z.string().max(20).optional().or(z.literal("")),
  deal_id: optionalUuid,
  repair_order_id: optionalUuid,
  invoice_id: optionalUuid,
  occurred_at: isoDate.optional(),
});

export const pnlQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const invoiceItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive().default(1),
  unit_price: z.number().nonnegative(),
  source: z.enum(["manual", "repair_work", "repair_part", "deal"]).default("manual"),
  source_label: z.string().max(200).optional().or(z.literal("")),
});

export const createInvoiceSchema = z.object({
  company_id: optionalUuid,
  company_name: z.string().min(1).max(200),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: optionalUuid,
  repair_order_id: optionalUuid,
  due_date: isoDate,
  vat_rate: z.number().min(0).max(100).default(20),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
  line_items: z.array(invoiceItemSchema).min(1).max(100),
});

export const updateInvoiceSchema = z.object({
  status: invoiceStatusSchema.optional(),
  due_date: isoDate.optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const markInvoicePaidSchema = z.object({
  account_id: accountIdSchema,
  occurred_at: isoDate.optional(),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const batchPaymentSchema = z.object({
  repair_order_ids: z.array(z.string().uuid()).min(1),
  cash_account_id: accountIdSchema,
  category_id: optionalUuid,
  description: z.string().max(500).optional().or(z.literal("")),
});

export const createInvoiceFromActsSchema = z.object({
  repair_order_ids: z.array(z.string().uuid()).min(1),
  company_id: optionalUuid,
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: optionalUuid,
  due_date: isoDate.optional(),
  vat_rate: z.number().min(0).max(100).default(20),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const sendInvoiceSchema = z.object({
  channel_type: z.enum(["telegram", "whatsapp", "all"]).default("all"),
});

export type CreateAccountPayload = z.infer<typeof createAccountSchema>;
export type TransferPayload = z.infer<typeof transferSchema>;
export type CreateTransactionPayload = z.infer<typeof createTransactionSchema>;
export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
export type CreateInvoiceFromActsPayload = z.infer<typeof createInvoiceFromActsSchema>;
export type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;
export type MarkInvoicePaidPayload = z.infer<typeof markInvoicePaidSchema>;
export type BatchPaymentPayload = z.infer<typeof batchPaymentSchema>;
export type SendInvoicePayload = z.infer<typeof sendInvoiceSchema>;
export type InvoiceItemPayload = z.infer<typeof invoiceItemSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export interface AccountDTO {
  id: string; name: string; currency: string; balance: number; isDefault: boolean;
}

export interface TransactionDTO {
  id: string; type: TransactionType; amount: number; currency: string;
  categoryId: string | null; categoryName: string; description: string;
  accountId: string; accountName: string; dealId: string | null;
  repairOrderId: string | null; invoiceId: string | null; occurredAt: string;
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
  vatRate: number; vatAmount: number; total: number; currency: string;
  notes: string; paidAt: string | null; paidAccountId: string | null;
  lineItems: InvoiceItemDTO[];
}

export interface PnlCategoryDTO { categoryName: string; amount: number; percentage: number; }
export interface PnlDTO {
  from: string; to: string; income: number; expenses: number; netProfit: number;
  incomeByCategory: PnlCategoryDTO[]; expensesByCategory: PnlCategoryDTO[];
}
