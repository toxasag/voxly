import { timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";

import { getEnv } from "../../config/env.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "../../services/credentials-cipher.js";
import {
  MaxBridgeService,
  invalidateMaxBridgeLiveBotsCache,
  type MaxPrivateDialogsResponse,
  type MaxSessionBackup,
} from "./max-bridge.service.js";
import { maxNativeAuthService } from "./max-native-auth.service.js";
import { extractMaxIdentity, normalizeMaxPhone, syncMaxContactIdentityFromDialog } from "./max-identity.js";
import { messagingRegistry } from "../messaging/messaging-registry.js";
import { query, queryOne, withTenant, runWithTenantContext, runWithPlatformScope } from "../../db/client.js";
import { CrmPipelineService, isBotSender, type ChannelProfile } from "../crm/crm-pipeline.service.js";
import { isBannedName } from "../crm/channel-identity.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { mediaEnrichmentService } from "../crm/media/media-enrichment.service.js";
import { chatEventBus } from "../crm/chat/chat-events.js";
import { messageTranslationService } from "../crm/translation/message-translation.service.js";
import {
  buildMaxAttachmentMetadata,
  maxAttachmentDefaultLabel,
  maxAttachmentExternalId,
  storeMaxMessageAttachments,
} from "./max-attachments.js";

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

const maxProviderSchema = z.enum(["max-bridge", "native-ts"]);

const qrStartSchema = z.object({
  name: z.string().min(1).default("Основной"),
  botId: z.string().uuid().optional(),
  provider: maxProviderSchema.optional(),
});

const qrStatusSchema = z.object({
  name: z.string().min(1).default("Основной"),
  botId: z.string().uuid().optional(),
  provider: maxProviderSchema.optional(),
});

const qrPasswordSchema = z.object({
  name: z.string().min(1).default("Основной"),
  password: z.string().min(1),
  botId: z.string().uuid().optional(),
  provider: maxProviderSchema.optional(),
});

const phoneStartSchema = z.object({
  phone: z.string().min(6),
  name: z.string().min(1).default("Основной"),
  botId: z.string().uuid().optional(),
});

const phoneVerifySchema = z.object({
  authSessionId: z.string().uuid(),
  code: z.string().min(2).max(16),
});

const phoneCallCheckSchema = z.object({
  authSessionId: z.string().uuid(),
});

const phonePasswordSchema = z.object({
  authSessionId: z.string().uuid(),
  password: z.string().min(1),
});

const providerSwitchSchema = z.object({
  provider: maxProviderSchema,
});

function isNativeMaxAccount(credentials: Record<string, unknown> | null | undefined): boolean {
  const provider = credentials?.provider ?? credentials?.adapter;
  return provider === "native-ts" || provider === "ts";
}

const sessionBackupSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().optional(),
  phone: z.string().optional(),
  mtInstanceId: z.string().optional(),
  chatsSync: z.number().optional(),
  contactsSync: z.number().optional(),
  draftsSync: z.number().optional(),
  presenceSync: z.number().optional(),
  configHash: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  userAgent: z.record(z.unknown()).nullable().optional(),
});

const internalBotUpsertSchema = z.object({
  tenantId: z.string().uuid(),
  botId: z.string().uuid().optional(),
  name: z.string().min(1),
  maxUserId: z.string().default(""),
  username: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  sessionReady: z.boolean().optional(),
  sessionBackup: sessionBackupSchema.optional().nullable(),
});

const internalBotStatusSchema = z.object({
  botId: z.string().uuid(),
  status: z.enum(["connected", "error"]),
  statusMessage: z.string().max(500).default(""),
  clearSession: z.boolean().optional(),
  maxUserId: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  sessionBackup: sessionBackupSchema.optional().nullable(),
});

const maxAccountParamsSchema = z.object({
  id: z.string().uuid("id must be a UUID"),
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
  phone: z.union([z.string(), z.number()]).optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  vcfBody: z.string().optional().nullable(),
  contactId: z.union([z.string(), z.number()]).optional().nullable(),
});

const maxRawNameSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
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
  lastName: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  names: z.array(maxRawNameSchema).max(10).optional().nullable(),
  phone: z.string().nullable().optional(),
  selfPhone: z.string().nullable().optional(),
  maxLink: z.string().nullable().optional(),
  attachments: z.array(inboundAttachmentSchema).max(20).optional(),
  isBot: z.boolean().optional(),
  is_bot: z.boolean().optional(),
  type: z.string().optional(),
  senderType: z.string().optional(),
  out: z.boolean().optional(),
  fromMe: z.boolean().optional(),
  direction: z.string().optional(),
  // Устаревшие поля для обратной совместимости
  tenantId: z.string().uuid().optional(),
  chatId: z.string().optional(),
  threadId: z.string().optional(),
  chat_thread_id: z.string().optional(),
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

async function downloadMaxMediaBuffer(opts: {
  tenantId: string;
  botId: string;
  fileId: string;
  isNativeTs?: boolean;
}): Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; error?: string }> {
  let useNative = opts.isNativeTs;
  if (useNative === undefined) {
    const acc = await runWithTenantContext(opts.tenantId, () =>
      queryOne<{ credentials: Record<string, unknown> | null }>(
        `SELECT credentials FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [opts.tenantId, opts.botId],
      ),
    ).catch(() => null);
    useNative = isNativeMaxAccount(acc?.credentials);
  }

  return useNative
    ? messagingRegistry.getMaxTsAdapter().downloadMedia(opts.tenantId, opts.botId, opts.fileId)
    : new MaxBridgeService().downloadMedia({
        botId: opts.botId,
        fileId: opts.fileId,
      });
}

async function resolveAndStoreMaxAttachment(opts: {
  tenantId: string;
  botId: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  isNativeTs?: boolean;
  log?: FastifyBaseLogger;
}): Promise<{ url: string; mimeType: string } | null> {
  const stored = await storeMaxMessageAttachments({
    tenantId: opts.tenantId,
    attachments: [{ fileId: opts.fileId, fileName: opts.fileName, mimeType: opts.mimeType }],
    downloadMedia: (fileId) =>
      downloadMaxMediaBuffer({
        tenantId: opts.tenantId,
        botId: opts.botId,
        fileId,
        isNativeTs: opts.isNativeTs,
      }),
    log: opts.log,
  });
  const first = stored[0];
  return first ? { url: first.url, mimeType: first.mimeType } : null;
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
  preloadedDialogs?: MaxPrivateDialogsResponse;
  log?: FastifyBaseLogger;
}): Promise<number> {
  const acc = await runWithTenantContext(opts.tenantId, () =>
    queryOne<{ credentials: Record<string, unknown> | null }>(
      `SELECT credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [opts.tenantId, opts.channelAccountId],
    ),
  ).catch(() => null);
  const useNative = isNativeMaxAccount(acc?.credentials);

  const resp =
    opts.preloadedDialogs ??
    (useNative
      ? await messagingRegistry.getMaxTsAdapter().getPrivateDialogs(opts.tenantId, opts.channelAccountId, 80, 50)
      : await new MaxBridgeService().getPrivateDialogs({
          botId: opts.channelAccountId,
          dialogLimit: 80,
          messageLimit: 50,
        }));

  if (!resp.ok || !Array.isArray(resp.dialogs)) return 0;

  const cleanPhone = opts.peerPhone ? opts.peerPhone.replace(/\D/g, "") : "";
  const cleanPeerUserId = opts.peerUserId ? opts.peerUserId.trim() : "";
  const cleanPeerId = opts.peerId ? opts.peerId.trim() : "";
  const target = resp.dialogs.find((d) => {
    if (cleanPeerId && (d.chatId === cleanPeerId || d.userId === cleanPeerId)) return true;
    if (cleanPeerUserId && (d.userId === cleanPeerUserId || d.chatId === cleanPeerUserId)) return true;
    if (cleanPhone.length >= 10 && d.phone && d.phone.replace(/\D/g, "").endsWith(cleanPhone.slice(-10))) return true;
    return false;
  });

  if (!target || !Array.isArray(target.messages) || target.messages.length === 0) return 0;

  if (!opts.preloadedDialogs) {
    const dealRow = await runWithTenantContext(opts.tenantId, () =>
      queryOne<{ contact_id: string | null }>(
        `SELECT contact_id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [opts.tenantId, opts.dealId],
      ),
    ).catch(() => null);
    if (dealRow?.contact_id) {
      await syncMaxContactIdentityFromDialog({
        tenantId: opts.tenantId,
        contactId: dealRow.contact_id,
        dialog: target,
        selfPhone: resp.selfPhone,
      }).catch(() => {});
    }
  }

  let insertedCount = 0;
  await runWithTenantContext(opts.tenantId, async () => {
    for (const msg of target.messages) {
      const rawText = (msg.text || "").trim();
      const msgAtts = Array.isArray(msg.attachments) ? msg.attachments : [];
      const attSlots = msgAtts.length > 0 ? msgAtts : [null];

      const rawDate: unknown = msg.date;
      let msgDate: Date;
      if (typeof rawDate === "number" && rawDate > 0) {
        msgDate = new Date(rawDate > 1e11 ? rawDate : rawDate * 1000);
      } else if (typeof rawDate === "string" && rawDate.trim()) {
        const num = Number(rawDate);
        if (!isNaN(num) && num > 0) {
          msgDate = new Date(num > 1e11 ? num : num * 1000);
        } else {
          const d = new Date(rawDate);
          msgDate = isNaN(d.getTime()) ? new Date() : d;
        }
      } else {
        msgDate = new Date();
      }

      const source = msg.out ? "manager" : "client";
      const direction = msg.out ? "outbound" : "inbound";
      const rawTargetName = target.firstName || opts.senderName || "Клиент MAX";
      const cleanTargetName = isBannedName(rawTargetName) ? "Клиент MAX" : rawTargetName;
      const senderName = msg.out ? "Менеджер" : cleanTargetName;
      const parentMsgId = msg.id != null ? String(msg.id) : null;

      for (const [attIndex, att] of attSlots.entries()) {
        const attFileId = att?.fileId ?? null;
        const text =
          (attIndex === 0 && rawText) ||
          maxAttachmentDefaultLabel(att?.type, att?.fileName, att?.mimeType);
        if (!text && !attFileId) continue;

        const externalMsgId = parentMsgId ? maxAttachmentExternalId(parentMsgId, attIndex) : null;
        const itemDate = new Date(msgDate.getTime() + attIndex);

        const existing = await queryOne<{
          id: string;
          attachment: string | null;
          metadata: Record<string, unknown> | null;
        }>(
          `SELECT id, attachment, metadata FROM deal_messages
           WHERE tenant_id = $1 AND deal_id = $2
             AND delivery_status <> 'failed'
             AND (
               ($3::text IS NOT NULL AND metadata->>'external_message_id' = $3)
               OR ($4::text IS NOT NULL AND metadata->>'external_attachment_id' = $4)
               OR (
                 (
                   $3::text IS NULL
                   OR COALESCE(NULLIF(metadata->>'external_message_id', ''), '') = ''
                 )
                 AND content = $5 AND direction = $6 AND channel = 'max'
                 AND (
                   (created_at >= $7::timestamptz - interval '12 hours' AND created_at <= $7::timestamptz + interval '12 hours')
                   OR created_at >= now() - interval '24 hours'
                 )
               )
             )
           LIMIT 1`,
          [
            opts.tenantId,
            opts.dealId,
            externalMsgId,
            attFileId,
            text,
            direction,
            itemDate.toISOString(),
          ],
        );

        if (existing && (existing.attachment || !attFileId)) {
          if (msg.isForwarded && existing.metadata?.is_forwarded !== true) {
            await query(
              `UPDATE deal_messages
               SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
               WHERE id = $2 AND tenant_id = $3`,
              [
                JSON.stringify({
                  is_forwarded: true,
                  ...(msg.forwardFromUserId ? { forward_from_user_id: msg.forwardFromUserId } : {}),
                }),
                existing.id,
                opts.tenantId,
              ],
            ).catch(() => {});
          }
          continue;
        }

        let attachmentUrl: string | null = null;
        let attachmentType: string | null = null;
        if (att && att.fileId) {
          const stored = await resolveAndStoreMaxAttachment({
            tenantId: opts.tenantId,
            botId: opts.channelAccountId,
            fileId: att.fileId,
            fileName: att.fileName,
            mimeType: att.mimeType,
            isNativeTs: useNative,
            log: opts.log,
          });
          if (stored) {
            attachmentUrl = stored.url;
            attachmentType = stored.mimeType;
          }
        }

        if (!text && !attachmentUrl) continue;

        if (existing) {
          if (attachmentUrl) {
            await query(
              `UPDATE deal_messages
               SET attachment = COALESCE(attachment, $1),
                   attachment_type = COALESCE(attachment_type, $2),
                   content = CASE WHEN BTRIM(content) = '' THEN $5 ELSE content END
               WHERE id = $3 AND tenant_id = $4`,
              [attachmentUrl, attachmentType, existing.id, opts.tenantId, text],
            );
            void mediaEnrichmentService.enrichMessageMedia(opts.tenantId, existing.id).catch(() => {});
          }
          continue;
        }

        if (attachmentUrl) {
          const dupByUrl = await queryOne<{ id: string }>(
            `SELECT id FROM deal_messages
             WHERE tenant_id = $1 AND deal_id = $2 AND attachment = $3 AND delivery_status <> 'failed'
             LIMIT 1`,
            [opts.tenantId, opts.dealId, attachmentUrl],
          );
          if (dupByUrl) continue;
        }

        const itemMetadata = buildMaxAttachmentMetadata({
          externalMessageId: externalMsgId,
          parentMessageId: parentMsgId,
          attachmentFileId: attFileId,
          isForwarded: msg.isForwarded,
          forwardFromUserId: msg.forwardFromUserId,
        });

        const [inserted] = await query<{ id: string }>(
          `INSERT INTO deal_messages
             (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel, delivery_status, attachment, attachment_type, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'max', $8, $9, $10, $11::jsonb, $12)
           RETURNING id`,
          [
            opts.tenantId,
            opts.dealId,
            opts.channelAccountId,
            source,
            direction,
            senderName,
            text,
            msg.out ? "sent" : "neutral",
            attachmentUrl,
            attachmentType,
            JSON.stringify(itemMetadata),
            itemDate.toISOString(),
          ],
        );
        if (inserted && attachmentUrl) {
          void mediaEnrichmentService.enrichMessageMedia(opts.tenantId, inserted.id).catch(() => {});
        }
        if (inserted) {
          if (!msg.out && text) {
            messageTranslationService.autoTranslateIfForeign({
              tenantId: opts.tenantId,
              messageId: inserted.id,
              content: text,
            });
          }
          chatEventBus.emitChatEvent({
            type: "message_created",
            tenantId: opts.tenantId,
            dealId: opts.dealId,
            data: {
              id: inserted.id,
              tenantId: opts.tenantId,
              dealId: opts.dealId,
              channelAccountId: opts.channelAccountId,
              source,
              direction,
              senderName,
              content: text,
              channel: "max",
              deliveryStatus: msg.out ? "sent" : "neutral",
              attachment: attachmentUrl,
              attachmentType,
              metadata: itemMetadata,
              createdAt: itemDate.toISOString(),
            },
            timestamp: new Date().toISOString(),
          });
        }
        insertedCount++;
      }
    }
  });

  opts.log?.info({ dealId: opts.dealId, insertedCount }, "MAX dialog history synced to deal");
  return insertedCount;
}

async function processMaxInbound(request: FastifyRequest, reply: FastifyReply) {
  const body = internalInboundSchema.parse(request.body);

  // Если сообщение пришло с флагом исходящего (например, из нативного приложения оператора),
  // перенаправляем в обработчик нативных исходящих
  if (
    body.out === true ||
    body.fromMe === true ||
    body.direction === "outbound" ||
    body.senderType === "operator"
  ) {
    return processMaxOutbound(request, reply);
  }

  const peerId = (body.peerId || body.chatId || "").trim();
  if (!peerId) {
    return reply.code(400).send({ ok: false, error: "peerId or chatId required" });
  }

  // Дедупликация входящих сообщений (по messageId или по связке tenantId + botId + peerId + text)
  const dedupKey = body.messageId
    ? `max:msg:${body.messageId}`
    : `max:txt:${body.tenantId ?? ""}:${body.botId ?? ""}:${peerId}:${body.text}`;

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

  // Если сессия в max-bridge жива и прислала событие, восстанавливаем статус из 'error'
  await withTenant(tenantId, async (tx) => {
    await tx.query(
      `UPDATE channel_accounts
       SET status = 'connected', status_message = '', last_sync_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'error' AND deleted_at IS NULL`,
      [tenantId, account.id],
    );
  }).catch(() => {});
  const channelAccountId = account.id;

  // Игнорируем сообщения от самого себя
  const selfMaxUserId = (account.remote_user_id || account.external_id || "").trim();
  const peerUser = String(body.maxUserId || "").trim();
  if (selfMaxUserId && (peerUser === selfMaxUserId || peerId === selfMaxUserId)) {
    return reply.send({ ok: true, skipped: "self" });
  }

  // Защита от утечки собственного телефона (INC-113) и извлечение ФИО + телефона из MAX
  const rawPhone = body.phone || body.senderPhone;
  let selfPhone = body.selfPhone ?? null;
  let extracted = extractMaxIdentity({
    names: body.names,
    firstName: body.firstName,
    lastName: body.lastName,
    fullName: body.fullName,
    senderName: body.senderName,
    username: body.username ?? body.senderUsername,
    phone: rawPhone,
    senderPhone: body.senderPhone,
    selfPhone,
    attachments: body.attachments,
  });

  // Если телефон или фамилия не пришли в PUSH_MESSAGE — дозапрашиваем профиль из нативного MaxTsAdapter или max-bridge
  if (!extracted.phone || !extracted.lastName || !extracted.firstName) {
    try {
      const accountRow = await runWithTenantContext(tenantId, () =>
        queryOne<{ credentials: Record<string, unknown> | null }>(
          `SELECT credentials FROM channel_accounts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, channelAccountId],
        ),
      ).catch(() => null);
      if (isNativeMaxAccount(accountRow?.credentials)) {
        const nativeProfile = await messagingRegistry
          .getMaxTsAdapter()
          .lookupProfileByUserId(tenantId, channelAccountId, body.maxUserId, peerId);
        if (nativeProfile.exists) {
          extracted = {
            firstName: extracted.firstName ?? nativeProfile.firstName,
            lastName: extracted.lastName ?? nativeProfile.lastName,
            phone:
              normalizeMaxPhone(extracted.phone, selfPhone) ??
              nativeProfile.phone,
            senderName:
              extracted.firstName || extracted.lastName
                ? [extracted.firstName, extracted.lastName].filter(Boolean).join(" ")
                : ([nativeProfile.firstName, nativeProfile.lastName].filter(Boolean).join(" ") || extracted.senderName),
          };
        }
      } else {
        const bridge = new MaxBridgeService();
        const dialogsResp = await bridge.getPrivateDialogs({
          botId: channelAccountId,
          dialogLimit: 30,
          messageLimit: 5,
        });
        if (dialogsResp.ok && Array.isArray(dialogsResp.dialogs)) {
          selfPhone = selfPhone ?? dialogsResp.selfPhone ?? null;
          const foundDialog = dialogsResp.dialogs.find(
            (d) =>
              d.chatId === peerId ||
              (peerUser && (d.userId === peerUser || d.chatId === peerUser)),
          );
          if (foundDialog) {
            const dialogIdentity = extractMaxIdentity({
              names: foundDialog.names,
              firstName: foundDialog.firstName,
              lastName: foundDialog.lastName,
              username: foundDialog.username,
              phone: foundDialog.phone,
              selfPhone,
            });
            extracted = {
              firstName: extracted.firstName ?? dialogIdentity.firstName,
              lastName: extracted.lastName ?? dialogIdentity.lastName,
              phone:
                normalizeMaxPhone(extracted.phone, selfPhone) ??
                dialogIdentity.phone,
              senderName:
                extracted.firstName || extracted.lastName
                  ? [extracted.firstName, extracted.lastName].filter(Boolean).join(" ")
                  : dialogIdentity.senderName,
            };
          }
        }
      }
    } catch {
      // Игнорируем временный сбой адаптера/бриджа, чтобы не блокировать приём сообщения
    }
  }

  const peerPhone = extracted.phone;

  const chatThreadId = (body.threadId || body.chat_thread_id || peerId).trim();
  const peerUserId = (body.maxUserId || body.senderUserId || "").trim() || undefined;

  const senderName = extracted.senderName;
  const cleanFirstName = extracted.firstName;
  const cleanLastName = extracted.lastName;

  const bodyAtts = Array.isArray(body.attachments) ? body.attachments : [];
  const storedAttachments =
    bodyAtts.length > 0
      ? await storeMaxMessageAttachments({
          tenantId,
          attachments: bodyAtts,
          downloadMedia: (fileId) =>
            downloadMaxMediaBuffer({
              tenantId,
              botId: channelAccountId,
              fileId,
            }),
          log: request.log,
        })
      : [];

  const isBotFlag =
    body.isBot === true ||
    body.is_bot === true ||
    body.type === "bot" ||
    body.senderType === "bot";

  const maxProfile: ChannelProfile = {
    firstName: cleanFirstName,
    lastName: cleanLastName,
    phone: peerPhone,
    username: body.username ?? body.senderUsername ?? undefined,
    isBot: isBotFlag,
  };

  if (
    isBotSender({
      channel: "max",
      chatId: peerId,
      senderUsername: maxProfile.username,
      senderName,
      profile: maxProfile,
      isBot: isBotFlag,
    })
  ) {
    request.log.info(
      { peerId, username: maxProfile.username, botId: channelAccountId },
      `Skipping lead/contact creation: sender is a bot (@${(maxProfile.username || "unknown").replace(/^@/, "")})`,
    );
    return reply.send({ ok: true, skipped: "bot" });
  }

  const baseMessageId = body.messageId ? String(body.messageId) : undefined;
  const baseText = (body.text ?? "").trim();
  const baseTs = Date.now();
  const inboundEntries =
    storedAttachments.length > 0
      ? storedAttachments.map((item, pos) => ({
          text: (pos === 0 && baseText) || item.textLabel,
          attachment: item.url,
          attachmentType: item.mimeType,
          externalMessageId: baseMessageId ? maxAttachmentExternalId(baseMessageId, item.index) : undefined,
          sourceMetadata: baseMessageId
            ? buildMaxAttachmentMetadata({
                externalMessageId: maxAttachmentExternalId(baseMessageId, item.index),
                parentMessageId: baseMessageId,
                attachmentFileId: item.attachment.fileId ?? null,
              })
            : item.attachment.fileId
              ? buildMaxAttachmentMetadata({ attachmentFileId: item.attachment.fileId })
              : undefined,
          messageTimestamp: new Date(baseTs + item.index),
        }))
      : [
          {
            text: body.text,
            attachment: undefined as string | undefined,
            attachmentType: undefined as string | undefined,
            externalMessageId: baseMessageId,
            sourceMetadata: baseMessageId
              ? buildMaxAttachmentMetadata({ externalMessageId: baseMessageId, parentMessageId: baseMessageId })
              : undefined,
            messageTimestamp: new Date(baseTs),
          },
        ];

  const crm = new CrmPipelineService();
  let crmResult: Awaited<ReturnType<typeof crm.processIncoming>> | null = null;
  for (const entry of inboundEntries) {
    const res = await runWithTenantContext(tenantId, () =>
      crm.processIncoming({
        tenantId,
        channel: "max",
        channelAccountId,
        chatId: peerId,
        peerUserId,
        chatThreadId,
        text: entry.text,
        senderName,
        senderPhone: peerPhone,
        attachment: entry.attachment,
        attachmentType: entry.attachmentType,
        externalMessageId: entry.externalMessageId,
        messageTimestamp: entry.messageTimestamp,
        sourceMetadata: entry.sourceMetadata,
        isBot: isBotFlag,
        profile: maxProfile,
      }),
    );
    if (!crmResult) {
      crmResult = res;
    }
    if (res.isPersonal || res.isBot) {
      break;
    }
  }

  if (!crmResult) {
    return reply.send({ ok: true });
  }

  if (crmResult.isPersonal) {
    request.log.info({ peerId }, "Personal MAX contact message ignored by CRM");
    return reply.send({ ok: true });
  }

  if (crmResult.isBot) {
    request.log.info({ peerId, username: body.username }, "Bot MAX sender ignored by CRM");
    return reply.send({ ok: true, skipped: "bot" });
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

    if (outcome.kind === "no_agent") {
      request.log.info(
        { channelAccountId, peerId },
        "AI auto-reply skipped: channel not bound to agent (skipped_bot_disabled_for_channel)",
      );
    } else if (outcome.kind === "replied") {
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
  const bodyAtts = Array.isArray(body.attachments) ? body.attachments : [];
  const storedAttachments =
    bodyAtts.length > 0
      ? await storeMaxMessageAttachments({
          tenantId: account.tenant_id,
          attachments: bodyAtts,
          downloadMedia: (fileId) =>
            downloadMaxMediaBuffer({
              tenantId: account.tenant_id,
              botId: account.id,
              fileId,
            }),
          log: request.log,
        })
      : [];

  const baseMessageId = body.messageId ? String(body.messageId) : undefined;
  const baseText = (body.text ?? "").trim();
  const baseTs = Date.now();
  const outboundEntries =
    storedAttachments.length > 0
      ? storedAttachments.map((item, pos) => ({
          text: (pos === 0 && baseText) || item.textLabel,
          attachment: item.url,
          attachmentType: item.mimeType,
          externalMessageId: baseMessageId ? maxAttachmentExternalId(baseMessageId, item.index) : undefined,
          sourceMetadata: buildMaxAttachmentMetadata({
            externalMessageId: baseMessageId ? maxAttachmentExternalId(baseMessageId, item.index) : undefined,
            parentMessageId: baseMessageId ?? null,
            attachmentFileId: item.attachment.fileId ?? null,
          }),
          messageTimestamp: new Date(baseTs + item.index),
        }))
      : [
          {
            text: body.text,
            attachment: undefined as string | undefined,
            attachmentType: undefined as string | undefined,
            externalMessageId: baseMessageId,
            sourceMetadata: baseMessageId
              ? buildMaxAttachmentMetadata({ externalMessageId: baseMessageId, parentMessageId: baseMessageId })
              : undefined,
            messageTimestamp: new Date(baseTs),
          },
        ];

  let result: Awaited<ReturnType<typeof crm.processNativeOutbound>> = {
    dealId: null,
    messageId: null,
    pausedUntil: null,
  };
  for (const entry of outboundEntries) {
    const res = await runWithTenantContext(account.tenant_id, () =>
      crm.processNativeOutbound({
        tenantId: account.tenant_id,
        channel: "max",
        channelAccountId: account.id,
        chatId: peerId,
        peerUserId: peerUser || null,
        senderPhone: peerPhone || null,
        username: body.username ?? body.senderUsername ?? null,
        text: entry.text,
        senderName: "Менеджер",
        pauseMinutes: 60,
        attachment: entry.attachment,
        attachmentType: entry.attachmentType,
        externalMessageId: entry.externalMessageId,
        messageTimestamp: entry.messageTimestamp,
        sourceMetadata: entry.sourceMetadata,
      }),
    );
    if (!result.messageId && res.messageId) {
      result = res;
    } else if (!result.dealId && res.dealId) {
      result = res;
    }
  }

  request.log.info(
    { peerId, peerUser, peerPhone, text: body.text, dealId: result.dealId, messageId: result.messageId },
    "MAX native outbound processed into CRM deal",
  );

  return reply.send({
    ok: true,
    ...result,
  });
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Проверка внутреннего сервисного токена VOXLY_SERVICE_TOKEN для вызовов от max-bridge.
 *
 * Токен задан — проверяется строго (401 при отсутствии или несовпадении).
 * Токен не задан — запрос пропускается с предупреждением в журнале: так сервис
 * не отваливается на окружениях, где токен ещё не выдан мосту. Для закрытия
 * маршрутов достаточно прописать VOXLY_SERVICE_TOKEN у backend и max-bridge.
 */
let warnedMissingServiceToken = false;

async function requireMaxServiceToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = getEnv().VOXLY_SERVICE_TOKEN;

  if (!expected) {
    if (!warnedMissingServiceToken) {
      warnedMissingServiceToken = true;
      request.log.warn(
        "VOXLY_SERVICE_TOKEN is not set: internal MAX routes are unauthenticated",
      );
    }
    return;
  }

  const headerToken =
    (typeof request.headers["x-voxly-service-token"] === "string"
      ? request.headers["x-voxly-service-token"]
      : undefined) ||
    (typeof request.headers["x-service-token"] === "string"
      ? request.headers["x-service-token"]
      : undefined) ||
    (typeof request.headers.authorization === "string" &&
    request.headers.authorization.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length)
      : undefined);

  if (!headerToken || !safeTokenEqual(headerToken.trim(), expected)) {
    return reply.status(401).send({ ok: false, error: "Invalid internal service token" });
  }
}

function formatMaxAccountLabel(
  name: string,
  firstName?: string | null,
  preserveExisting = false,
): string {
  const cleanName = name.trim();
  if (preserveExisting) return cleanName;
  const cleanFirst = firstName?.trim();
  if (!cleanFirst) return cleanName;
  const suffix = `(${cleanFirst})`;
  if (cleanName.toLowerCase().includes(suffix.toLowerCase())) {
    return cleanName;
  }
  return `${cleanName} ${suffix}`;
}

function encryptMaxSessionBackup(backup: MaxSessionBackup | null | undefined): string | null {
  if (!backup || !backup.token) return null;
  try {
    return encryptSecret(JSON.stringify(backup));
  } catch {
    if (isEncryptionConfigured()) {
      throw new Error("Failed to encrypt MAX session backup");
    }
    return null;
  }
}

function decryptMaxSessionBackup(
  credentials: Record<string, unknown> | null | undefined,
): MaxSessionBackup | null {
  const raw = credentials?.encrypted_session;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(decryptSecret(raw)) as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as MaxSessionBackup).token === "string") {
      return parsed as MaxSessionBackup;
    }
    return null;
  } catch {
    return null;
  }
}

async function listActiveMaxBotsPayload() {
  const bots = await runWithPlatformScope(() =>
    query<{
      id: string;
      tenant_id: string;
      label: string;
      external_id: string;
      remote_user_id: string | null;
      status: string;
      credentials: Record<string, unknown> | null;
    }>(
      `SELECT id, tenant_id, label, external_id, remote_user_id, status, credentials
       FROM channel_accounts
       WHERE channel = 'max'
         AND status <> 'disabled'
         AND deleted_at IS NULL
         AND COALESCE(credentials->>'provider', credentials->>'adapter', 'max-bridge') NOT IN ('native-ts', 'ts')
       ORDER BY created_at ASC`,
    ),
  );

  return {
    ok: true,
    bots: bots
      .filter((b) => !isNativeMaxAccount(b.credentials))
      .map((b) => ({
        id: b.id,
        botId: b.id,
        tenantId: b.tenant_id,
        name: b.label,
        status: b.status,
        maxUserId: b.remote_user_id || b.external_id,
        sessionBackup: decryptMaxSessionBackup(b.credentials),
      })),
  };
}

async function upsertMaxBotRecord(
  body: z.infer<typeof internalBotUpsertSchema>,
): Promise<string> {
  const encryptedSession = encryptMaxSessionBackup(body.sessionBackup);

  const botId = await withTenant(body.tenantId, async (tx) => {
    const extId = body.maxUserId || body.username || body.name;

    let existing: { id: string; label: string } | null = null;
    if (body.botId) {
      existing = await tx.queryOne<{ id: string; label: string }>(
        `SELECT id, label FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL
         LIMIT 1`,
        [body.tenantId, body.botId],
      );
    }

    if (!existing) {
      existing = await tx.queryOne<{ id: string; label: string }>(
        `SELECT id, label FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
           AND (external_id = $2 OR label = $3)
         LIMIT 1`,
        [body.tenantId, extId, body.name],
      );
    }

    const label = existing && body.botId
      ? existing.label
      : formatMaxAccountLabel(body.name, body.firstName, Boolean(existing));

    if (existing) {
      await tx.query(
        `UPDATE channel_accounts
         SET status = 'connected',
             status_message = '',
             label = $3,
             external_id = $4,
             remote_user_id = $5,
             credentials = CASE
               WHEN $6::text IS NOT NULL THEN
                 COALESCE(credentials, '{}'::jsonb) || jsonb_build_object(
                   'encrypted_session', $6::text,
                   'session_backed_up_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 )
               ELSE credentials
             END,
             credentials_encrypted = CASE WHEN $6::text IS NOT NULL THEN true ELSE credentials_encrypted END,
             connected_at = COALESCE(connected_at, now()),
             last_sync_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [body.tenantId, existing.id, label, extId, body.maxUserId || null, encryptedSession],
      );
      return existing.id;
    }

    const initialCreds = encryptedSession
      ? JSON.stringify({
          encrypted_session: encryptedSession,
          session_backed_up_at: new Date().toISOString(),
        })
      : "{}";

    const inserted = await tx.queryOneOrThrow<{ id: string }>(
      `INSERT INTO channel_accounts (
         tenant_id, channel, label, external_id, status, status_message,
         remote_user_id, credentials, credentials_encrypted, connected_at, last_sync_at
       )
       VALUES ($1, 'max', $2, $3, 'connected', '', $4, $5::jsonb, $6, now(), now())
       RETURNING id`,
      [body.tenantId, label, extId, body.maxUserId || null, initialCreds, Boolean(encryptedSession)],
    );
    return inserted.id;
  });

  invalidateMaxBridgeLiveBotsCache();
  void import("./channel-history-sync.service.js")
    .then(({ enqueueChannelHistorySync }) =>
      enqueueChannelHistorySync({
        tenantId: body.tenantId,
        channelAccountId: botId,
        channel: "max",
      }),
    )
    .catch(() => {});

  return botId;
}

async function updateMaxBotStatusRecord(
  body: z.infer<typeof internalBotStatusSchema> & { tenantId?: string },
): Promise<void> {
  const encryptedSession = encryptMaxSessionBackup(body.sessionBackup);
  const clearSession = Boolean(body.clearSession && body.status === "error");

  let tenantId = body.tenantId;
  if (!tenantId) {
    const found = await runWithPlatformScope(() =>
      queryOne<{ tenant_id: string }>(
        `SELECT tenant_id FROM channel_accounts
         WHERE id = $1 AND channel = 'max' AND deleted_at IS NULL`,
        [body.botId],
      ),
    );
    tenantId = found?.tenant_id;
  }

  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE channel_accounts
         SET status = $3,
             status_message = $4,
             remote_user_id = COALESCE($5, remote_user_id),
             connected_at = CASE WHEN $3 = 'connected' AND connected_at IS NULL THEN now() ELSE connected_at END,
             last_sync_at = CASE WHEN $3 = 'connected' THEN now() ELSE last_sync_at END,
             credentials = CASE
               WHEN $6::boolean THEN COALESCE(credentials, '{}'::jsonb) - 'encrypted_session' - 'session_backed_up_at'
               WHEN $7::text IS NOT NULL THEN
                 COALESCE(credentials, '{}'::jsonb) || jsonb_build_object(
                   'encrypted_session', $7::text,
                   'session_backed_up_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 )
               ELSE credentials
             END,
             credentials_encrypted = CASE
               WHEN $6::boolean THEN false
               WHEN $7::text IS NOT NULL THEN true
               ELSE credentials_encrypted
             END
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL AND status <> 'disabled'`,
        [
          tenantId,
          body.botId,
          body.status,
          body.status === "connected" ? "" : body.statusMessage,
          body.maxUserId || null,
          clearSession,
          encryptedSession,
        ],
      );
    });
  }

  invalidateMaxBridgeLiveBotsCache();
}

async function deleteMaxBotRecord(body: z.infer<typeof internalBotDeleteSchema>): Promise<void> {
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
    invalidateMaxBridgeLiveBotsCache();
  }
}

function registerMaxInternalEndpoints(app: FastifyInstance, prefix = ""): void {
  // Список подключений MAX для восстановления сессий в max-bridge (включая error/pending)
  app.get(`${prefix}/bots/active`, async (_request, reply) => {
    return reply.send(await listActiveMaxBotsPayload());
  });

  // Вызов из max-bridge при успешной авторизации сессии
  app.post(`${prefix}/bots/upsert`, async (request, reply) => {
    const body = internalBotUpsertSchema.parse(request.body);
    const botId = await upsertMaxBotRecord(body);
    return reply.send({ ok: true, botId });
  });

  // Двусторонний синк статуса из max-bridge (connected / фатальная error)
  app.post(`${prefix}/bots/status`, async (request, reply) => {
    const body = internalBotStatusSchema.parse(request.body);
    await updateMaxBotStatusRecord(body);
    return reply.send({ ok: true });
  });

  // Удаление сессии бота
  app.post(`${prefix}/bots/delete`, async (request, reply) => {
    const body = internalBotDeleteSchema.parse(request.body ?? {});
    await deleteMaxBotRecord(body);
    return reply.send({ ok: true });
  });

  // Приём входящих сообщений MAX из max-bridge и доставка в CRM + AI-автоответ
  app.post(`${prefix}/inbound`, processMaxInbound);

  // Нативное исходящее сообщение оператора из мобильного MAX → запись в CRM + AI handoff
  app.post(`${prefix}/outbound`, processMaxOutbound);
}

export async function maxInternalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireMaxServiceToken);
  registerMaxInternalEndpoints(app);
}

export default async function maxIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const service = new MaxBridgeService();

  // Дублирование внутренних маршрутов под префиксом /internal/ для обратной совместимости
  // (обязательно закрыты requireMaxServiceToken в отдельном encapsulated sub-plugin)
  await app.register(async (internalAliasApp) => {
    internalAliasApp.addHook("preHandler", requireMaxServiceToken);
    registerMaxInternalEndpoints(internalAliasApp, "/internal");
  });

  // Пользовательские эндпоинты авторизации по QR и проверки сессии
  const protectedRoutes = async (subApp: FastifyInstance) => {
    await subApp.register(authenticatePlugin);

    const guards = [
      subApp.requirePermission("tenant:admin"),
      subApp.requireModule("max"),
    ];

    const resolveOwnedMaxAccount = async (tenantId: string, botId?: string) => {
      if (!botId) return null;
      const acc = await queryOne<{
        id: string;
        label: string;
        status: string;
        credentials: Record<string, unknown> | null;
        remote_user_id: string | null;
        external_id: string;
      }>(
        `SELECT id, label, status, credentials, remote_user_id, external_id FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [tenantId, botId],
      );
      if (!acc) {
        throw new NotFoundError("Подключение MAX не найдено");
      }
      return acc;
    };

    const resolveQrProvider = (
      explicit?: "max-bridge" | "native-ts",
      creds?: Record<string, unknown> | null,
    ): "max-bridge" | "native-ts" => {
      if (explicit) return explicit;
      return isNativeMaxAccount(creds) ? "native-ts" : "max-bridge";
    };

    subApp.post("/auth/qr/start", { onRequest: guards }, async (request, reply) => {
      const body = qrStartSchema.parse(request.body ?? {});
      const owned = await resolveOwnedMaxAccount(request.tenant_id, body.botId);
      const effectiveName = owned?.label || body.name;
      const provider = resolveQrProvider(body.provider, owned?.credentials);
      const result: { ok: boolean; status: string; name: string; botId?: string | null; qr?: string | null } =
        provider === "native-ts"
          ? await maxNativeAuthService.startQr({
              tenantId: request.tenant_id,
              name: effectiveName,
              botId: owned?.id,
            })
          : await service.startQr(request.tenant_id, effectiveName, owned?.id);
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
      const owned = await resolveOwnedMaxAccount(request.tenant_id, queryParam.botId);
      const effectiveName = owned?.label || queryParam.name;
      const provider = resolveQrProvider(queryParam.provider, owned?.credentials);
      const result =
        provider === "native-ts"
          ? maxNativeAuthService.getQrStatus({
              tenantId: request.tenant_id,
              name: effectiveName,
              botId: owned?.id,
            })
          : await service.checkStatus(request.tenant_id, effectiveName, owned?.id);

      if (result && result.status === "qr_ready" && typeof result.qr === "string" && result.qr.length > 0) {
        if (!result.qr.startsWith("data:image/")) {
          try {
            result.qr = await QRCode.toDataURL(result.qr, { margin: 1, width: 300 });
          } catch (err) {
            request.log.error(err, "Failed to convert MAX QR to data URL on status check");
          }
        }
      } else if (result && result.status === "qr_ready" && !result.qr && provider !== "native-ts") {
        try {
          const buffer = await service.getQrPng(request.tenant_id, effectiveName, owned?.id);
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
      const owned = await resolveOwnedMaxAccount(request.tenant_id, queryParam.botId);
      const effectiveName = owned?.label || queryParam.name;
      const provider = resolveQrProvider(queryParam.provider, owned?.credentials);
      if (provider === "native-ts") {
        const st = maxNativeAuthService.getQrStatus({
          tenantId: request.tenant_id,
          name: effectiveName,
          botId: owned?.id,
        });
        if (st.status !== "qr_ready" || !st.qr) {
          return reply.status(404).send({ error: "QR not ready" });
        }
        const dataUrl = await QRCode.toDataURL(st.qr, { margin: 1, width: 300 });
        const b64 = dataUrl.split(",")[1] ?? "";
        return reply.type("image/png").send(Buffer.from(b64, "base64"));
      }
      const buffer = await service.getQrPng(request.tenant_id, effectiveName, owned?.id);
      if (!buffer) {
        return reply.status(404).send({ error: "QR not ready" });
      }
      return reply.type("image/png").send(buffer);
    });

    subApp.post("/auth/qr/password", { onRequest: guards }, async (request, reply) => {
      const body = qrPasswordSchema.parse(request.body);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, body.botId);
      const effectiveName = owned?.label || body.name;
      const provider = resolveQrProvider(body.provider, owned?.credentials);
      const result =
        provider === "native-ts"
          ? await maxNativeAuthService.submitQrPassword({
              tenantId: request.tenant_id,
              name: effectiveName,
              password: body.password,
              botId: owned?.id,
            })
          : await service.submitPassword(request.tenant_id, effectiveName, body.password, owned?.id);
      return reply.send({ data: result });
    });

    // Запасной нативный вход по телефону + SMS / звонок + облачный пароль 2FA
    subApp.post("/auth/phone/start", { onRequest: guards }, async (request, reply) => {
      const body = phoneStartSchema.parse(request.body);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, body.botId);
      const data = await maxNativeAuthService.startPhoneAuth({
        tenantId: request.tenant_id,
        phone: body.phone,
        name: owned?.label || body.name,
        botId: owned?.id,
      });
      return reply.send({ data });
    });

    subApp.post("/auth/phone/verify", { onRequest: guards }, async (request, reply) => {
      const body = phoneVerifySchema.parse(request.body);
      const data = await maxNativeAuthService.verifyPhoneCode({
        tenantId: request.tenant_id,
        authSessionId: body.authSessionId,
        code: body.code,
      });
      return reply.send({ data });
    });

    subApp.post("/auth/phone/call-check", { onRequest: guards }, async (request, reply) => {
      const body = phoneCallCheckSchema.parse(request.body);
      const data = await maxNativeAuthService.checkPhoneCallTrack({
        tenantId: request.tenant_id,
        authSessionId: body.authSessionId,
      });
      return reply.send({ data });
    });

    subApp.post("/auth/phone/password", { onRequest: guards }, async (request, reply) => {
      const body = phonePasswordSchema.parse(request.body);
      const data = await maxNativeAuthService.submitPhonePassword({
        tenantId: request.tenant_id,
        authSessionId: body.authSessionId,
        password: body.password,
      });
      return reply.send({ data });
    });

    subApp.post("/accounts/:id/check", { onRequest: guards }, async (request, reply) => {
      const { id } = maxAccountParamsSchema.parse(request.params);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, id);
      if (!owned) {
        throw new NotFoundError("Подключение MAX не найдено");
      }

      if (isNativeMaxAccount(owned.credentials)) {
        const tsAdapter = messagingRegistry.getMaxTsAdapter();
        let alive = false;
        let reason: string | undefined;
        try {
          alive = await tsAdapter.connectAccount(request.tenant_id, id);
          if (!alive) {
            const refreshed = await queryOne<{ status_message: string }>(
              `SELECT status_message FROM channel_accounts
               WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
              [request.tenant_id, id],
            );
            reason = refreshed?.status_message || "Сессия MAX не подключена";
          }
        } catch (err) {
          alive = false;
          reason = err instanceof Error ? err.message : "Ошибка проверки сессии MAX";
        }
        return reply.send({
          data: {
            alive,
            ...(reason ? { reason } : {}),
          },
        });
      }

      const backup = decryptMaxSessionBackup(owned.credentials);
      const checkRes = await service.checkSession(id, backup);

      await updateMaxBotStatusRecord({
        tenantId: request.tenant_id,
        botId: id,
        status: checkRes.alive ? "connected" : "error",
        statusMessage: checkRes.alive ? "" : (checkRes.reason ?? "Сессия MAX недействительна"),
        maxUserId: checkRes.maxUserId ?? undefined,
        sessionBackup: checkRes.alive ? checkRes.sessionBackup ?? undefined : undefined,
      });

      return reply.send({
        data: {
          alive: checkRes.alive,
          reason: checkRes.reason,
        },
      });
    });

    subApp.get("/accounts/:id/sessions", { onRequest: guards }, async (request, reply) => {
      const { id } = maxAccountParamsSchema.parse(request.params);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, id);
      if (!owned) {
        throw new NotFoundError("Подключение MAX не найдено");
      }
      if (!isNativeMaxAccount(owned.credentials)) {
        return reply.send({
          data: {
            provider: "max-bridge",
            sessions: [],
            unsupportedReason:
              "Просмотр активных сессий MAX (opcode 96) доступен после переключения аккаунта на нативный TypeScript-клиент.",
          },
        });
      }
      const sessions = await messagingRegistry.getMaxTsAdapter().getActiveSessions(request.tenant_id, id);
      return reply.send({
        data: {
          provider: "native-ts",
          sessions,
        },
      });
    });

    subApp.post("/accounts/:id/sessions/close-others", { onRequest: guards }, async (request, reply) => {
      const { id } = maxAccountParamsSchema.parse(request.params);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, id);
      if (!owned) {
        throw new NotFoundError("Подключение MAX не найдено");
      }
      if (!isNativeMaxAccount(owned.credentials)) {
        throw new AppError(
          400,
          "MAX_NATIVE_REQUIRED",
          "Завершение других сессий MAX (opcode 97) поддерживается только на нативном провайдере native-ts",
        );
      }
      const closed = await messagingRegistry.getMaxTsAdapter().closeOtherSessions(request.tenant_id, id);
      return reply.send({
        data: {
          ok: true,
          closed,
        },
      });
    });

    subApp.post("/accounts/:id/provider", { onRequest: guards }, async (request, reply) => {
      const { id } = maxAccountParamsSchema.parse(request.params);
      const body = providerSwitchSchema.parse(request.body);
      const owned = await resolveOwnedMaxAccount(request.tenant_id, id);
      if (!owned) {
        throw new NotFoundError("Подключение MAX не найдено");
      }

      if (body.provider === "native-ts") {
        let encryptedSession =
          typeof owned.credentials?.encrypted_session === "string"
            ? owned.credentials.encrypted_session
            : null;
        const hasToken =
          Boolean(decryptMaxSessionBackup(owned.credentials)) ||
          typeof owned.credentials?.encrypted_token === "string";

        if (!hasToken && owned.status !== "error") {
          const snap = await service.checkSession(id, null).catch(() => null);
          if (snap?.sessionBackup) {
            encryptedSession = encryptMaxSessionBackup(snap.sessionBackup);
          }
        }

        await service.disconnectSession(id);
        await withTenant(request.tenant_id, async (tx) => {
          await tx.query(
            `UPDATE channel_accounts
             SET credentials = COALESCE(credentials, '{}'::jsonb) ||
               jsonb_strip_nulls(
                 jsonb_build_object(
                   'provider', 'native-ts',
                   'encrypted_session', $3::text
                 )
               )
             WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
            [request.tenant_id, id, encryptedSession],
          );
        });
        invalidateMaxBridgeLiveBotsCache();

        let connected = false;
        if (owned.status !== "disabled") {
          connected = await messagingRegistry.getMaxTsAdapter().connectAccount(request.tenant_id, id);
        }
        return reply.send({
          data: {
            ok: true,
            provider: "native-ts",
            connected,
          },
        });
      }

      messagingRegistry.getMaxTsAdapter().disconnectAccount(id);
      await withTenant(request.tenant_id, async (tx) => {
        await tx.query(
          `UPDATE channel_accounts
           SET credentials = COALESCE(credentials, '{}'::jsonb) || jsonb_build_object('provider', 'max-bridge')
           WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
          [request.tenant_id, id],
        );
      });
      invalidateMaxBridgeLiveBotsCache();

      const fresh = await resolveOwnedMaxAccount(request.tenant_id, id);
      const backup = decryptMaxSessionBackup(fresh?.credentials);
      let connected = false;
      if (fresh && fresh.status !== "disabled" && backup) {
        const check = await service.checkSession(id, backup).catch(() => null);
        connected = Boolean(check?.alive);
      }
      return reply.send({
        data: {
          ok: true,
          provider: "max-bridge",
          connected,
        },
      });
    });
  };

  await app.register(protectedRoutes);
}
