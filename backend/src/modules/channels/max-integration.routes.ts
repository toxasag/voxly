import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { MaxBridgeService } from "./max-bridge.service.js";
import { withTenant } from "../../db/client.js";

const qrStartSchema = z.object({
  name: z.string().min(1).default("Основной"),
});

const qrStatusSchema = z.object({
  name: z.string().min(1).default("Основной"),
});

const qrPasswordSchema = z.object({
  name: z.string().min(1).default("Основной"),
  password: z.string().min(1),
});

const internalBotUpsertSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  maxUserId: z.string().default(""),
  username: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  sessionReady: z.boolean().optional(),
});

export async function maxInternalRoutes(app: FastifyInstance): Promise<void> {
  // Список активных подключений MAX для поддержания сессий max-bridge на старте
  app.get("/bots/active", async (_request, reply) => {
    return reply.send({
      ok: true,
      bots: [],
    });
  });

  // Внутренний эндпоинт для вызова из max-bridge при успешной авторизации сессии
  app.post("/bots/upsert", async (request, reply) => {
    const body = internalBotUpsertSchema.parse(request.body);

    const botId = await withTenant(body.tenantId, async (tx) => {
      const extId = body.maxUserId || body.username || body.name;
      const label = body.firstName ? `${body.name} (${body.firstName})` : body.name;

      const existing = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND (external_id = $2 OR label = $3)
         LIMIT 1`,
        [body.tenantId, extId, body.name],
      );

      if (existing) {
        await tx.query(
          `UPDATE channel_accounts
           SET status = 'connected', label = $3, external_id = $4, remote_user_id = $5,
               connected_at = COALESCE(connected_at, now())
           WHERE tenant_id = $1 AND id = $2`,
          [body.tenantId, existing.id, label, extId, body.maxUserId || null],
        );
        return existing.id;
      }

      const inserted = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, remote_user_id, connected_at)
         VALUES ($1, 'max', $2, $3, 'connected', $4, now())
         RETURNING id`,
        [body.tenantId, label, extId, body.maxUserId || null],
      );
      return inserted.id;
    });

    return reply.send({ ok: true, botId });
  });

  app.post("/bots/delete", async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.post("/inbound", async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.post("/outbound", async (_request, reply) => {
    return reply.send({ ok: true });
  });
}

export default async function maxIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const service = new MaxBridgeService();

  // Список активных подключений MAX для поддержания сессий max-bridge на старте
  app.get("/internal/bots/active", async (_request, reply) => {
    return reply.send({
      ok: true,
      bots: [],
    });
  });

  // Внутренний эндпоинт для вызова из max-bridge при успешной авторизации сессии
  app.post("/internal/bots/upsert", async (request, reply) => {
    const body = internalBotUpsertSchema.parse(request.body);

    const botId = await withTenant(body.tenantId, async (tx) => {
      const extId = body.maxUserId || body.username || body.name;
      const label = body.firstName ? `${body.name} (${body.firstName})` : body.name;

      const existing = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND (external_id = $2 OR label = $3)
         LIMIT 1`,
        [body.tenantId, extId, body.name],
      );

      if (existing) {
        await tx.query(
          `UPDATE channel_accounts
           SET status = 'connected', label = $3, external_id = $4, remote_user_id = $5,
               connected_at = COALESCE(connected_at, now())
           WHERE tenant_id = $1 AND id = $2`,
          [body.tenantId, existing.id, label, extId, body.maxUserId || null],
        );
        return existing.id;
      }

      const inserted = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, remote_user_id, connected_at)
         VALUES ($1, 'max', $2, $3, 'connected', $4, now())
         RETURNING id`,
        [body.tenantId, label, extId, body.maxUserId || null],
      );
      return inserted.id;
    });

    return reply.send({ ok: true, botId });
  });

  // Пользовательские эндпоинты авторизации по QR
  const protectedRoutes = async (subApp: FastifyInstance) => {
    await subApp.register(authenticatePlugin);

    const guards = [
      subApp.requirePermission("tenant:admin"),
      subApp.requireModule("max"),
    ];

    subApp.post("/auth/qr/start", { onRequest: guards }, async (request, reply) => {
      const body = qrStartSchema.parse(request.body ?? {});
      const result = await service.startQr(request.tenant_id, body.name);
      return reply.send({ data: result });
    });

    subApp.get("/auth/qr/status", { onRequest: guards }, async (request, reply) => {
      const query = qrStatusSchema.parse(request.query);
      const result = await service.checkStatus(request.tenant_id, query.name);
      return reply.send({ data: result });
    });

    subApp.get("/auth/qr/png", { onRequest: guards }, async (request, reply) => {
      const query = qrStatusSchema.parse(request.query);
      const url = `${service["baseUrl"]}/auth/qr/png?tenantId=${encodeURIComponent(request.tenant_id)}&name=${encodeURIComponent(query.name)}`;
      const headers: Record<string, string> = {};
      if (service["serviceToken"]) {
        headers["Authorization"] = `Bearer ${service["serviceToken"]}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) {
        return reply.status(res.status).send({ error: "QR not ready" });
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return reply.type("image/png").send(buffer);
    });

    subApp.post("/auth/qr/password", { onRequest: guards }, async (request, reply) => {
      const body = qrPasswordSchema.parse(request.body);
      const result = await service.submitPassword(request.tenant_id, body.name, body.password);
      return reply.send({ data: result });
    });
  };

  await app.register(protectedRoutes);
}
