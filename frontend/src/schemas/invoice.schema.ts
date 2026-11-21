import { z } from "zod";

export const invoiceLineItemSchema = z.object({
  description: z.string().min(1, "Укажите наименование позиции").max(500),
  quantity: z.number().positive("Минимальное количество > 0").default(1),
  unit_price: z.number().min(0, "Цена не может быть отрицательной"),
  source: z.enum(["manual", "repair_work", "repair_part", "deal"]).default("manual"),
  source_label: z.string().max(200).optional().or(z.literal("")),
});

export const createInvoiceSchema = z.object({
  issuer_organization_id: z.string().uuid().optional().or(z.literal("")),
  company_id: z.string().uuid().optional().or(z.literal("")),
  company_name: z.string().min(1, "Укажите плательщика").max(200),
  company_inn: z.string().max(20).optional().or(z.literal("")),
  company_address: z.string().max(300).optional().or(z.literal("")),
  contact_name: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(30).optional().or(z.literal("")),
  deal_id: z.string().uuid().optional().or(z.literal("")),
  repair_order_id: z.string().uuid().optional().or(z.literal("")),
  due_date: z.string().min(1, "Укажите срок оплаты"),
  vat_mode: z.enum(["none", "included_5", "included_7", "included_10", "included_20"]).optional(),
  vat_rate: z.number().min(0).max(100).default(0),
  currency: z.string().length(3).default("RUB"),
  notes: z.string().max(2000).optional().or(z.literal("")),
  line_items: z.array(invoiceLineItemSchema).min(1, "Добавьте хотя бы одну позицию").max(100),
});

export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
