import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { servicesService } from "./services.service.js";
import { createServiceSchema, updateServiceSchema } from "./services.types.js";

export async function servicesRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  app.get("/", async (request, reply) => {
    const { tenant_id } = request;
    const { search } = request.query as { search?: string };
    const items = await servicesService.list(tenant_id, search);
    return reply.send({ data: items });
  });

  app.get("/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const item = await servicesService.getById(tenant_id, id);
    return reply.send({ data: item });
  });

  app.post("/", async (request, reply) => {
    const { tenant_id } = request;
    const body = createServiceSchema.parse(request.body);
    const item = await servicesService.create(tenant_id, body);
    return reply.status(201).send({ data: item });
  });

  app.patch("/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateServiceSchema.parse(request.body);
    const updated = await servicesService.update(tenant_id, id, body);
    return reply.send({ data: updated });
  });

  app.delete("/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const result = await servicesService.delete(tenant_id, id);
    return reply.send(result);
  });
}
