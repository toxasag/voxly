import { z } from "zod";

// ---------------------------------------------------------------------------
// Задачи. Держится в шаге с backend/src/modules/crm/tasks/tasks.types.ts:
// связь с записью задаётся парой linked_entity_type + linked_entity_id, и
// сервер отклоняет payload, где заполнено только одно из двух.
// ---------------------------------------------------------------------------

export const taskPrioritySchema = z.enum(["low", "medium", "high"]);
export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);
export const linkedEntityTypeSchema = z.enum(["deal", "contact", "company"]);

export const createTaskSchema = z
  .object({
    title: z.string().min(1, "Название обязательно").max(200),
    description: z.string().max(4000).optional().or(z.literal("")),
    priority: taskPrioritySchema.default("medium"),
    status: taskStatusSchema.default("todo"),
    /**
     * Значение из <input type="datetime-local"> («2026-01-01T12:00») в ISO не
     * проходит: у него нет зоны. Приведение делает форма перед отправкой, здесь
     * достаточно проверить, что дата разбирается.
     */
    due_date: z
      .string()
      .refine((value) => value === "" || !Number.isNaN(new Date(value).getTime()), "Некорректная дата")
      .optional()
      .or(z.literal("")),
    assignee_id: z.string().uuid("Выберите ответственного"),
    linked_entity_type: linkedEntityTypeSchema.optional().or(z.literal("")),
    linked_entity_id: z.string().uuid("Выберите запись").optional().or(z.literal("")),
    deal_id: z.string().uuid().optional().nullable().or(z.literal("")),
    contact_id: z.string().uuid().optional().nullable().or(z.literal("")),
    company_id: z.string().uuid().optional().nullable().or(z.literal("")),
    notify_telegram: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasType = value.linked_entity_type !== undefined && value.linked_entity_type !== "";
    const hasId = value.linked_entity_id !== undefined && value.linked_entity_id !== "";

    if (hasType !== hasId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasType ? "linked_entity_id" : "linked_entity_type"],
        message: hasType ? "Выберите запись для связи" : "Выберите тип связи",
      });
    }
  });

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export type TaskPriorityValue = z.infer<typeof taskPrioritySchema>;
export type TaskStatusValue = z.infer<typeof taskStatusSchema>;
