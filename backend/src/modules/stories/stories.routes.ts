import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { StoriesService } from "./stories.service.js";

const createStorySchema = z.object({
  channelAccountId: z.string().uuid().nullable().optional(),
  channel: z.enum(["telegram", "max", "whatsapp"]).optional(),
  mediaUrl: z.string().url("Укажите корректный URL медиафайла"),
  mediaType: z.enum(["photo", "video"]).optional(),
  text: z.string().max(4000).optional(),
  linkUrl: z.string().url().nullable().optional(),
  linkText: z.string().max(100).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export default async function storiesRoutes(app: FastifyInstance): Promise<void> {
  const service = new StoriesService();

  // Все роуты сторис требуют авторизованного пользователя тенанта
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/",
    { preHandler: [app.requirePermission("stories:read")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const query = request.query as { channel?: string; status?: string; limit?: string; offset?: string };

      const result = await service.list(tenant_id, {
        channel: query.channel,
        status: query.status,
        limit: query.limit ? Number(query.limit) : 50,
        offset: query.offset ? Number(query.offset) : 0,
      });

      return reply.send(result);
    },
  );

  app.get(
    "/:id",
    { preHandler: [app.requirePermission("stories:read")] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { tenant_id } = request;
      const story = await service.getById(tenant_id, request.params.id);
      return reply.send(story);
    },
  );

  app.post(
    "/",
    { preHandler: [app.requirePermission("stories:write")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const parsed = createStorySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "VALIDATION_ERROR",
          message: "Некорректные данные сторис",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const story = await service.create(tenant_id, parsed.data);
      return reply.status(201).send(story);
    },
  );

  app.post(
    "/:id/publish",
    { preHandler: [app.requirePermission("stories:publish")] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { tenant_id } = request;
      const story = await service.publish(tenant_id, request.params.id);
      return reply.send(story);
    },
  );

  app.delete(
    "/:id",
    { preHandler: [app.requirePermission("stories:write")] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { tenant_id } = request;
      const deleted = await service.delete(tenant_id, request.params.id);
      return reply.status(deleted ? 204 : 404).send();
    },
  );
}
