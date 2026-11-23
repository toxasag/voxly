import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { servicesService } from "./services.service.js";
import { createServiceSchema, updateServiceSchema } from "./services.types.js";

export async function servicesRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  const moduleGuard = app.requireAnyModule(["products_services", "service_center"]);
  const canRead = [moduleGuard, app.requireAnyPermission(["deals:read", "service_center:read"])];
  const canWrite = [moduleGuard, app.requireAnyPermission(["deals:write", "service_center:write"])];

  app.get("/", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { search } = request.query as { search?: string };
    const items = await servicesService.list(tenant_id, search);
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

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateServiceSchema.parse(request.body);
    const updated = await servicesService.update(tenant_id, id, body);
    return reply.send({ data: updated });
  });

  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const result = await servicesService.delete(tenant_id, id);
    return reply.send({ data: result, ...result });
  });
}
