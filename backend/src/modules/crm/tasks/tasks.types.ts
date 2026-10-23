import { z } from "zod";

export const taskPrioritySchema = z.enum(["low", "medium", "high"]);
export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);
export const linkedEntityTypeSchema = z.enum(["deal", "contact", "company"]);

const optionalDateTime = z.string().datetime("Use an ISO 8601 timestamp").optional().or(z.literal(""));

/**
 * A task may be linked to at most one CRM entity. The pair is validated
 * together so a type never arrives without its id (or the other way round).
 */
const linkedEntityRefinement = <T extends { linked_entity_type?: string; linked_entity_id?: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  const hasType = value.linked_entity_type !== undefined && value.linked_entity_type !== "";
  const hasId = value.linked_entity_id !== undefined && value.linked_entity_id !== "";

  if (hasType !== hasId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "linked_entity_type and linked_entity_id must be provided together",
      path: [hasType ? "linked_entity_id" : "linked_entity_type"],
    });
  }
};

export const createTaskSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(4000).optional().or(z.literal("")),
    priority: taskPrioritySchema.default("medium"),
    status: taskStatusSchema.default("todo"),
    due_date: optionalDateTime,
    assignee_id: z.string().uuid("assignee_id must be a UUID"),
    linked_entity_type: linkedEntityTypeSchema.optional().or(z.literal("")),
    linked_entity_id: z.string().uuid().optional().or(z.literal("")),
    deal_id: z.string().uuid().optional().nullable().or(z.literal("")),
    contact_id: z.string().uuid().optional().nullable().or(z.literal("")),
    company_id: z.string().uuid().optional().nullable().or(z.literal("")),
    notify_telegram: z.boolean().optional().default(false),
  })
  .superRefine(linkedEntityRefinement);

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional().or(z.literal("")),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    due_date: optionalDateTime,
    assignee_id: z.string().uuid().optional(),
    linked_entity_type: linkedEntityTypeSchema.optional().or(z.literal("")),
    linked_entity_id: z.string().uuid().optional().or(z.literal("")),
    deal_id: z.string().uuid().optional().nullable().or(z.literal("")),
    contact_id: z.string().uuid().optional().nullable().or(z.literal("")),
    company_id: z.string().uuid().optional().nullable().or(z.literal("")),
    completed_at: optionalDateTime,
  })
  .superRefine(linkedEntityRefinement);

export const toggleTaskStatusSchema = z.object({ status: taskStatusSchema });

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export type UpdateTaskPayload = z.infer<typeof updateTaskSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type LinkedEntityType = z.infer<typeof linkedEntityTypeSchema>;

export interface TaskRow {
  id: string;
  tenant_id: string;
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: Date | string | null;
  assignee_id: string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TaskDTO {
  id: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  linkedEntityType: LinkedEntityType | null;
  linkedEntityId: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  assigneeId: string;
  completedAt: string | null;
  /** Derived: past due and not yet done. */
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

/** Collapses the three nullable FK columns into a single logical link. */
function resolveLink(row: TaskRow): { type: LinkedEntityType | null; id: string | null } {
  if (row.deal_id !== null) return { type: "deal", id: row.deal_id };
  if (row.contact_id !== null) return { type: "contact", id: row.contact_id };
  if (row.company_id !== null) return { type: "company", id: row.company_id };
  return { type: null, id: null };
}

export function toTaskDTO(row: TaskRow): TaskDTO {
  const link = resolveLink(row);
  const dueDate = toIsoOrNull(row.due_date);

  return {
    id: row.id,
    dealId: row.deal_id,
    contactId: row.contact_id,
    companyId: row.company_id,
    linkedEntityType: link.type,
    linkedEntityId: link.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueDate,
    assigneeId: row.assignee_id,
    completedAt: toIsoOrNull(row.completed_at),
    isOverdue: dueDate !== null && row.status !== "done" && new Date(dueDate).getTime() < Date.now(),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
