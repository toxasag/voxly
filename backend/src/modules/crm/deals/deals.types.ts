import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Optional UUID that also tolerates "" from HTML form payloads. */
const optionalUuid = z.string().uuid().optional().or(z.literal(""));

/** Дата без времени: `close_date` — календарный срок, а не момент. */
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal(""));

export const createDealSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  budget: z.number().nonnegative("Budget cannot be negative").default(0),
  currency: z.string().length(3, "Use a 3-letter currency code").default("RUB"),
  pipeline_id: z.string().uuid("pipeline_id must be a UUID"),
  stage_id: z.string().uuid("stage_id must be a UUID"),
  contact_id: optionalUuid,
  company_id: optionalUuid,
  owner_id: optionalUuid,
  close_date: optionalDate,
  custom_fields: z.record(z.unknown()).optional(),
});

export const updateDealSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().or(z.literal("")),
  budget: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  stage_id: z.string().uuid().optional(),
  contact_id: optionalUuid,
  company_id: optionalUuid,
  owner_id: optionalUuid,
  close_date: optionalDate,
  position: z.number().optional(),
  custom_fields: z.record(z.unknown()).optional(),
  closed_at: z.string().datetime().optional().or(z.literal("")),
});

export const moveDealStageSchema = z.object({
  stage_id: z.string().uuid("stage_id must be a UUID"),
  /** Индекс места в целевой колонке при перетаскивании; без него — в начало. */
  target_index: z.number().int().nonnegative().optional(),
});

/**
 * Цвета колонок канбана — фиксированный набор ключей, а не произвольный CSS:
 * фронтенд маппит ключ в готовые классы Tailwind, динамические имена классов
 * не компилируются. `slate` — цвет существующих стадий до правки.
 */
export const stageColorSchema = z.enum([
  "amber", "emerald", "sky", "rose", "violet", "orange", "cyan", "slate",
]);
export type StageColor = z.infer<typeof stageColorSchema>;

export const createStageSchema = z.object({
  name: z.string().min(1, "Stage name is required").max(100),
  color: stageColorSchema.default("slate"),
});

export const updateStageSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: stageColorSchema.optional(),
  sort_order: z.number().int().nonnegative().optional(),
});

export const messageSourceSchema = z.enum(["human", "manager", "client", "ai", "ai_bot", "system"]);
export const messageDirectionSchema = z.enum(["inbound", "outbound", "neutral"]);

export const createDealMessageSchema = z.object({
  source: messageSourceSchema.default("manager"),
  direction: messageDirectionSchema.default("outbound"),
  content: z.string().min(1, "Message content is required").max(8000),
  channel: z.string().max(50).default("system"),
  channel_account_id: z.string().uuid().optional().or(z.literal("")),
  attachment: z.string().max(500).optional().or(z.literal("")),
  attachment_type: z.string().max(50).optional().or(z.literal("")),
});

export type CreateDealPayload = z.infer<typeof createDealSchema>;
export type UpdateDealPayload = z.infer<typeof updateDealSchema>;
export type MoveDealStagePayload = z.infer<typeof moveDealStageSchema>;
export type CreateDealMessagePayload = z.infer<typeof createDealMessageSchema>;
export type MessageSource = z.infer<typeof messageSourceSchema>;
export type MessageDirection = z.infer<typeof messageDirectionSchema>;
export type CreateStagePayload = z.infer<typeof createStageSchema>;
export type UpdateStagePayload = z.infer<typeof updateStageSchema>;

// ---------------------------------------------------------------------------
// Rows & DTOs
// ---------------------------------------------------------------------------

export interface DealRow {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  company_id: string | null;
  title: string;
  description: string;
  /** NUMERIC arrives from pg as a string. */
  budget: string;
  currency: string;
  custom_fields: Record<string, unknown>;
  created_by: string;
  owner_id: string | null;
  close_date: Date | string | null;
  /** DOUBLE PRECISION приходит числом. */
  position: number;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /**
   * Метки связей приходят JOIN'ом в том же запросе.
   *
   * Без них таблица записей рисовала бы чипы «компания» и «контактное лицо» по
   * отдельному запросу на строку — тот самый N+1, из-за которого список из 50
   * сделок стоил бы 100 запросов.
   */
  company_name?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
  company_domain_name?: string | null;
  company_city?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_job_title?: string | null;
  contact_is_personal?: boolean | null;
  owner_name?: string | null;
  latest_note_body?: string | null;
  tasks_count?: string | number | null;
  pending_tasks_count?: string | number | null;
  next_task_title?: string | null;
  next_task_due_date?: Date | string | null;
}

export interface DealDTO {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  title: string;
  description: string;
  budget: number;
  currency: string;
  customFields: Record<string, unknown>;
  createdBy: string;
  ownerId: string | null;
  closeDate: string | null;
  position: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Денормализованные подписи связей для таблицы и канбана. */
  companyName: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyCity?: string | null;
  contactName: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactJobTitle?: string | null;
  contactIsPersonal?: boolean;
  ownerName: string | null;
  latestNote: string | null;
  tasksCount?: number;
  pendingTasksCount?: number;
  nextTaskTitle?: string | null;
  nextTaskDueDate?: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

/** `DATE` из pg приходит объектом Date; наружу отдаём только календарную часть. */
function toDateOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function joinName(first: string | null | undefined, last: string | null | undefined): string | null {
  const full = `${first ?? ""} ${last ?? ""}`.trim();
  return full.length > 0 ? full : null;
}

export function toDealDTO(row: DealRow): DealDTO {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    contactId: row.contact_id,
    companyId: row.company_id,
    title: row.title,
    description: row.description,
    budget: Number(row.budget),
    currency: row.currency,
    customFields: row.custom_fields,
    createdBy: row.created_by,
    ownerId: row.owner_id,
    closeDate: toDateOrNull(row.close_date),
    position: Number(row.position),
    closedAt: toIsoOrNull(row.closed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    companyName: row.company_name ?? null,
    companyPhone: row.company_phone || null,
    companyEmail: row.company_email || null,
    companyWebsite: row.company_domain_name || null,
    companyCity: row.company_city || null,
    contactName: joinName(row.contact_first_name, row.contact_last_name),
    contactPhone: row.contact_phone || null,
    contactEmail: row.contact_email || null,
    contactJobTitle: row.contact_job_title || null,
    contactIsPersonal: Boolean(row.contact_is_personal),
    ownerName: row.owner_name ?? null,
    latestNote: row.latest_note_body ?? null,
    tasksCount: Number(row.tasks_count ?? 0),
    pendingTasksCount: Number(row.pending_tasks_count ?? 0),
    nextTaskTitle: row.next_task_title || null,
    nextTaskDueDate: toIsoOrNull(row.next_task_due_date ?? null),
  };
}

/**
 * Состояние доставки исходящего сообщения в канал.
 *
 * `neutral` — доставлять некуда (входящее от клиента, системная запись).
 * `pending` — строка записана, транспорт ещё не подтвердил. `failed` держит
 * причину в `delivery_error`: неотправленное сообщение обязано отличаться в
 * таймлайне от отправленного, иначе менеджер ждёт ответа на то, что не ушло.
 */
export const deliveryStatusSchema = z.enum(["neutral", "pending", "sent", "failed"]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export interface DealMessageRow {
  id: string;
  tenant_id: string;
  deal_id: string;
  channel_account_id: string | null;
  source: string;
  direction: string;
  sender_name: string;
  content: string;
  channel: string;
  attachment: string | null;
  attachment_type: string | null;
  delivery_status: string;
  delivery_error: string | null;
  created_at: Date | string;
}

export interface DealMessageDTO {
  id: string;
  dealId: string;
  channelAccountId: string | null;
  source: string;
  direction: string;
  senderName: string;
  content: string;
  channel: string;
  attachment: string | null;
  attachmentType: string | null;
  deliveryStatus: DeliveryStatus;
  deliveryError: string | null;
  createdAt: string;
}

/** Значение из БД сужается разбором схемы, а не приведением типа. */
function toDeliveryStatus(value: string): DeliveryStatus {
  const parsed = deliveryStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "neutral";
}

export function toDealMessageDTO(row: DealMessageRow): DealMessageDTO {
  return {
    id: row.id,
    dealId: row.deal_id,
    channelAccountId: row.channel_account_id,
    source: row.source,
    direction: row.direction,
    senderName: row.sender_name,
    content: row.content,
    channel: row.channel,
    attachment: row.attachment,
    attachmentType: row.attachment_type,
    deliveryStatus: toDeliveryStatus(row.delivery_status),
    deliveryError: row.delivery_error,
    createdAt: toIso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Kanban projection
// ---------------------------------------------------------------------------

export interface KanbanColumn {
  stageId: string;
  stageName: string;
  sortOrder: number;
  isWon: boolean;
  isLost: boolean;
  /** Системный этап: вход в воронку, «успех» или «провал». Не правится и не двигается. */
  isSystem: boolean;
  stageColor: StageColor;
  dealCount: number;
  budgetTotal: number;
  deals: DealDTO[];
}

/** Tenant-scoped pipeline catalog used to select the Kanban projection. */
export interface PipelineDTO {
  id: string;
  name: string;
  sortOrder: number;
}

export interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  is_system: boolean;
  color: StageColor;
}
