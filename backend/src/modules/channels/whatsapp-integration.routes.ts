import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { WhatsappEvolutionService } from "./whatsapp-evolution.service.js";

const startQrSchema = z.object({
  label: z.string().min(1).default("Основной"),
});

const statusQuerySchema = z.object({
  instanceName: z.string().min(1),
  label: z.string().min(1).default("Основной"),
});

export default async function whatsappIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new WhatsappEvolutionService();

  const guards = [
    app.requirePermission("tenant:admin"),
    app.requireModule("whatsapp"),
  ];

  app.post("/auth/qr/start", { onRequest: guards }, async (request, reply) => {
    const body = startQrSchema.parse(request.body ?? {});
    const result = await service.startQr(request.tenant_id, body.label);
    return reply.send({ data: result });
  });

  app.get("/auth/qr/status", { onRequest: guards }, async (request, reply) => {
    const query = statusQuerySchema.parse(request.query);
    const result = await service.checkStatus(request.tenant_id, query.instanceName, query.label);
    return reply.send({ data: result });
  });
}
