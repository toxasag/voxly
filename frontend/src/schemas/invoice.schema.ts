import { z } from "zod";

export const invoiceLineItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().int().positive("Min quantity is 1").default(1),
  unit_price: z.number().min(0, "Price must be positive"),
  source: z.enum(["manual", "repair_work", "repair_part", "deal"]).default("manual"),
  source_label: z.string().max(200).optional().or(z.literal("")),
});

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
  line_items: z.array(invoiceLineItemSchema).min(1, "At least one line item is required").max(100),
});

export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;