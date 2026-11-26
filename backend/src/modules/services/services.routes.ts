import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { sortDirSchema } from "../../lib/table-query.js";
import { servicesService } from "./services.service.js";
import { createServiceSchema, updateServiceSchema } from "./services.types.js";

const listServicesQuerySchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
  sort_by: z.string().max(64).optional(),
  sort_dir: sortDirSchema.optional(),
});

export async function servicesRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  const moduleGuard = app.requireAnyModule(["products_services", "service_center"]);
  const canRead = [moduleGuard, app.requireAnyPermission(["deals:read", "service_center:read"])];
  const canWrite = [moduleGuard, app.requireAnyPermission(["deals:write", "service_center:write"])];

  app.get("/", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const q = listServicesQuerySchema.parse(request.query ?? {});
    if (q.page !== undefined || q.sort_by !== undefined) {
      const res = await servicesService.listPaginated(tenant_id, {
        search: q.search,
        page: q.page,
        limit: q.limit,
        sortBy: q.sort_by,
        sortDir: q.sort_dir,
      });
      return reply.send(res);
    }
    const items = await servicesService.list(tenant_id, q.search);
    return reply.send({ data: items });
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const item = await servicesService.getById(tenant_id, id);
    return reply.send({ data: item });
  });

  app.post("/", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = createServiceSchema.parse(request.body);
    const item = await servicesService.create(tenant_id, body);
    return reply.status(201).send({ data: item });
  });

  const handleUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateServiceSchema.parse(request.body);
    const updated = await servicesService.update(tenant_id, id, body);
    return reply.send({ data: updated });
  };

  app.patch("/:id", { onRequest: canWrite }, handleUpdate);
  app.put("/:id", { onRequest: canWrite }, handleUpdate);

  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const result = await servicesService.delete(tenant_id, id);
    return reply.send({ data: result, ...result });
  });
}
