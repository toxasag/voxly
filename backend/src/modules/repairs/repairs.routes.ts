import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepairsService } from "./repairs.service.js";
import {
  changeStatusSchema,
  createNoteSchema,
  createPartSchema,
  createPhotoSchema,
  createRepairSchema,
  createWorkSchema,
  repairPrioritySchema,
  repairStatusSchema,
  updatePartSchema,
  updateRepairSchema,
  updateWorkSchema,
} from "./repairs.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { NotFoundError } from "../../plugins/errorHandler.js";

const listQuerySchema = z.object({
  status: repairStatusSchema.optional(),
  priority: repairPrioritySchema.optional(),
  master_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

const nestedParamsSchema = z.object({
  id: z.string().uuid("id must be a UUID"),
  itemId: z.string().uuid("itemId must be a UUID"),
});

/**
 * Service Center route group. Mounted at /api/v1/repairs by app.ts.
 *
 * Every route requires authentication, the `service_center` module to be
 * installed for the tenant, and the matching service_center permission.
 */
export default async function repairsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new RepairsService();

  const moduleInstalled = app.requireModule("service_center");
  const canRead = [moduleInstalled, app.requirePermission("service_center:read")];
  const canWrite = [moduleInstalled, app.requirePermission("service_center:write")];

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  app.get("", { onRequest: canRead }, async (request, reply) => {
    const params = listQuerySchema.parse(request.query);

    const { items, total } = await service.list(request.tenant_id, {
      status: params.status,
      priority: params.priority,
      masterId: params.master_id,
      customerId: params.customer_id,
      search: params.search,
      limit: params.limit,
      offset: params.offset,
    });

    return reply.send({
      data: items,
      meta: { limit: params.limit, offset: params.offset, total },
    });
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const order = await service.getDetail(request.tenant_id, id);

    if (order === null) throw new NotFoundError("Repair order not found");

    return reply.send({ data: order });
  });

  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createRepairSchema.parse(request.body);

    const order = await service.create(
      request.tenant_id,
      { id: request.authUser.id, name: request.authUser.name },
      body,
    );

    return reply.status(201).send({ data: order });
  });

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateRepairSchema.parse(request.body);
    const order = await service.update(request.tenant_id, id, body);

    if (order === null) throw new NotFoundError("Repair order not found");

    return reply.send({ data: order });
  });

  // PATCH /repairs/:id/status — 6-step workflow transition
  app.patch("/:id/status", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = changeStatusSchema.parse(request.body);

    const order = await service.changeStatus(
      request.tenant_id,
      id,
      { id: request.authUser.id, name: request.authUser.name },
      body,
    );

    if (order === null) throw new NotFoundError("Repair order not found");

    return reply.send({ data: order });
  });

  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const deleted = await service.softDelete(request.tenant_id, id);

    if (!deleted) throw new NotFoundError("Repair order not found");

    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // Totals
  // -------------------------------------------------------------------------

  app.get("/:id/totals", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const order = await service.get(request.tenant_id, id);

    if (order === null) throw new NotFoundError("Repair order not found");

    const totals = await service.totals(request.tenant_id, id);

    return reply.send({ data: totals });
  });

  // -------------------------------------------------------------------------
  // Works
  // -------------------------------------------------------------------------

  app.get("/:id/works", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const works = await service.listWorks(request.tenant_id, id);

    return reply.send({ data: works, meta: { total: works.length } });
  });

  app.post("/:id/works", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createWorkSchema.parse(request.body);
    const work = await service.addWork(request.tenant_id, id, body);

    return reply.status(201).send({
      data: work,
      meta: { totals: await service.totals(request.tenant_id, id) },
    });
  });

  app.patch("/:id/works/:itemId", { onRequest: canWrite }, async (request, reply) => {
    const { id, itemId } = nestedParamsSchema.parse(request.params);
    const body = updateWorkSchema.parse(request.body);
    const work = await service.updateWork(request.tenant_id, id, itemId, body);

    if (work === null) throw new NotFoundError("Work item not found");

    return reply.send({
      data: work,
      meta: { totals: await service.totals(request.tenant_id, id) },
    });
  });

  app.delete("/:id/works/:itemId", { onRequest: canWrite }, async (request, reply) => {
    const { id, itemId } = nestedParamsSchema.parse(request.params);
    const deleted = await service.deleteWork(request.tenant_id, id, itemId);

    if (!deleted) throw new NotFoundError("Work item not found");

    return reply.send({ data: { id: itemId, deleted: true }, meta: { totals: await service.totals(request.tenant_id, id) } });
  });

  // -------------------------------------------------------------------------
  // Parts
  // -------------------------------------------------------------------------

  app.get("/:id/parts", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const parts = await service.listParts(request.tenant_id, id);

    return reply.send({ data: parts, meta: { total: parts.length } });
  });

  app.post("/:id/parts", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createPartSchema.parse(request.body);
    const part = await service.addPart(request.tenant_id, id, body);

    return reply.status(201).send({
      data: part,
      meta: { totals: await service.totals(request.tenant_id, id) },
    });
  });

  app.patch("/:id/parts/:itemId", { onRequest: canWrite }, async (request, reply) => {
    const { id, itemId } = nestedParamsSchema.parse(request.params);
    const body = updatePartSchema.parse(request.body);
    const part = await service.updatePart(request.tenant_id, id, itemId, body);

    if (part === null) throw new NotFoundError("Part not found");

    return reply.send({
      data: part,
      meta: { totals: await service.totals(request.tenant_id, id) },
    });
  });

  app.delete("/:id/parts/:itemId", { onRequest: canWrite }, async (request, reply) => {
    const { id, itemId } = nestedParamsSchema.parse(request.params);
    const deleted = await service.deletePart(request.tenant_id, id, itemId);

    if (!deleted) throw new NotFoundError("Part not found");

    return reply.send({ data: { id: itemId, deleted: true }, meta: { totals: await service.totals(request.tenant_id, id) } });
  });

  // -------------------------------------------------------------------------
  // Notes & photos
  // -------------------------------------------------------------------------

  app.get("/:id/notes", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const notes = await service.listNotes(request.tenant_id, id);

    return reply.send({ data: notes, meta: { total: notes.length } });
  });

  app.post("/:id/notes", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createNoteSchema.parse(request.body);

    const note = await service.addNote(
      request.tenant_id,
      id,
      { id: request.authUser.id, name: request.authUser.name },
      body,
    );

    return reply.status(201).send({ data: note });
  });

  app.get("/:id/photos", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const photos = await service.listPhotos(request.tenant_id, id);

    return reply.send({ data: photos, meta: { total: photos.length } });
  });

  app.post("/:id/photos", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createPhotoSchema.parse(request.body);
    const photo = await service.addPhoto(request.tenant_id, id, request.authUser.id, body);

    return reply.status(201).send({ data: photo });
  });
}
