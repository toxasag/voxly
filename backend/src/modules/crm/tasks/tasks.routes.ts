import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TasksService } from "./tasks.service.js";
import { TaskRemindersService } from "./task-reminders.service.js";
import {
  createTaskSchema,
  linkedEntityTypeSchema,
  taskPrioritySchema,
  taskStatusSchema,
  toggleTaskStatusSchema,
  updateTaskSchema,
} from "./tasks.types.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";

const listQuerySchema = z
  .object({
    filter: z.enum(["today", "overdue", "upcoming", "my", "unassigned"]).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    assignee_id: z.string().uuid().optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    linked_entity_type: linkedEntityTypeSchema.optional(),
    linked_entity_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(500).default(25),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .refine(
    (value) =>
      (value.linked_entity_type === undefined) === (value.linked_entity_id === undefined),
    { message: "linked_entity_type and linked_entity_id must be used together" },
  );

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  const service = new TasksService();

  const canRead = app.requirePermission("tasks:read");
  const canWrite = app.requirePermission("tasks:write");

  app.get("", { onRequest: canRead }, async (request, reply) => {
    const params = listQuerySchema.parse(request.query);

    const { items, total } = await service.list(request.tenant_id, {
      filter: params.filter,
      search: params.search,
      assigneeId: params.assignee_id,
      priority: params.priority,
      status: params.status,
      linkedEntityType: params.linked_entity_type,
      linkedEntityId: params.linked_entity_id,
      currentUserId: request.authUser.id,
      limit: params.limit,
      offset: params.offset,
    });

    return reply.send({
      data: items,
      meta: { limit: params.limit, offset: params.offset, total, filter: params.filter ?? null },
    });
  });

  const remindersService = new TaskRemindersService();

  app.get("/reminders/due", { onRequest: canRead }, async (request, reply) => {
    const hours = z.coerce.number().positive().max(168).default(24).parse((request.query as { hours?: unknown }).hours);
    const tasks = await remindersService.getDueTasks(
      request.tenant_id,
      request.authUser.id,
      hours,
    );
    return reply.send({ data: tasks, meta: { total: tasks.length } });
  });

  app.post("/reminders/check", { onRequest: canWrite }, async (request, reply) => {
    const result = await remindersService.checkAndDispatchReminders(request.tenant_id);
    return reply.send({ data: result });
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const task = await service.get(request.tenant_id, id);

    if (task === null) throw new NotFoundError("Task not found");

    return reply.send({ data: task });
  });

  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const task = await service.create(request.tenant_id, body);

    return reply.status(201).send({ data: task });
  });

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateTaskSchema.parse(request.body);
    const task = await service.update(request.tenant_id, id, body);

    if (task === null) throw new NotFoundError("Task not found");

    return reply.send({ data: task });
  });

  app.patch("/:id/status", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { status } = toggleTaskStatusSchema.parse(request.body);
    const task = await service.setStatus(request.tenant_id, id, status);

    if (task === null) throw new NotFoundError("Task not found");

    return reply.send({ data: task });
  });

  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const deleted = await service.softDelete(request.tenant_id, id);

    if (!deleted) throw new NotFoundError("Task not found");

    return reply.status(204).send();
  });
}
