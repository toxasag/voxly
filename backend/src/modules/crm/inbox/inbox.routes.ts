import type { FastifyInstance } from "fastify";
import { InboxService } from "./inbox.service.js";
import { inboxQuerySchema } from "./inbox.types.js";

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  const service = new InboxService();
  const canRead = app.requirePermission("deals:read");

  app.get("/threads", { onRequest: canRead }, async (request, reply) => {
    const params = inboxQuerySchema.parse(request.query);
    const result = await service.listThreads(request.tenant_id, params);
    return reply.send({
      data: result.items,
      meta: {
        total: result.total,
        limit: params.limit,
        offset: params.offset,
      },
    });
  });
}
