import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { TimelineService } from "./timeline.service.js";
import { timelineRecordTypeSchema, type TimelineRecordType } from "./timeline.types.js";
import { PermissionDeniedError } from "../../../plugins/errorHandler.js";
import type { Permission } from "../../../types/index.js";

const paramsSchema = z.object({
  type: timelineRecordTypeSchema,
  id: z.string().uuid("id must be a UUID"),
});

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const READ_PERMISSIONS: Record<TimelineRecordType, Permission> = {
  contact: "contacts:read",
  company: "companies:read",
  deal: "deals:read",
};

function assertPermission(request: FastifyRequest, permission: Permission): void {
  if (!request.permissions.has(permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}`);
  }
}

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  const service = new TimelineService();

  app.get("/:type/:id/timeline", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    assertPermission(request, READ_PERMISSIONS[params.type]);

    const query = querySchema.parse(request.query);

    const result = await service.getTimeline(
      request.tenant_id,
      params.type,
      params.id,
      query.limit,
      query.offset,
    );

    return reply.send({
      data: result.items,
      meta: {
        limit: result.limit,
        offset: result.offset,
        total: result.total,
      },
    });
  });
}
