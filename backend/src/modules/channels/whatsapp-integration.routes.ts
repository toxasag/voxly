import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { WhatsappEvolutionService } from "./whatsapp-evolution.service.js";
import { queryOne, runWithTenantContext, runWithPlatformScope } from "../../db/client.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";

const startQrSchema = z.object({
  label: z.string().min(1).default("Основной"),
});

const statusQuerySchema = z.object({
  instanceName: z.string().min(1),
  label: z.string().min(1).default("Основной"),
  refreshQr: z.coerce.boolean().optional(),
});

function extractWaMessageText(message: Record<string, unknown> | null | undefined): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, any>;
  if (typeof m.conversation === "string") return m.conversation;
  if (typeof m.extendedTextMessage?.text === "string") return m.extendedTextMessage.text;
  if (typeof m.imageMessage?.caption === "string") return m.imageMessage.caption;
  if (typeof m.videoMessage?.caption === "string") return m.videoMessage.caption;
  if (typeof m.documentMessage?.caption === "string") return m.documentMessage.caption;
  if (m.imageMessage) return "[фото]";
  if (m.videoMessage) return "[видео]";
  if (m.audioMessage) return "[аудио]";
  if (m.documentMessage) return "[документ]";
  return "";
}

async function handleWhatsappWebhook(request: FastifyRequest, reply: FastifyReply) {
  const payload = request.body as Record<string, any> | undefined;
  const event = String(payload?.event || "").toLowerCase();

  // Evolution sends 'messages.upsert' or 'MESSAGES_UPSERT'
  if (!event.includes("messages.upsert") && !event.includes("messages_upsert")) {
    return reply.send({ ok: true, skipped: event });
  }

  const instanceName = String(payload?.instance || "").trim();
  if (!instanceName) {
    return reply.send({ ok: true, skipped: "no_instance" });
  }

  const account = await runWithPlatformScope(() =>
    queryOne<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM channel_accounts
       WHERE channel = 'whatsapp' AND status = 'connected' AND deleted_at IS NULL
         AND (credentials->>'instanceName' = $1 OR external_id = $1)
       LIMIT 1`,
      [instanceName],
    ),
  );

  if (!account) {
    return reply.send({ ok: true, skipped: "account_not_found" });
  }

  const data = payload?.data;
  const messages = Array.isArray(data) ? data : data ? [data] : [];
  const crm = new CrmPipelineService();

  for (const item of messages) {
    const fromMe = Boolean(item?.key?.fromMe);
    const remoteJid = String(item?.key?.remoteJid || "");

    // Skip groups, status, broadcasts, newsletters
    if (
      !remoteJid ||
      remoteJid.endsWith("@g.us") ||
      remoteJid.endsWith("@broadcast") ||
      remoteJid.endsWith("@newsletter")
    ) {
      continue;
    }

    const rawPeer = remoteJid.split("@")[0] ?? "";
    const phoneDigits = rawPeer.replace(/\D/g, "");
    if (!phoneDigits || phoneDigits.length < 10) continue;
    const phoneE164 = `+${phoneDigits}`;

    const text = extractWaMessageText(item?.message);
    if (!text) continue;

    if (fromMe) {
      await runWithTenantContext(account.tenant_id, () =>
        crm.processNativeOutbound({
          tenantId: account.tenant_id,
          channel: "whatsapp",
          channelAccountId: account.id,
          chatId: phoneE164,
          senderPhone: phoneE164,
          text,
          senderName: "Менеджер",
          pauseMinutes: 30,
        }),
      );
      continue;
    }

    const pushName = typeof item?.pushName === "string" ? item.pushName.trim() : "";
    const senderName = pushName || phoneE164;

    const crmResult = await runWithTenantContext(account.tenant_id, () =>
      crm.processIncoming({
        tenantId: account.tenant_id,
        channel: "whatsapp",
        channelAccountId: account.id,
        chatId: phoneE164,
        text,
        senderName,
        senderPhone: phoneE164,
        profile: {
          firstName: pushName || undefined,
          phone: phoneE164,
        },
      }),
    );

    if (crmResult.isPersonal) {
      request.log.info({ phoneE164 }, "Personal WhatsApp contact message ignored by CRM");
      continue;
    }

    // AI-автоответ
    try {
      const agentService = new AgentPipelineService(request.log);
      const outcome = await runWithTenantContext(account.tenant_id, () =>
        agentService.prepareReply({
          tenantId: account.tenant_id,
          channelAccountId: account.id,
          chatId: phoneE164,
          text,
        }),
      );

      if (outcome.kind === "replied") {
        if (crmResult.dealId !== null) {
          await runWithTenantContext(account.tenant_id, () =>
            crm.saveAgentReply({
              tenantId: account.tenant_id,
              dealId: crmResult.dealId!,
              reply: outcome.reply,
              channel: "whatsapp",
              channelAccountId: account.id,
            }),
          );
        }

        const evo = new WhatsappEvolutionService();
        for (const msg of outcome.reply.messages) {
          await evo.sendTextMessage(instanceName, phoneE164, msg);
        }
      }
    } catch (err) {
      request.log.error(err, "Failed to run AI agent auto-reply for WhatsApp inbound");
    }
  }

  return reply.send({ ok: true });
}

export async function whatsappInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhook", handleWhatsappWebhook);
}

export default async function whatsappIntegrationRoutes(app: FastifyInstance): Promise<void> {
  // Публичный маршрут для webhook от Evolution API (без JWT авторизации)
  app.post("/webhook", handleWhatsappWebhook);

  const protectedRoutes = async (subApp: FastifyInstance) => {
    await subApp.register(authenticatePlugin);

    const service = new WhatsappEvolutionService();

    const guards = [
      subApp.requirePermission("tenant:admin"),
      subApp.requireModule("whatsapp"),
    ];

    subApp.post("/auth/qr/start", { onRequest: guards }, async (request, reply) => {
      const body = startQrSchema.parse(request.body ?? {});
      const result = await service.startQr(request.tenant_id, body.label);
      return reply.send({ data: result });
    });

    subApp.get("/auth/qr/status", { onRequest: guards }, async (request, reply) => {
      const query = statusQuerySchema.parse(request.query);
      const result = await service.checkStatus(
        request.tenant_id,
        query.instanceName,
        query.label,
        query.refreshQr,
      );
      return reply.send({ data: result });
    });
  };

  await app.register(protectedRoutes);
}
