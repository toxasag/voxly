import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { MaxBridgeService } from "./max-bridge.service.js";
import { query, queryOne, withTenant, runWithTenantContext, runWithPlatformScope } from "../../db/client.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";

/**
 * INC-113: никогда не записывать номер подключенного аккаунта оператора
 * в качестве телефона лида/собеседника.
 */
export function stripOwnerPhone(phone?: string | null, selfPhone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  if (selfPhone) {
    const selfDigits = selfPhone.replace(/\D/g, "");
    if (selfDigits.length >= 10) {
      if (digits === selfDigits || digits.slice(-10) === selfDigits.slice(-10)) {
        return undefined;
      }
    }
  }
  return digits;
}

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

const inboundAttachmentSchema = z.object({
  type: z.string(),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  fileSize: z.number().optional(),
});

const internalInboundSchema = z.object({
  // Поля от max-bridge (основные)
  botId: z.string().optional(),
  peerId: z.string().optional(),
  maxUserId: z.string().nullable().optional(),
  chatType: z.string().nullable().optional(),
  text: z.string().max(8000).default(""),
  messageId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? undefined : String(v))),
  username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  selfPhone: z.string().nullable().optional(),
  maxLink: z.string().nullable().optional(),
  attachments: z.array(inboundAttachmentSchema).max(20).optional(),
  // Устаревшие поля для обратной совместимости
  tenantId: z.string().uuid().optional(),
  chatId: z.string().optional(),
  senderName: z.string().optional(),
  senderPhone: z.string().optional().nullable(),
  senderUserId: z.string().optional().nullable(),
  senderUsername: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
});

// Кэш для защиты от повторной доставки сообщений (idempotency)
const recentInboundMessages = new Map<string, number>();

function isDuplicateInbound(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of recentInboundMessages) {
    if (now - ts > 60_000) recentInboundMessages.delete(k);
  }
  if (recentInboundMessages.has(key)) return true;
  recentInboundMessages.set(key, now);
  return false;
}

/**
 * Синхронизирует историю приватного диалога MAX в сделку.
 * Подтягивает все предшествующие сообщения клиента и менеджера с точными датами.
 */
export async function syncMaxDialogHistory(opts: {
  tenantId: string;
  dealId: string;
  channelAccountId: string;
  peerId: string;
  peerPhone?: string | null;
  peerUserId?: string | null;
  senderName?: string;
  log?: FastifyBaseLogger;
}): Promise<number> {
  const bridge = new MaxBridgeService();
  const resp = await bridge.getPrivateDialogs({
    botId: opts.channelAccountId,
    dialogLimit: 20,
    messageLimit: 50,
  });

  if (!resp.ok || !Array.isArray(resp.dialogs)) return 0;

  const cleanPhone = opts.peerPhone ? opts.peerPhone.replace(/\D/g, "") : "";
  const target = resp.dialogs.find((d) => {
    if (d.chatId === opts.peerId) return true;
    if (opts.peerUserId && d.userId === opts.peerUserId) return true;
    if (cleanPhone && d.phone && d.phone.replace(/\D/g, "").endsWith(cleanPhone.slice(-10))) return true;
    return false;
  });

  if (!target || !Array.isArray(target.messages) || target.messages.length === 0) return 0;

  let insertedCount = 0;
  await runWithTenantContext(opts.tenantId, async () => {
    for (const msg of target.messages) {
      const text = (msg.text || "").trim();
      if (!text) continue;
      const msgDate = msg.date ? new Date(msg.date * 1000) : new Date();

      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
           AND content = $3
           AND created_at >= $4::timestamptz - interval '10 seconds'
           AND created_at <= $4::timestamptz + interval '10 seconds'
         LIMIT 1`,
        [opts.tenantId, opts.dealId, text, msgDate.toISOString()],
      );

      if (existing) continue;

      const source = msg.out ? "manager" : "client";
      const direction = msg.out ? "outbound" : "inbound";
      const senderName = msg.out ? "Менеджер" : (target.firstName || opts.senderName || "Клиент MAX");

      await query(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel, delivery_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'max', $8, $9)`,
        [
          opts.tenantId,
          opts.dealId,
          opts.channelAccountId,
          source,
          direction,
          senderName,
          text,
          msg.out ? "sent" : "neutral",
          msgDate.toISOString(),
        ],
      );
      insertedCount++;
    }
  });

  opts.log?.info({ dealId: opts.dealId, insertedCount }, "MAX dialog history synced to deal");
  return insertedCount;
}

async function processMaxInbound(request: FastifyRequest, reply: FastifyReply) {
  const body = internalInboundSchema.parse(request.body);
  const peerId = (body.peerId || body.chatId || "").trim();
  if (!peerId) {
    return reply.code(400).send({ ok: false, error: "peerId or chatId required" });
  }

  // Дедупликация входящих сообщений (по messageId или по связке botId + peerId + text)
  const dedupKey = body.messageId
    ? `max:msg:${body.messageId}`
    : `max:txt:${body.botId ?? ""}:${peerId}:${body.text}`;

  if (isDuplicateInbound(dedupKey)) {
    request.log.info({ key: dedupKey }, "Duplicate MAX inbound message absorbed");
    return reply.send({ ok: true, duplicate: true });
  }

  // Каналы и группы никогда не становятся сделками (только личный диалог 1-на-1)
  const chatTypeNorm = String(body.chatType || "").trim().toUpperCase();
  if (chatTypeNorm && chatTypeNorm !== "DIALOG") {
    return reply.send({ ok: true, skipped: "non_private_chat", chatType: chatTypeNorm });
  }
  if (peerId.startsWith("-")) {
    return reply.send({ ok: true, skipped: "non_private_chat", chatType: "negative_id" });
  }

  // Поиск аккаунта в channel_accounts
  let account: { id: string; tenant_id: string; remote_user_id: string | null; external_id: string } | null = null;
  const botIdCandidate = body.botId;
  if (botIdCandidate && botIdCandidate.includes("-")) {
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE id = $1 AND channel = 'max' AND deleted_at IS NULL`,
        [botIdCandidate],
      ),
    );
  }

  if (!account && body.tenantId) {
    const tId = body.tenantId;
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND ($2::text IS NULL OR label = $2 OR external_id = $2)
         ORDER BY connected_at DESC NULLS LAST
         LIMIT 1`,
        [tId, body.name ?? null],
      ),
    );
  }

  if (!account) {
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE channel = 'max' AND status = 'connected' AND deleted_at IS NULL
           AND ($1::text IS NULL OR id::text = $1 OR external_id = $1 OR label = $1)
         ORDER BY connected_at DESC NULLS LAST
         LIMIT 1`,
        [botIdCandidate ?? body.name ?? null],
      ),
    );
  }

  if (!account) {
    request.log.warn({ botId: body.botId, name: body.name }, "MAX account not found for inbound message");
    return reply.code(404).send({ ok: false, error: "MAX account not found" });
  }

  const tenantId = account.tenant_id;
  const channelAccountId = account.id;

  // Игнорируем сообщения от самого себя
  const selfMaxUserId = (account.remote_user_id || account.external_id || "").trim();
  const peerUser = String(body.maxUserId || "").trim();
  if (selfMaxUserId && (peerUser === selfMaxUserId || peerId === selfMaxUserId)) {
    return reply.send({ ok: true, skipped: "self" });
  }

  // Защита от утечки собственного телефона (INC-113)
  const rawPhone = body.phone || body.senderPhone;
  const selfPhone = body.selfPhone;
  const peerPhone = stripOwnerPhone(rawPhone, selfPhone);

  const senderName =
    body.firstName?.trim() ||
    (body.username ? `@${body.username.replace(/^@/, "")}` : null) ||
    body.senderName ||
    "Клиент MAX";

  const crm = new CrmPipelineService();
  const crmResult = await runWithTenantContext(tenantId, () =>
    crm.processIncoming({
      tenantId,
      channel: "max",
      channelAccountId,
      chatId: peerId,
      text: body.text,
      senderName,
      senderPhone: peerPhone,
      profile: {
        firstName: body.firstName ?? undefined,
        phone: peerPhone,
        username: body.username ?? body.senderUsername ?? undefined,
      },
    }),
  );

  if (crmResult.isPersonal) {
    request.log.info({ peerId }, "Personal MAX contact message ignored by CRM");
    return reply.send({ ok: true });
  }

  // Проверяем, не отключен ли или приостановлен AI-автопилот
  const dealIdToCheck = crmResult.dealId;
  const isAiPaused = await runWithTenantContext(tenantId, async () => {
    if (dealIdToCheck) {
      const row = await queryOne<{ id: string }>(
        `SELECT id FROM deals
         WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now()
         LIMIT 1`,
        [tenantId, dealIdToCheck],
      );
      if (row !== null) return true;
    }
    if (crmResult.contactId) {
      const contactDeal = await queryOne<{ id: string }>(
        `SELECT id FROM deals
         WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL AND ai_paused_until > now()
         LIMIT 1`,
        [tenantId, crmResult.contactId],
      );
      if (contactDeal !== null) return true;
    }
    return false;
  }).catch(() => false);

  if (isAiPaused) {
    request.log.info(
      { dealId: dealIdToCheck, contactId: crmResult.contactId, peerId },
      "AI auto-reply skipped: AI is disabled or paused for this deal/contact",
    );
    return reply.send({ ok: true });
  }

  // AI-автоответ при наличии привязанного ассистента
  try {
    const agentService = new AgentPipelineService(request.log);
    const outcome = await runWithTenantContext(tenantId, () =>
      agentService.prepareReply({
        tenantId,
        channelAccountId,
        chatId: peerId,
        text: body.text,
        channelType: "MAX",
        dealId: dealIdToCheck || undefined,
      }),
    );

    if (outcome.kind === "replied") {
      if (crmResult.dealId !== null) {
        await runWithTenantContext(tenantId, () =>
          crm.saveAgentReply({
            tenantId,
            dealId: crmResult.dealId!,
            reply: outcome.reply,
            channel: "max",
            channelAccountId,
          }),
        );
      }

      const bridge = new MaxBridgeService();
      for (const msg of outcome.reply.messages) {
        await bridge.sendMessage({
          tenantId,
          name: body.name ?? undefined,
          botId: channelAccountId,
          chatId: peerId,
          text: msg,
        });
      }
    }
  } catch (err) {
    request.log.error(err, "Failed to run AI agent auto-reply for MAX inbound");
  }

  // Фоновая синхронизация предшествующей истории переписки при создании сделки
  if (crmResult.dealId && crmResult.isNewDeal) {
    void syncMaxDialogHistory({
      tenantId,
      dealId: crmResult.dealId,
      channelAccountId,
      peerId,
      peerPhone,
      peerUserId: peerUser || null,
      senderName,
      log: request.log,
    }).catch((err) => {
      request.log.warn(err, "Failed to sync MAX dialog history for new deal");
    });
  }

  return reply.send({
    ok: true,
    dealId: crmResult.dealId,
    contactId: crmResult.contactId,
  });
}

async function processMaxOutbound(request: FastifyRequest, reply: FastifyReply) {
  const body = internalInboundSchema.parse(request.body);
  const peerId = (body.peerId || body.chatId || "").trim();
  if (!peerId) {
    return reply.code(400).send({ ok: false, error: "peerId or chatId required" });
  }

  const chatTypeNorm = String(body.chatType || "").trim().toUpperCase();
  if (chatTypeNorm && chatTypeNorm !== "DIALOG") {
    return reply.send({ ok: true, skipped: "non_private_chat", chatType: chatTypeNorm });
  }
  if (peerId.startsWith("-")) {
    return reply.send({ ok: true, skipped: "non_private_chat", chatType: "negative_id" });
  }

  let account: { id: string; tenant_id: string; remote_user_id: string | null; external_id: string } | null = null;
  if (body.botId && body.botId.includes("-")) {
    const bId = body.botId;
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE id = $1 AND channel = 'max' AND deleted_at IS NULL`,
        [bId],
      ),
    );
  }
  if (!account && body.tenantId) {
    const tId = body.tenantId;
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
         LIMIT 1`,
        [tId],
      ),
    );
  }
  if (!account) {
    account = await runWithPlatformScope(() =>
      queryOne(
        `SELECT id, tenant_id, remote_user_id, external_id FROM channel_accounts
         WHERE channel = 'max' AND status = 'connected' AND deleted_at IS NULL
         ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
      ),
    );
  }

  if (!account) {
    return reply.code(404).send({ ok: false, error: "MAX account not found" });
  }

  const selfMaxUserId = (account.remote_user_id || account.external_id || "").trim();
  const peerUser = String(body.maxUserId || "").trim();
  if (selfMaxUserId && (peerUser === selfMaxUserId || peerId === selfMaxUserId)) {
    return reply.send({ ok: true, skipped: "self" });
  }

  // Защита от утечки собственного телефона (INC-113)
  const rawPhone = body.phone || body.senderPhone;
  const selfPhone = body.selfPhone;
  const peerPhone = stripOwnerPhone(rawPhone, selfPhone);

  const crm = new CrmPipelineService();
  const result = await runWithTenantContext(account.tenant_id, () =>
    crm.processNativeOutbound({
      tenantId: account.tenant_id,
      channel: "max",
      channelAccountId: account.id,
      chatId: peerId,
      peerUserId: peerUser || null,
      senderPhone: peerPhone || null,
      username: body.username ?? body.senderUsername ?? null,
      text: body.text,
      senderName: "Менеджер",
      pauseMinutes: 30,
    }),
  );

  request.log.info(
    { peerId, peerUser, peerPhone, text: body.text, dealId: result.dealId, messageId: result.messageId },
    "MAX native outbound processed into CRM deal",
  );

  return reply.send({
    ok: true,
    ...result,
  });
}

export async function maxInternalRoutes(app: FastifyInstance): Promise<void> {
  // Список активных подключений MAX для восстановления сессий в max-bridge
  app.get("/bots/active", async (_request, reply) => {
    const bots = await runWithPlatformScope(() =>
      query<{
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
      ),
    );

    return reply.send({
      ok: true,
      bots: bots.map((b) => ({
        id: b.id,
        botId: b.id,
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
  app.post("/inbound", processMaxInbound);

  // Нативное исходящее сообщение оператора из мобильного MAX → запись в CRM + AI handoff
  app.post("/outbound", processMaxOutbound);
}

export default async function maxIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const service = new MaxBridgeService();

  // Дублирование внутренних маршрутов под префиксом /internal/ для обратной совместимости
  app.get("/internal/bots/active", async (_request, reply) => {
    const bots = await runWithPlatformScope(() =>
      query<{
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
      ),
    );

    return reply.send({
      ok: true,
      bots: bots.map((b) => ({
        id: b.id,
        botId: b.id,
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

  app.post("/internal/inbound", processMaxInbound);
  app.post("/internal/outbound", processMaxOutbound);

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

      if (result && result.status === "qr_ready" && typeof result.qr === "string" && result.qr.length > 0) {
        if (!result.qr.startsWith("data:image/")) {
          try {
            result.qr = await QRCode.toDataURL(result.qr, { margin: 1, width: 300 });
          } catch (err) {
            request.log.error(err, "Failed to convert MAX QR to data URL on status check");
          }
        }
      } else if (result && result.status === "qr_ready" && !result.qr) {
        try {
          const buffer = await service.getQrPng(request.tenant_id, queryParam.name);
          if (buffer) {
            result.qr = `data:image/png;base64,${buffer.toString("base64")}`;
          }
        } catch (err) {
          request.log.error(err, "Failed to fetch MAX QR PNG buffer from max-bridge");
        }
      } else if (result && result.status !== "qr_ready") {
        result.qr = null;
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
