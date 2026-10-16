import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecordTableLayoutsService } from "./record-table-layouts.service.js";
import { recordTableIdSchema, recordTableLayoutSchema } from "./record-table-layouts.types.js";

const tableIdParamsSchema = z.object({ tableId: recordTableIdSchema });

export async function recordTableLayoutsRoutes(app: FastifyInstance): Promise<void> {
  const service = new RecordTableLayoutsService();

  app.get("/:tableId", async (request, reply) => {
    const { tableId } = tableIdParamsSchema.parse(request.params);
    const layout = await service.get(request.tenant_id, request.authUser.id, tableId);

    return reply.send({ data: layout });
  });

  app.put("/:tableId", async (request, reply) => {
    const { tableId } = tableIdParamsSchema.parse(request.params);
    const layout = recordTableLayoutSchema.parse(request.body);
    const stored = await service.upsert(request.tenant_id, request.authUser.id, tableId, layout);

    return reply.send({ data: stored });
  });
}
