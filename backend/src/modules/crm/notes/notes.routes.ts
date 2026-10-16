import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { NotesService } from "./notes.service.js";
import { createNoteSchema, noteTargetTypeSchema, updateNoteSchema } from "./notes.types.js";
import type { NoteTargetType } from "./notes.types.js";
import { PermissionDeniedError, NotFoundError } from "../../../plugins/errorHandler.js";
import type { Permission } from "../../../types/index.js";

const listQuerySchema = z.object({
  target_type: noteTargetTypeSchema,
  target_id: z.string().uuid("target_id must be a UUID"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

/**
 * Права на заметку наследуются от записи, к которой она прикреплена.
 *
 * Отдельного `notes:*` нет намеренно: заметка о контакте — часть данных этого
 * контакта, и читать её должен тот, кто имеет доступ к контакту. Своё право
 * пришлось бы отдельно выдавать каждой роли, и оно неизбежно расходилось бы с
 * доступом к самой записи.
 */
const READ_PERMISSION: Record<NoteTargetType, Permission> = {
  contact: "contacts:read",
  company: "companies:read",
  deal: "deals:read",
};

const WRITE_PERMISSION: Record<NoteTargetType, Permission> = {
  contact: "contacts:write",
  company: "companies:write",
  deal: "deals:write",
};

function assertPermission(request: FastifyRequest, permission: Permission): void {
  if (!request.permissions.has(permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}`);
  }
}

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  const service = new NotesService();

  app.get("", async (request, reply) => {
    const params = listQuerySchema.parse(request.query);
    assertPermission(request, READ_PERMISSION[params.target_type]);

    const { items, total } = await service.listByTarget(request.tenant_id, {
      targetType: params.target_type,
      targetId: params.target_id,
      limit: params.limit,
      offset: params.offset,
    });

    return reply.send({
      data: items,
      meta: { limit: params.limit, offset: params.offset, total },
    });
  });

  app.post("", async (request, reply) => {
    const body = createNoteSchema.parse(request.body);
    assertPermission(request, WRITE_PERMISSION[body.target_type]);

    const note = await service.create(request.tenant_id, body, request.authUser.id);

    // null означает, что целевой записи нет в этом тенанте — для клиента это
    // именно 404 по цели, а не отказ в правах.
    if (note === null) throw new NotFoundError(`${body.target_type} not found`);

    return reply.status(201).send({ data: note });
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateNoteSchema.parse(request.body);

    // Право проверяется по существующей заметке: тип цели известен только из неё,
    // и до чтения понять, какое право требуется, невозможно.
    const existing = await service.get(request.tenant_id, id);
    if (existing === null) throw new NotFoundError("Note not found");
    assertPermission(request, WRITE_PERMISSION[existing.targetType]);

    const note = await service.update(request.tenant_id, id, body);
    if (note === null) throw new NotFoundError("Note not found");

    return reply.send({ data: note });
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);

    const existing = await service.get(request.tenant_id, id);
    if (existing === null) throw new NotFoundError("Note not found");
    assertPermission(request, WRITE_PERMISSION[existing.targetType]);

    const deleted = await service.softDelete(request.tenant_id, id);
    if (!deleted) throw new NotFoundError("Note not found");

    return reply.status(204).send();
  });
}
