import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepairsService } from "../repairs/repairs.service.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

const createBrandSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

const brandIdParamsSchema = z.object({
  brandId: z.string().uuid("brandId must be a valid UUID"),
});

const createModelSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

/**
 * Cascading dictionaries route group.
 * Mounted at /api/v1/dictionaries by app.ts.
 */
export default async function dictionariesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new RepairsService();
  const canRead = [app.requirePermission("service_center:read")];
  const canWrite = [app.requirePermission("service_center:write")];

  // GET /dictionaries/brands — list brands for tenant
  app.get("/brands", { onRequest: canRead }, async (request, reply) => {
    const brands = await service.listBrands(request.tenant_id);
    return reply.send({ data: brands });
  });

  // POST /dictionaries/brands — create brand
  app.post("/brands", { onRequest: canWrite }, async (request, reply) => {
    const body = createBrandSchema.parse(request.body);
    const brand = await service.createBrand(request.tenant_id, body.name);
    return reply.status(201).send({ data: brand });
  });

  // GET /dictionaries/brands/:brandId/models — list models for specific brand
  app.get("/brands/:brandId/models", { onRequest: canRead }, async (request, reply) => {
    const { brandId } = brandIdParamsSchema.parse(request.params);
    const models = await service.listBrandModels(request.tenant_id, brandId);
    return reply.send({ data: models });
  });

  // POST /dictionaries/brands/:brandId/models — create model for specific brand
  app.post("/brands/:brandId/models", { onRequest: canWrite }, async (request, reply) => {
    const { brandId } = brandIdParamsSchema.parse(request.params);
    const body = createModelSchema.parse(request.body);
    const model = await service.createBrandModel(request.tenant_id, brandId, body.name);
    return reply.status(201).send({ data: model });
  });
}
