import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepairsService } from "./repairs.service.js";
import {
  changeStatusSchema,
  createBatchRepairSchema,
  createNoteSchema,
  createPartSchema,
  createPhotoSchema,
  createRepairSchema,
  createRepairServiceCatalogSchema,
  createWorkSchema,
  renameDictionaryItemSchema,
  repairPrioritySchema,
  repairStatusSchema,
  updatePartSchema,
  updateRepairSchema,
  updateWorkSchema,
} from "./repairs.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { NotFoundError } from "../../plugins/errorHandler.js";

const listQuerySchema = z.object({
  deal_id: z.string().uuid().optional(),
  status: repairStatusSchema.optional(),
  priority: repairPrioritySchema.optional(),
  master_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const clientLookupQuerySchema = z.object({
  phone: z.string().max(100).optional(),
  query: z.string().max(200).optional(),
});

const addDictionaryItemSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  brand_name: z.string().max(200).optional(),
});

const categoryParamSchema = z.object({
  category: z.string().min(1).max(50),
});

const dictionaryItemParamsSchema = z.object({
  category: z.string().min(1).max(50),
  id: z.string().uuid("id must be a UUID"),
});

const serialQuerySchema = z.object({
  serial: z.string().min(1).max(100),
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
      dealId: params.deal_id,
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

  // GET /repairs/client-lookup — reactive phone/name lookup with active CRM deals
  app.get("/client-lookup", { onRequest: canRead }, async (request, reply) => {
    const params = clientLookupQuerySchema.parse(request.query);
    const result = await service.clientLookup(request.tenant_id, params);
    return reply.send({ data: result });
  });

  // GET /repairs/dictionaries — retrieve service center dictionary lists
  app.get("/dictionaries", { onRequest: canRead }, async (request, reply) => {
    const dictionaries = await service.getDictionaries(request.tenant_id);
    return reply.send({ data: dictionaries });
  });

  // POST /repairs/dictionaries/:category — add new dictionary item
  app.post("/dictionaries/:category", { onRequest: canWrite }, async (request, reply) => {
    const { category } = categoryParamSchema.parse(request.params);
    const body = addDictionaryItemSchema.parse(request.body);
    const item = await service.addDictionaryItem(
      request.tenant_id,
      category,
      body.name,
      body.brand_name,
    );
    return reply.status(201).send({ data: item });
  });

  // PATCH /repairs/dictionaries/:category/:id — rename dictionary item
  app.patch("/dictionaries/:category/:id", { onRequest: canWrite }, async (request, reply) => {
    const { category, id } = dictionaryItemParamsSchema.parse(request.params);
    const body = renameDictionaryItemSchema.parse(request.body);
    const updated = await service.renameDictionaryItem(
      request.tenant_id,
      category,
      id,
      body.name,
    );
    return reply.send({ data: updated });
  });

  // DELETE /repairs/dictionaries/:category/:id — delete dictionary item with safety check
  app.delete("/dictionaries/:category/:id", { onRequest: canWrite }, async (request, reply) => {
    const { category, id } = dictionaryItemParamsSchema.parse(request.params);
    const result = await service.deleteDictionaryItem(
      request.tenant_id,
      category,
      id,
    );
    return reply.send({ data: result });
  });

  // POST /repairs/batch — batch create repairs (multi-equipment intake)
  app.post("/batch", { onRequest: canWrite }, async (request, reply) => {
    const body = createBatchRepairSchema.parse(request.body);
    const orders = await service.createBatch(
      request.tenant_id,
      { id: request.authUser.id, name: request.authUser.name },
      body,
    );
    return reply.status(201).send({ data: orders });
  });

  // GET /repairs/equipment/search-serial — search equipment history by serial
  app.get("/equipment/search-serial", { onRequest: canRead }, async (request, reply) => {
    const { serial } = serialQuerySchema.parse(request.query);
    const result = await service.searchEquipmentBySerial(request.tenant_id, serial);
    return reply.send({ data: result });
  });

  // GET /repairs/equipment/history — alias
  app.get("/equipment/history", { onRequest: canRead }, async (request, reply) => {
    const { serial } = serialQuerySchema.parse(request.query);
    const result = await service.searchEquipmentBySerial(request.tenant_id, serial);
    return reply.send({ data: result });
  });

  // GET /repairs/catalog/services — catalog of repair services
  app.get("/catalog/services", { onRequest: canRead }, async (request, reply) => {
    const services = await service.listServicesCatalog(request.tenant_id);
    return reply.send({ data: services });
  });

  // POST /repairs/catalog/services — add service to catalog
  app.post("/catalog/services", { onRequest: canWrite }, async (request, reply) => {
    const body = createRepairServiceCatalogSchema.parse(request.body);
    const item = await service.addServiceToCatalog(request.tenant_id, body);
    return reply.status(201).send({ data: item });
  });

  // DELETE /repairs/catalog/services/:id — delete service from catalog
  app.delete("/catalog/services/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await service.deleteServiceFromCatalog(request.tenant_id, id);
    return reply.send({ data: result });
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
