import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { StageRulesService } from "./stage-rules.service.js";

const createStageRuleSchema = z.object({
  pipelineId: z.string().uuid().nullable().optional(),
  stageId: z.string().min(1, "Укажите этап сделки"),
  channelAccountId: z.string().uuid().nullable().optional(),
  channel: z.enum(["telegram", "whatsapp", "max"]).optional(),
  name: z.string().min(1, "Укажите название правила").max(100),
  delaySeconds: z.number().int().min(0).default(0),
  templateText: z.string().min(1, "Укажите текст сообщения").max(4000),
  mediaUrl: z.string().url().nullable().optional(),
  mediaType: z.enum(["photo", "video"]).nullable().optional(),
  isActive: z.boolean().optional(),
});

export default async function stageRulesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new StageRulesService();

  app.get(
    "/",
    { preHandler: [app.requirePermission("deals:read")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const query = request.query as { stageId?: string; stage_id?: string };
      const stageId = query.stageId ?? query.stage_id;

      const rules = await service.list(tenant_id, stageId);
      return reply.send({ data: rules });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.requirePermission("deals:read")] },
    async (request, reply) => {
      const { tenant_id } = request;
      const rule = await service.getById(tenant_id, request.params.id);
      return reply.send({ data: rule });
    },
  );

  app.post(
    "/",
    { preHandler: [app.requirePermission("deals:write")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const parsed = createStageRuleSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "VALIDATION_ERROR",
          message: "Некорректные данные правила автоворонки",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const created = await service.create(tenant_id, parsed.data);
      return reply.status(201).send({ data: created });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.requirePermission("deals:write")] },
    async (request, reply) => {
      const { tenant_id } = request;
      const deleted = await service.delete(tenant_id, request.params.id);
      return reply.status(deleted ? 204 : 404).send();
    },
  );
}
