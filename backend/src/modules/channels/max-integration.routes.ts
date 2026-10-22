import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { MaxBridgeService } from "./max-bridge.service.js";
import { query, queryOne, withTenant, runWithTenantContext } from "../../db/client.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";

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

const internalBotDeleteSchema = z.object({
  tenantId: z.string().uuid().optional(),
  name: z.string().optional(),
  botId: z.string().optional(),
  maxUserId: z.string().optional(),
});

const internalInboundSchema = z.object({
  tenantId: z.string().uuid(),
  chatId: z.string().min(1),
  text: z.string().min(1),
  senderName: z.string().default("Клиент MAX"),
  senderPhone: z.string().optional().nullable(),
  senderUserId: z.string().optional().nullable(),
  senderUsername: z.string().optional().nullable(),
  botId: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
});

const internalOutboundSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().optional(),
  botId: z.string().optional(),
  chatId: z.string().min(1),
  text: z.string().min(1),
});

export async function maxInternalRoutes(app: FastifyInstance): Promise<void> {
  // Список активных подключений MAX для восстановления сессий в max-bridge
  app.get("/bots/active", async (_request, reply) => {
    const bots = await query<{
      id: string;
      tenant_id: string;
      label: string;
      external_id: string;
      remote_user_id: string | null;
    }>(
      `SELECT id, tenant_id, label, external_id, remote_user_id
       FROM channel_accounts
       WHERE channel = 'max' AND status = 'connected' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    );

    return reply.send({
      ok: true,
      bots: bots.map((b) => ({
        id: b.id,
        tenantId: b.tenant_id,
        name: b.label,
        maxUserId: b.remote_user_id || b.external_id,
      })),
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
           SET status = 'connected', status_message = '', label = $3, external_id = $4, remote_user_id = $5,
               connected_at = COALESCE(connected_at, now()), last_sync_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [body.tenantId, existing.id, label, extId, body.maxUserId || null],
        );
        return existing.id;
      }

      const inserted = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, status_message, remote_user_id, connected_at, last_sync_at)
         VALUES ($1, 'max', $2, $3, 'connected', '', $4, now(), now())
         RETURNING id`,
        [body.tenantId, label, extId, body.maxUserId || null],
      );
      return inserted.id;
    });

    return reply.send({ ok: true, botId });
  });

  // Удаление сессии бота
  app.post("/bots/delete", async (request, reply) => {
    const body = internalBotDeleteSchema.parse(request.body ?? {});
    const tenantId = body.tenantId;
    if (tenantId && (body.botId || body.name || body.maxUserId)) {
      await withTenant(tenantId, async (tx) => {
        await tx.query(
          `UPDATE channel_accounts
           SET status = 'disabled', deleted_at = now()
           WHERE tenant_id = $1 AND channel = 'max'
             AND (id = $2::uuid OR label = $3 OR external_id = $4 OR remote_user_id = $4)`,
          [
            tenantId,
            body.botId && body.botId.includes("-") ? body.botId : null,
            body.name ?? null,
            body.maxUserId ?? null,
          ],
        );
      });
    }
    return reply.send({ ok: true });
  });

  // Приём входящих сообщений MAX из max-bridge и доставка в CRM + AI-автоответ
  app.post("/inbound", async (request, reply) => {
    const body = internalInboundSchema.parse(request.body);
    const crm = new CrmPipelineService();

    let channelAccountId = body.botId;
    if (!channelAccountId || !channelAccountId.includes("-")) {
      const acc = await queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND ($2::text IS NULL OR label = $2 OR external_id = $2)
         ORDER BY connected_at DESC NULLS LAST
         LIMIT 1`,
        [body.tenantId, body.name ?? null],
      );
      channelAccountId = acc?.id ?? body.chatId;
    }

    const crmResult = await runWithTenantContext(body.tenantId, () =>
      crm.processIncoming({
        tenantId: body.tenantId,
        channel: "max",
        channelAccountId: channelAccountId!,
        chatId: body.chatId,
        text: body.text,
        senderName: body.senderName,
        senderPhone: body.senderPhone ?? undefined,
        senderTelegramChatId: undefined,
        profile: {
          firstName: body.senderName,
          phone: body.senderPhone ?? undefined,
          username: body.senderUsername ?? undefined,
        },
      }),
    );

    // AI-автоответ при наличии привязанного ассистента
    try {
      const agentService = new AgentPipelineService(request.log);
      const outcome = await runWithTenantContext(body.tenantId, () =>
        agentService.prepareReply({
          tenantId: body.tenantId,
          channelAccountId: channelAccountId!,
          chatId: body.chatId,
          text: body.text,
        }),
      );

      if (outcome.kind === "replied") {
        if (crmResult.dealId !== null) {
          await runWithTenantContext(body.tenantId, () =>
            crm.saveAgentReply({
              tenantId: body.tenantId,
              dealId: crmResult.dealId!,
              reply: outcome.reply,
              channel: "max",
              channelAccountId: channelAccountId!,
            }),
          );
        }

        const bridge = new MaxBridgeService();
        for (const msg of outcome.reply.messages) {
          await bridge.sendMessage({
            tenantId: body.tenantId,
            name: body.name ?? undefined,
            botId: channelAccountId,
            chatId: body.chatId,
            text: msg,
          });
        }
      }
    } catch (err) {
      request.log.error(err, "Failed to run AI agent auto-reply for MAX inbound");
    }

    return reply.send({
      ok: true,
      dealId: crmResult.dealId,
      contactId: crmResult.contactId,
    });
  });

  // Отправка сообщений из CRM в max-bridge
  app.post("/outbound", async (request, reply) => {
    const body = internalOutboundSchema.parse(request.body);
    const bridge = new MaxBridgeService();
    const result = await bridge.sendMessage({
      tenantId: body.tenantId,
      name: body.name,
      botId: body.botId,
      chatId: body.chatId,
      text: body.text,
    });

    return reply.send(result);
  });
}

export default async function maxIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const service = new MaxBridgeService();

  // Дублирование внутренних маршрутов под префиксом /internal/ для обратной совместимости
  app.get("/internal/bots/active", async (_request, reply) => {
    const bots = await query<{
      id: string;
      tenant_id: string;
      label: string;
      external_id: string;
      remote_user_id: string | null;
    }>(
      `SELECT id, tenant_id, label, external_id, remote_user_id
       FROM channel_accounts
       WHERE channel = 'max' AND status = 'connected' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    );

    return reply.send({
      ok: true,
      bots: bots.map((b) => ({
        id: b.id,
        tenantId: b.tenant_id,
        name: b.label,
        maxUserId: b.remote_user_id || b.external_id,
      })),
    });
  });

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
           SET status = 'connected', status_message = '', label = $3, external_id = $4, remote_user_id = $5,
               connected_at = COALESCE(connected_at, now()), last_sync_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [body.tenantId, existing.id, label, extId, body.maxUserId || null],
        );
        return existing.id;
      }

      const inserted = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, status_message, remote_user_id, connected_at, last_sync_at)
         VALUES ($1, 'max', $2, $3, 'connected', '', $4, now(), now())
         RETURNING id`,
        [body.tenantId, label, extId, body.maxUserId || null],
      );
      return inserted.id;
    });

    return reply.send({ ok: true, botId });
  });

  app.post("/internal/inbound", async (request, reply) => {
    const body = internalInboundSchema.parse(request.body);
    const crm = new CrmPipelineService();

    let channelAccountId = body.botId;
    if (!channelAccountId || !channelAccountId.includes("-")) {
      const acc = await queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND ($2::text IS NULL OR label = $2 OR external_id = $2)
         ORDER BY connected_at DESC NULLS LAST
         LIMIT 1`,
        [body.tenantId, body.name ?? null],
      );
      channelAccountId = acc?.id ?? body.chatId;
    }

    const crmResult = await runWithTenantContext(body.tenantId, () =>
      crm.processIncoming({
        tenantId: body.tenantId,
        channel: "max",
        channelAccountId: channelAccountId!,
        chatId: body.chatId,
        text: body.text,
        senderName: body.senderName,
        senderPhone: body.senderPhone ?? undefined,
        senderTelegramChatId: undefined,
        profile: {
          firstName: body.senderName,
          phone: body.senderPhone ?? undefined,
          username: body.senderUsername ?? undefined,
        },
      }),
    );

    return reply.send({
      ok: true,
      dealId: crmResult.dealId,
      contactId: crmResult.contactId,
    });
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
      if (result && typeof result.qr === "string" && result.qr.length > 0 && !result.qr.startsWith("data:image/")) {
        try {
          result.qr = await QRCode.toDataURL(result.qr, { margin: 1, width: 300 });
        } catch (err) {
          request.log.error(err, "Failed to convert MAX QR to data URL on start");
        }
      }
      return reply.send({ data: result });
    });

    subApp.get("/auth/qr/status", { onRequest: guards }, async (request, reply) => {
      const queryParam = qrStatusSchema.parse(request.query);
      const result = await service.checkStatus(request.tenant_id, queryParam.name);

      if (result && typeof result.qr === "string" && result.qr.length > 0) {
        if (!result.qr.startsWith("data:image/")) {
          try {
            result.qr = await QRCode.toDataURL(result.qr, { margin: 1, width: 300 });
          } catch (err) {
            request.log.error(err, "Failed to convert MAX QR to data URL on status check");
          }
        }
      } else if (result && result.status === "qr_ready") {
        try {
          const buffer = await service.getQrPng(request.tenant_id, queryParam.name);
          if (buffer) {
            result.qr = `data:image/png;base64,${buffer.toString("base64")}`;
          }
        } catch (err) {
          request.log.error(err, "Failed to fetch MAX QR PNG buffer from max-bridge");
        }
      }

      return reply.send({ data: result });
    });

    subApp.get("/auth/qr/png", { onRequest: guards }, async (request, reply) => {
      const queryParam = qrStatusSchema.parse(request.query);
      const buffer = await service.getQrPng(request.tenant_id, queryParam.name);
      if (!buffer) {
        return reply.status(404).send({ error: "QR not ready" });
      }
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
