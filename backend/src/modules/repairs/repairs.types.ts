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
  "diagnostics",
  "approval",
  "in_progress",
  "ready",
  "issued",
  "rejected",
]);

export const repairPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export type RepairStatus = z.infer<typeof repairStatusSchema>;
export type RepairPriority = z.infer<typeof repairPrioritySchema>;

/** Ordered happy path used to derive the next step and render the stepper. */
export const REPAIR_STATUS_FLOW: readonly RepairStatus[] = [
  "intake",
  "diagnostics",
  "approval",
  "in_progress",
  "ready",
  "issued",
] as const;

/** Allowed transitions. Anything not listed here is rejected with 409. */
const ALLOWED_TRANSITIONS: Record<RepairStatus, readonly RepairStatus[]> = {
  intake: ["diagnostics", "rejected"],
  diagnostics: ["approval", "rejected"],
  approval: ["in_progress", "rejected"],
  in_progress: ["ready", "rejected"],
  ready: ["issued"],
  issued: [],
  rejected: [],
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

export const createRepairSchema = z.object({
  customer_id: z.string().uuid("customer_id must be a UUID"),
  customer_name: z.string().min(1, "Customer name is required").max(200),
  customer_phone: z.string().min(5, "Customer phone is required").max(30),
  equipment_type: z.string().min(1, "Equipment type is required").max(100),
  equipment_brand: z.string().min(1, "Brand is required").max(100),
  equipment_model: z.string().min(1, "Model is required").max(100),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z
    .string()
    .min(10, "Describe the defect in at least 10 characters")
    .max(4000),
  defect_photos: z.array(z.string().url("Each photo must be a URL")).max(20).optional(),
  priority: repairPrioritySchema.default("normal"),
  master_id: z.string().uuid("master_id must be a UUID"),
  master_name: z.string().min(1, "Master name is required").max(200),
  estimated_cost: z.number().nonnegative("Estimated cost cannot be negative").default(0),
  notes: z.string().max(4000).optional().or(z.literal("")),
});

export const updateRepairSchema = z.object({
  customer_name: z.string().min(1).max(200).optional(),
  customer_phone: z.string().min(5).max(30).optional(),
  equipment_type: z.string().min(1).max(100).optional(),
  equipment_brand: z.string().min(1).max(100).optional(),
  equipment_model: z.string().min(1).max(100).optional(),
  equipment_serial: z.string().max(100).optional().or(z.literal("")),
  package_contents: z.string().max(1000).optional().or(z.literal("")),
  appearance: z.string().max(1000).optional().or(z.literal("")),
  defect_description: z.string().min(10).max(4000).optional(),
  priority: repairPrioritySchema.optional(),
  master_id: optionalUuid,
  master_name: z.string().max(200).optional().or(z.literal("")),
  estimated_cost: z.number().nonnegative().optional(),
  final_cost: z.number().nonnegative().optional(),
  notes: z.string().max(4000).optional().or(z.literal("")),
});

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
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  equipment_type: string;
  equipment_brand: string;
  equipment_model: string;
  equipment_serial: string;
  package_contents: string;
  appearance: string;
  defect_description: string;
  defect_photos: string[];
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
  customerId: string;
  customerName: string;
  customerPhone: string;
  equipment: {
    type: string;
    brand: string;
    model: string;
    serialNumber: string;
    packageContents: string;
    appearance: string;
  };
  defectDescription: string;
  defectPhotos: string[];
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

export function toRepairOrderDTO(row: RepairOrderRow): RepairOrderDTO {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    equipment: {
      type: row.equipment_type,
      brand: row.equipment_brand,
      model: row.equipment_model,
      serialNumber: row.equipment_serial,
      packageContents: row.package_contents,
      appearance: row.appearance,
    },
    defectDescription: row.defect_description,
    defectPhotos: row.defect_photos,
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
