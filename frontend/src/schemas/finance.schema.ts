import { z } from "zod";

export const createTransactionSchema = z.object({
  account_id: z.string().min(1, "Account is required"),
  type: z.enum(["income", "expense"], {
    errorMap: () => ({ message: "Select transaction type" }),
  }),
  amount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .min(0.01, "Amount must be greater than 0"),
  currency: z.string().length(3).default("RUB"),
  category_id: z.string().uuid().optional().or(z.literal("")),
  category_name: z.string().min(1, "Category is required").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  counterparty_name: z.string().max(200).optional().or(z.literal("")),
  counterparty_inn: z.string().max(20).optional().or(z.literal("")),
  deal_id: z.string().uuid().optional().or(z.literal("")),
  repair_order_id: z.string().uuid().optional().or(z.literal("")),
  invoice_id: z.string().uuid().optional().or(z.literal("")),
  occurred_at: z.string().optional(),
});

export type CreateTransactionPayload = z.infer<typeof createTransactionSchema>;

export const createInvoiceSchema = z.object({
  company_id: z.string().uuid().optional().or(z.literal("")),
  company_name: z.string().min(1, "Company name is required").max(200),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: z.string().uuid().optional().or(z.literal("")),
  repair_order_id: z.string().uuid().optional().or(z.literal("")),
  due_date: z.string().min(1, "Due date is required"),
  vat_rate: z.number().min(0).max(100).default(20),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
  line_items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().int().positive().default(1),
    unit_price: z.number().nonnegative(),
    source: z.enum(["manual", "repair_work", "repair_part", "deal"]).default("manual"),
    source_label: z.string().max(200).optional().or(z.literal("")),
  })).min(1).max(100),
});

export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional(),
  due_date: z.string().optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;

export const markInvoicePaidSchema = z.object({
  account_id: z.string().min(1, "Account is required"),
  occurred_at: z.string().optional(),
  description: z.string().max(500).optional().or(z.literal("")),
});

export type MarkInvoicePaidPayload = z.infer<typeof markInvoicePaidSchema>;