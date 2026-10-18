import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { chatEventBus, type ChatStreamEvent } from "./chat-events.js";
import { query } from "../../../db/client.js";

// ---------------------------------------------------------------------------
// Realtime SSE Chat Stream & Polling Fallback (M5.1).
//
// Fastify endpoint: GET /api/v1/crm/chat/stream
// SSE Content-Type: text/event-stream
// Keep-alive ping каждые 15 секунд.
// ---------------------------------------------------------------------------

interface StreamQuery {
  dealId?: string;
}

interface DeltaQuery {
  dealId?: string;
  since?: string;
  limit?: string;
}

export async function chatStreamRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

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

    // Возвращаем reply для удержания соединения
    return reply;
  });

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
                  delivery_error, created_at
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
                  delivery_error, created_at
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
                delivery_error, created_at
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
  });
}
