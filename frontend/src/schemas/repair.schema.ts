import { z } from "zod";

const digitsOnly = (lengths: number[], label: string) =>
  z.string().refine(
    (v) => v === "" || (/^\d+$/.test(v) && lengths.includes(v.length)),
    `${label} must contain ${lengths.join(" or ")} digits`,
  );

export const additionalContactSchema = z.object({
  name: z.string().min(1, "Имя контакта обязательно").max(200),
  phone: z.string().min(5, "Телефон обязателен").max(30),
  role: z.string().max(100).optional().or(z.literal("")),
});
export type AdditionalContact = z.infer<typeof additionalContactSchema>;

export const repairPaymentStatusSchema = z.enum(["unpaid", "invoiced", "paid"]);
export type RepairPaymentStatus = z.infer<typeof repairPaymentStatusSchema>;

export const changePaymentStatusSchema = z.object({
  payment_status: repairPaymentStatusSchema,
});
export type ChangePaymentStatusPayload = z.infer<typeof changePaymentStatusSchema>;

export const createRepairSchema = z.object({
  deal_id: z.string().optional().or(z.literal("")),
  customer_id: z.string().optional().or(z.literal("")),
  customer_name: z.string().min(1, "Customer name is required").max(200),
  customer_phone: z.string().min(5, "Phone is required").max(30),
  customer_email: z.string().email("Invalid email").optional().or(z.literal("")),
  additional_contacts: z.array(additionalContactSchema).optional().default([]),
  company_id: z.string().optional().or(z.literal("")),
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: digitsOnly([10, 12], "ИНН").optional().or(z.literal("")),
  company_ogrn: digitsOnly([13, 15], "ОГРН").optional().or(z.literal("")),
  company_bik: digitsOnly([9], "БИК").optional().or(z.literal("")),
  company_account_number: digitsOnly([20], "Расчетный счет").optional().or(z.literal("")),
  company_legal_address: z.string().max(300).optional().or(z.literal("")),
  equipment_type: z.string().min(1, "Equipment type is required"),
  equipment_brand: z.string().min(1, "Brand is required").max(100),
  equipment_model: z.string().min(1, "Model is required").max(100),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  package_contents_items: z.array(z.string()).optional().default([]),
  appearance: z.string().max(1000).optional().or(z.literal("")).default(""),
  defect_description: z.string().max(2000).optional().default(""),
  malfunctions: z.array(z.string()).optional().default([]),
  defect_photos: z.array(z.string()).max(20).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  payment_status: repairPaymentStatusSchema.optional().default("unpaid"),
  master_id: z.string().optional().or(z.literal("")),
  master_name: z.string().max(200).optional().or(z.literal("")),
  estimated_cost: z
    .number({ invalid_type_error: "Cost must be a number" })
    .min(0, "Cost must be positive"),
  notes: z.string().max(1000).optional(),
}).refine(
  (data) => (data.malfunctions && data.malfunctions.length > 0) || (data.defect_description && data.defect_description.trim().length >= 3),
  {
    message: "Укажите хотя бы одну заявленную неисправность",
    path: ["malfunctions"],
  },
);

export type CreateRepairPayload = z.infer<typeof createRepairSchema>;

export const updateRepairSchema = z.object({
  customer_name: z.string().min(1).max(200).optional(),
  customer_phone: z.string().min(5).max(30).optional(),
  additional_contacts: z.array(additionalContactSchema).optional(),
  equipment_type: z.string().min(1).max(100).optional(),
  equipment_brand: z.string().min(1).max(100).optional(),
  equipment_model: z.string().min(1).max(100).optional(),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  package_contents_items: z.array(z.string()).optional(),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z.string().max(2000).optional(),
  malfunctions: z.array(z.string()).optional(),
  payment_status: repairPaymentStatusSchema.optional(),
  estimated_cost: z.number().min(0).optional(),
  final_cost: z.number().min(0).optional(),
  master_id: z.string().uuid().optional().or(z.literal("")),
  master_name: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

export type UpdateRepairPayload = z.infer<typeof updateRepairSchema>;

export const changeStatusSchema = z.object({
  status: z.enum(["intake", "diagnostics", "approval", "in_progress", "ready", "issued", "rejected"]),
  comment: z.string().max(2000).optional().or(z.literal("")),
  diagnostics: z.object({
    findings: z.string().min(1).max(4000),
    recommended_action: z.string().min(1).max(4000),
    condition_notes: z.string().max(4000).optional().or(z.literal("")),
  }).optional(),
});

export type ChangeStatusPayload = z.infer<typeof changeStatusSchema>;

export const createWorkSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  master_id: z.string().min(1, "Master is required"),
  master_name: z.string().min(1, "Master name is required").max(200),
  cost: z.number().min(0, "Cost cannot be negative"),
});

export type CreateWorkPayload = z.infer<typeof createWorkSchema>;

export const createPartSchema = z.object({
  name: z.string().min(1, "Part name is required").max(200),
  article: z.string().max(100).optional().or(z.literal("")),
  quantity: z.number().int().min(1).default(1),
  retail_price: z.number().min(0, "Retail price cannot be negative"),
  cost_price: z.number().min(0, "Cost price cannot be negative").default(0),
});

export type CreatePartPayload = z.infer<typeof createPartSchema>;

export const createNoteSchema = z.object({
  content: z.string().min(1, "Note content is required").max(4000),
});

export type CreateNotePayload = z.infer<typeof createNoteSchema>;