import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { chatEventBus, type ChatStreamEvent } from "./chat-events.js";
import { query } from "../../../db/client.js";
import { DealsService } from "../deals/deals.service.js";
import { presenceService } from "./presence.service.js";

// ---------------------------------------------------------------------------
// Realtime SSE Chat Stream, Presence & Read Receipts (M5.1).
//
// Fastify endpoints:
// - GET  /api/v1/crm/chat/stream
// - GET  /api/v1/crm/chat/delta
// - POST /api/v1/crm/chat/read
// - POST /api/v1/crm/chat/presence/heartbeat
// - GET  /api/v1/crm/chat/presence
// ---------------------------------------------------------------------------

interface StreamQuery {
  dealId?: string;
}

interface DeltaQuery {
  dealId?: string;
  since?: string;
  limit?: string;
}

interface MarkReadBody {
  dealId?: string;
  contactId?: string;
  messageIds?: string[];
}

interface PresenceQuery {
  entityType?: "deal" | "contact" | "user";
  entityId?: string;
}

export async function chatStreamRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const dealsService = new DealsService();

  app.get<{ Querystring: StreamQuery }>(
    "/crm/chat/stream",
    { preHandler: [app.requirePermission("chat:read")] },
    async (request: FastifyRequest<{ Querystring: StreamQuery }>, reply: FastifyReply) => {
      const tenantId = request.tenant_id;
      const dealId = request.query.dealId;

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");

      // Начальный ping
      reply.raw.write(`: connected\n\n`);

      const onEvent = (event: ChatStreamEvent) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = dealId
        ? chatEventBus.subscribeDeal(tenantId, dealId, onEvent)
        : chatEventBus.subscribeTenant(tenantId, onEvent);

      const pingInterval = setInterval(() => {
        if (!reply.raw.destroyed) {
          reply.raw.write(`: ping\n\n`);
        }
      }, 15_000);

      request.raw.on("close", () => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      return reply;
    },
  );

  // Delta polling fallback для клиентов без SSE
  app.get<{ Querystring: DeltaQuery }>(
    "/crm/chat/delta",
    { preHandler: [app.requirePermission("chat:read")] },
    async (request: FastifyRequest<{ Querystring: DeltaQuery }>, reply: FastifyReply) => {
      const tenantId = request.tenant_id;
      const { dealId, since, limit = "50" } = request.query;

      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

      let messages: unknown[];
      if (dealId) {
        if (since) {
          messages = await query(
            `SELECT id, deal_id, channel_account_id, source, direction, sender_name,
                    content, channel, attachment, attachment_type, delivery_status,
                    delivery_error, delivered_at, read_at, metadata, created_at
             FROM deal_messages
             WHERE tenant_id = $1 AND deal_id = $2 AND created_at > $3
             ORDER BY created_at ASC
             LIMIT $4`,
            [tenantId, dealId, since, parsedLimit],
          );
        } else {
          messages = await query(
            `SELECT id, deal_id, channel_account_id, source, direction, sender_name,
                    content, channel, attachment, attachment_type, delivery_status,
                    delivery_error, delivered_at, read_at, metadata, created_at
             FROM deal_messages
             WHERE tenant_id = $1 AND deal_id = $2
             ORDER BY created_at DESC
             LIMIT $3`,
            [tenantId, dealId, parsedLimit],
          );
        }
      } else {
        messages = await query(
          `SELECT id, deal_id, channel_account_id, source, direction, sender_name,
                  content, channel, attachment, attachment_type, delivery_status,
                  delivery_error, delivered_at, read_at, metadata, created_at
           FROM deal_messages
           WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
           ORDER BY created_at DESC
           LIMIT $3`,
          [tenantId, since ?? null, parsedLimit],
        );
      }

      return reply.send({
        data: messages,
        serverTime: new Date().toISOString(),
      });
    },
  );

  // Отметка прочтения сообщений (Read Receipts)
  app.post<{ Body: MarkReadBody }>(
    "/crm/chat/read",
    { preHandler: [app.requirePermission("chat:read")] },
    async (request: FastifyRequest<{ Body: MarkReadBody }>, reply: FastifyReply) => {
      const tenantId = request.tenant_id;
      const { dealId, contactId, messageIds } = request.body ?? {};

      const result = await dealsService.markMessagesRead(tenantId, {
        dealId,
        contactId,
        messageIds,
      });

      return reply.send({
        data: result,
      });
    },
  );

  // Heartbeat активности оператора/пользователя (Presence Heartbeat)
  app.post(
    "/crm/chat/presence/heartbeat",
    { preHandler: [app.requirePermission("chat:read")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.tenant_id;
      const userId = request.authUser?.id;

      if (userId) {
        await presenceService.recordUserHeartbeat(tenantId, userId);
      }

      return reply.send({
        ok: true,
        serverTime: new Date().toISOString(),
      });
    },
  );

  // Получение статуса присутствия и времени онлайна
  app.get<{ Querystring: PresenceQuery }>(
    "/crm/chat/presence",
    { preHandler: [app.requirePermission("chat:read")] },
    async (request: FastifyRequest<{ Querystring: PresenceQuery }>, reply: FastifyReply) => {
      const tenantId = request.tenant_id;
      const entityType = request.query.entityType ?? "deal";
      const entityId = request.query.entityId;

      if (!entityId) {
        return reply.status(400).send({ error: "Параметр entityId обязателен" });
      }

      const presence = await presenceService.getPresence(tenantId, entityType, entityId);
      return reply.send({
        data: presence,
      });
    },
  );
}
