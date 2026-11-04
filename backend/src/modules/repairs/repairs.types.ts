import { z } from "zod";

// ---------------------------------------------------------------------------
// Status workflow
//
// intake → diagnostics → approval → in_progress → ready → issued
// `rejected` is a terminal side-exit reachable from any pre-issued status
// (customer declined the quote).
// ---------------------------------------------------------------------------

export const repairStatusSchema = z.enum([
  "intake",
  "waiting_parts",
  "parts_order",
  "ready",
  "issued",
  // Legacy / fallback compatibility
  "diagnostics",
  "approval",
  "in_progress",
  "rejected",
]);

export const repairPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export type RepairStatus = z.infer<typeof repairStatusSchema>;
export type RepairPriority = z.infer<typeof repairPrioritySchema>;

/** Ordered happy path: Принят → Заказ запчастей → Готов → Выдан */
export const REPAIR_STATUS_FLOW: readonly RepairStatus[] = [
  "intake",
  "waiting_parts",
  "ready",
  "issued",
] as const;

/** Allowed transitions between statuses */
const ALLOWED_TRANSITIONS: Record<RepairStatus, readonly RepairStatus[]> = {
  intake: ["waiting_parts", "parts_order", "ready", "issued", "diagnostics", "in_progress", "rejected"],
  waiting_parts: ["ready", "issued", "intake", "rejected"],
  parts_order: ["ready", "issued", "intake", "rejected"],
  ready: ["issued", "waiting_parts", "parts_order", "intake"],
  issued: ["ready", "intake"],
  // Legacy
  diagnostics: ["waiting_parts", "parts_order", "ready", "issued", "approval", "rejected"],
  approval: ["waiting_parts", "parts_order", "ready", "issued", "in_progress", "rejected"],
  in_progress: ["waiting_parts", "parts_order", "ready", "issued", "rejected"],
  rejected: ["intake"],
};

export function canTransition(from: RepairStatus, to: RepairStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(status: RepairStatus): readonly RepairStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

/** Next status on the happy path, or null at a terminal state. */
export function nextStatus(status: RepairStatus): RepairStatus | null {
  const index = REPAIR_STATUS_FLOW.indexOf(status);
  if (index === -1 || index === REPAIR_STATUS_FLOW.length - 1) return null;
  return REPAIR_STATUS_FLOW[index + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

const optionalUuid = z.string().uuid().optional().or(z.literal(""));

export const diagnosticsSchema = z.object({
  findings: z.string().min(1, "Findings are required").max(4000),
  recommended_action: z.string().min(1, "Recommended action is required").max(4000),
  condition_notes: z.string().max(4000).optional().or(z.literal("")),
});

export const additionalContactSchema = z.object({
  name: z.string().min(1, "Имя контакта обязательно").max(200),
  phone: z.string().min(5, "Телефон обязателен").max(30),
  role: z.string().max(100).optional().or(z.literal("")),
});
export type AdditionalContact = z.infer<typeof additionalContactSchema>;

export const createRepairSchema = z.object({
  deal_id: optionalUuid,
  customer_id: optionalUuid,
  customer_name: z.string().min(1, "Customer name is required").max(200),
  customer_phone: z.string().min(5, "Customer phone is required").max(30),
  customer_email: z.string().email("Invalid email").optional().or(z.literal("")),
  additional_contacts: z.array(additionalContactSchema).optional(),
  company_id: optionalUuid,
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: z.string().optional().or(z.literal("")),
  company_ogrn: z.string().optional().or(z.literal("")),
  company_bik: z.string().optional().or(z.literal("")),
  company_account_number: z.string().optional().or(z.literal("")),
  company_legal_address: z.string().max(300).optional().or(z.literal("")),
  equipment_type: z.string().min(1, "Equipment type is required").max(100),
  equipment_brand: z.string().min(1, "Brand is required").max(100),
  equipment_model: z.string().min(1, "Model is required").max(100),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  package_contents_items: z.array(z.string()).optional(),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z
    .string()
    .max(4000)
    .optional()
    .or(z.literal("")),
  malfunctions: z.array(z.string()).optional(),
  defect_photos: z.array(z.string().url("Each photo must be a URL")).max(20).optional(),
  priority: repairPrioritySchema.default("normal"),
  master_id: z.string().uuid("master_id must be a UUID"),
  master_name: z.string().min(1, "Master name is required").max(200),
  estimated_cost: z.number().nonnegative("Estimated cost cannot be negative").default(0),
  notes: z.string().max(4000).optional().or(z.literal("")),
});

export const equipmentIntakeItemSchema = z.object({
  equipment_type: z.string().min(1, "Тип обязателен").max(100),
  equipment_brand: z.string().min(1, "Бренд обязателен").max(100),
  equipment_model: z.string().min(1, "Модель обязательна").max(100),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  package_contents_items: z.array(z.string()).optional(),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z.string().max(4000).optional().or(z.literal("")),
  malfunctions: z.array(z.string()).optional(),
  defect_photos: z.array(z.string()).optional(),
  estimated_cost: z.number().nonnegative().default(0),
  priority: repairPrioritySchema.default("normal"),
  master_id: z.string().uuid("master_id must be a UUID").optional().or(z.literal("")),
  master_name: z.string().optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
});
export type EquipmentIntakeItem = z.infer<typeof equipmentIntakeItemSchema>;

export const createBatchRepairSchema = z.object({
  deal_id: optionalUuid,
  customer_id: optionalUuid,
  customer_name: z.string().min(1, "Customer name is required").max(200),
  customer_phone: z.string().min(5, "Customer phone is required").max(30),
  customer_email: z.string().email("Invalid email").optional().or(z.literal("")),
  additional_contacts: z.array(additionalContactSchema).optional(),
  company_id: optionalUuid,
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: z.string().optional().or(z.literal("")),
  company_ogrn: z.string().optional().or(z.literal("")),
  company_bik: z.string().optional().or(z.literal("")),
  company_account_number: z.string().optional().or(z.literal("")),
  company_legal_address: z.string().max(300).optional().or(z.literal("")),
  equipments: z.array(equipmentIntakeItemSchema).min(1, "Добавьте хотя бы одно оборудование"),
  defect_photos: z.array(z.string()).optional(),
  priority: repairPrioritySchema.default("normal"),
  master_id: z.string().uuid("master_id must be a UUID"),
  master_name: z.string().min(1, "Master name is required").max(200),
  estimated_cost: z.number().nonnegative().default(0),
  notes: z.string().max(4000).optional().or(z.literal("")),
});
export type CreateBatchRepairPayload = z.infer<typeof createBatchRepairSchema>;

export const renameDictionaryItemSchema = z.object({
  name: z.string().min(1, "Наименование не может быть пустым").max(200),
});
export type RenameDictionaryItemPayload = z.infer<typeof renameDictionaryItemSchema>;

export const updateRepairSchema = z.object({
  deal_id: optionalUuid,
  deal_title: z.string().max(300).optional().or(z.literal("")),
  deal_note: z.string().max(4000).optional().or(z.literal("")),
  customer_id: optionalUuid,
  customer_name: z.string().min(1).max(200).optional(),
  customer_phone: z.string().min(5).max(30).optional(),
  customer_email: z.string().email("Invalid email").optional().or(z.literal("")),
  company_id: optionalUuid,
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_inn: z.string().optional().or(z.literal("")),
  additional_contacts: z.array(additionalContactSchema).optional(),
  equipment_type: z.string().min(1).max(100).optional(),
  equipment_brand: z.string().min(1).max(100).optional(),
  equipment_model: z.string().min(1).max(100).optional(),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  package_contents_items: z.array(z.string()).optional(),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z.string().max(4000).optional(),
  malfunctions: z.array(z.string()).optional(),
  priority: repairPrioritySchema.optional(),
  master_id: optionalUuid,
  master_name: z.string().max(200).optional().or(z.literal("")),
  estimated_cost: z.number().nonnegative().optional(),
  final_cost: z.number().nonnegative().optional(),
  notes: z.string().max(4000).optional().or(z.literal("")),
});

export const createRepairServiceCatalogSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  default_price: z.number().nonnegative("Price cannot be negative").default(0),
});
export type CreateRepairServiceCatalogPayload = z.infer<typeof createRepairServiceCatalogSchema>;

export interface RepairServiceCatalogRow {
  id: string;
  tenant_id: string;
  name: string;
  default_price: string;
  created_at: Date | string;
}

export interface RepairServiceCatalogItemDTO {
  id: string;
  name: string;
  defaultPrice: number;
  createdAt: string;
}

export const changeStatusSchema = z.object({
  status: repairStatusSchema,
  comment: z.string().max(2000).optional().or(z.literal("")),
  /** Required when moving diagnostics → approval. */
  diagnostics: diagnosticsSchema.optional(),
});

export const createWorkSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  master_id: z.string().uuid("master_id must be a UUID"),
  master_name: z.string().min(1, "Master name is required").max(200),
  cost: z.number().nonnegative("Cost cannot be negative"),
});

export const updateWorkSchema = createWorkSchema.partial();

export const createPartSchema = z.object({
  name: z.string().min(1, "Part name is required").max(200),
  article: z.string().max(100).optional().or(z.literal("")),
  quantity: z.number().int().positive("Quantity must be at least 1").default(1),
  retail_price: z.number().nonnegative("Retail price cannot be negative"),
  cost_price: z.number().nonnegative("Cost price cannot be negative").default(0),
});

export const updatePartSchema = createPartSchema.partial();

export const createNoteSchema = z.object({
  content: z.string().min(1, "Note content is required").max(4000),
});

export const createPhotoSchema = z.object({
  url: z.string().url("Photo url must be a valid URL").max(500),
  caption: z.string().max(200).optional().or(z.literal("")),
});

export type CreateRepairPayload = z.infer<typeof createRepairSchema>;
export type UpdateRepairPayload = z.infer<typeof updateRepairSchema>;
export type ChangeStatusPayload = z.infer<typeof changeStatusSchema>;
export type CreateWorkPayload = z.infer<typeof createWorkSchema>;
export type UpdateWorkPayload = z.infer<typeof updateWorkSchema>;
export type CreatePartPayload = z.infer<typeof createPartSchema>;
export type UpdatePartPayload = z.infer<typeof updatePartSchema>;
export type CreateNotePayload = z.infer<typeof createNoteSchema>;
export type CreatePhotoPayload = z.infer<typeof createPhotoSchema>;
export type DiagnosticsPayload = z.infer<typeof diagnosticsSchema>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface DiagnosticsData {
  performed_at: string;
  performed_by: string;
  findings: string;
  recommended_action: string;
  condition_notes: string;
}

export interface RepairOrderRow {
  id: string;
  tenant_id: string;
  ticket_number: string;
  deal_id: string | null;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  equipment_type: string;
  equipment_brand: string;
  equipment_model: string;
  equipment_serial: string;
  package_contents: string;
  package_contents_items?: string[];
  appearance: string;
  defect_description: string;
  malfunctions?: string[];
  defect_photos: string[];
  additional_contacts?: AdditionalContact[];
  status: RepairStatus;
  priority: RepairPriority;
  master_id: string;
  master_name: string;
  estimated_cost: string;
  final_cost: string | null;
  notes: string;
  diagnostics: DiagnosticsData | null;
  received_at: Date | string;
  completed_at: Date | string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deal_title?: string | null;
  deal_notes?: string | null;
  deal_budget?: string | number | null;
  deal_stage_name?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  company_inn?: string | null;
  customer_email?: string | null;
}

export interface RepairWorkRow {
  id: string;
  repair_order_id: string;
  description: string;
  master_id: string;
  master_name: string;
  cost: string;
  created_at: Date | string;
}

export interface RepairPartRow {
  id: string;
  repair_order_id: string;
  name: string;
  article: string;
  quantity: number;
  retail_price: string;
  cost_price: string;
  created_at: Date | string;
}

export interface RepairNoteRow {
  id: string;
  repair_order_id: string;
  author_id: string;
  author_name: string;
  kind: string;
  content: string;
  from_status: string | null;
  to_status: string | null;
  created_at: Date | string;
}

export interface RepairPhotoRow {
  id: string;
  repair_order_id: string;
  url: string;
  caption: string;
  uploaded_by: string;
  created_at: Date | string;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface RepairWorkDTO {
  id: string;
  description: string;
  masterId: string;
  masterName: string;
  cost: number;
  createdAt: string;
}

export interface RepairPartDTO {
  id: string;
  name: string;
  article: string;
  quantity: number;
  retailPrice: number;
  costPrice: number;
  /** retailPrice × quantity */
  retailTotal: number;
  /** costPrice × quantity */
  costTotal: number;
  /** retailTotal − costTotal */
  margin: number;
  createdAt: string;
}

export interface RepairNoteDTO {
  id: string;
  authorId: string;
  authorName: string;
  kind: string;
  content: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface RepairPhotoDTO {
  id: string;
  url: string;
  caption: string;
  uploadedBy: string;
  createdAt: string;
}

/** Money breakdown for a repair order. */
export interface RepairTotalsDTO {
  worksTotal: number;
  partsRetailTotal: number;
  partsCostTotal: number;
  grandTotal: number;
  /** grandTotal − partsCostTotal */
  margin: number;
  /** margin ÷ grandTotal, as a percentage rounded to 1 decimal. */
  marginPercent: number;
}

export interface RepairOrderDTO {
  id: string;
  ticketNumber: string;
  dealId: string | null;
  dealTitle?: string | null;
  dealNote?: string | null;
  dealBudget?: number | null;
  dealStageName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  companyInn?: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  equipment: {
    type: string;
    brand: string;
    model: string;
    serialNumber: string;
    packageContents: string;
    packageContentsItems?: string[];
    appearance: string;
  };
  defectDescription: string;
  malfunctions?: string[];
  defectPhotos: string[];
  additionalContacts?: AdditionalContact[];
  status: RepairStatus;
  nextStatus: RepairStatus | null;
  allowedTransitions: RepairStatus[];
  priority: RepairPriority;
  masterId: string;
  masterName: string;
  estimatedCost: number;
  finalCost: number | null;
  notes: string;
  diagnostics: DiagnosticsData | null;
  receivedAt: string;
  completedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepairOrderDetailDTO extends RepairOrderDTO {
  works: RepairWorkDTO[];
  parts: RepairPartDTO[];
  notes_log: RepairNoteDTO[];
  photos: RepairPhotoDTO[];
  totals: RepairTotalsDTO;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

export function toRepairOrderDTO(row: RepairOrderRow): RepairOrderDTO {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    dealId: row.deal_id ?? null,
    dealTitle: row.deal_title ?? null,
    dealNote: row.deal_notes ?? null,
    dealBudget: row.deal_budget !== undefined && row.deal_budget !== null ? Number(row.deal_budget) : null,
    dealStageName: row.deal_stage_name ?? null,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    companyInn: row.company_inn ?? null,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email ?? null,
    equipment: {
      type: row.equipment_type,
      brand: row.equipment_brand,
      model: row.equipment_model,
      serialNumber: row.equipment_serial,
      packageContents: row.package_contents,
      packageContentsItems: Array.isArray(row.package_contents_items) ? row.package_contents_items : [],
      appearance: row.appearance,
    },
    defectDescription: row.defect_description,
    malfunctions: Array.isArray(row.malfunctions) ? row.malfunctions : [],
    defectPhotos: row.defect_photos,
    additionalContacts: Array.isArray(row.additional_contacts) ? row.additional_contacts : [],
    status: row.status,
    nextStatus: nextStatus(row.status),
    allowedTransitions: [...allowedTransitionsFrom(row.status)],
    priority: row.priority,
    masterId: row.master_id,
    masterName: row.master_name,
    estimatedCost: Number(row.estimated_cost),
    finalCost: row.final_cost === null ? null : Number(row.final_cost),
    notes: row.notes,
    diagnostics: row.diagnostics,
    receivedAt: toIso(row.received_at),
    completedAt: toIsoOrNull(row.completed_at),
    deliveredAt: toIsoOrNull(row.delivered_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function toRepairWorkDTO(row: RepairWorkRow): RepairWorkDTO {
  return {
    id: row.id,
    description: row.description,
    masterId: row.master_id,
    masterName: row.master_name,
    cost: Number(row.cost),
    createdAt: toIso(row.created_at),
  };
}

export function toRepairPartDTO(row: RepairPartRow): RepairPartDTO {
  const retailPrice = Number(row.retail_price);
  const costPrice = Number(row.cost_price);
  const retailTotal = retailPrice * row.quantity;
  const costTotal = costPrice * row.quantity;

  return {
    id: row.id,
    name: row.name,
    article: row.article,
    quantity: row.quantity,
    retailPrice,
    costPrice,
    retailTotal,
    costTotal,
    margin: retailTotal - costTotal,
    createdAt: toIso(row.created_at),
  };
}

export function toRepairNoteDTO(row: RepairNoteRow): RepairNoteDTO {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    kind: row.kind,
    content: row.content,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    createdAt: toIso(row.created_at),
  };
}

export function toRepairPhotoDTO(row: RepairPhotoRow): RepairPhotoDTO {
  return {
    id: row.id,
    url: row.url,
    caption: row.caption,
    uploadedBy: row.uploaded_by,
    createdAt: toIso(row.created_at),
  };
}

export interface ClientLookupDealDTO {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  pipelineId: string;
  pipelineName: string;
  createdAt: string;
  ownerName: string | null;
}

export interface ClientLookupResultDTO {
  found: boolean;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    middleName: string;
    phone: string;
    email: string | null;
    companyId: string | null;
    companyName: string | null;
  } | null;
  company: {
    id: string;
    name: string;
    inn: string;
    ogrn: string;
    bik: string;
    accountNumber: string;
    legalAddress: string;
  } | null;
  activeDeals: ClientLookupDealDTO[];
}

export interface DictionaryItemDTO {
  id: string;
  name: string;
  brandName?: string;
}

export interface ServiceDictionariesDTO {
  types: DictionaryItemDTO[];
  brands: DictionaryItemDTO[];
  models: DictionaryItemDTO[];
  accessories: DictionaryItemDTO[];
  malfunctions: DictionaryItemDTO[];
}

export interface EquipmentHistoryItemDTO {
  id: string;
  ticketNumber: string;
  receivedAt: string;
  completedAt: string | null;
  deliveredAt: string | null;
  status: string;
  defectDescription: string;
  malfunctions: string[];
  estimatedCost: number;
  finalCost: number | null;
  masterName: string;
}

export interface EquipmentSearchSerialResultDTO {
  found: boolean;
  equipment: {
    type: string;
    brand: string;
    model: string;
    serial: string;
    packageContents: string[];
  } | null;
  customer: {
    id: string;
    name: string;
    phone: string;
  } | null;
  historyCount: number;
  history: EquipmentHistoryItemDTO[];
}

/** Sums works and parts into the order's money breakdown. */
export function calculateTotals(
  works: RepairWorkDTO[],
  parts: RepairPartDTO[],
): RepairTotalsDTO {
  const worksTotal = works.reduce((sum, work) => sum + work.cost, 0);
  const partsRetailTotal = parts.reduce((sum, part) => sum + part.retailTotal, 0);
  const partsCostTotal = parts.reduce((sum, part) => sum + part.costTotal, 0);
  const grandTotal = worksTotal + partsRetailTotal;
  const margin = grandTotal - partsCostTotal;

  return {
    worksTotal,
    partsRetailTotal,
    partsCostTotal,
    grandTotal,
    margin,
    marginPercent: grandTotal === 0 ? 0 : Math.round((margin / grandTotal) * 1000) / 10,
  };
}
