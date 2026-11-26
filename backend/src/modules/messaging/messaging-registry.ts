import { queryOne, runWithTenantContext } from "../../db/client.js";
import type {
  IMessagingAdapter,
  SendMessageParams,
  SentMessageResult,
  IncomingEvent,
  Unsubscribe,
  OutboundAttachment,
} from "./adapters/IMessagingAdapter.js";
import { MaxBridgeAdapter } from "./adapters/max/MaxBridgeAdapter.js";
import { MaxTsAdapter } from "./adapters/max/MaxTsAdapter.js";
import { MaxGreenApiAdapter } from "./adapters/max/MaxGreenApiAdapter.js";
import type { ChannelProfile, CrmPipelineService } from "../crm/crm-pipeline.service.js";
import type { OutboundSender, OutboundMessage, OutboundSendResult } from "../channels/outbound-registry.js";
import { resolveOutboundMedia, isMeaningfulCaption } from "../channels/media-resolver.js";
import { normalizeMaxPhone } from "../channels/max-identity.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { mediaEnrichmentService } from "../crm/media/media-enrichment.service.js";
import {
  buildMaxAttachmentMetadata,
  maxAttachmentDefaultLabel,
  maxAttachmentExternalId,
  storeMaxMessageAttachments,
} from "../channels/max-attachments.js";
import { MaxService } from "../../services/max.service.js";

// ---------------------------------------------------------------------------
// MessagingRegistry — Центральный реестр и диспетчер адаптеров мессенджеров.
//
// Управляет жизненным циклом и маршрутизацией адаптеров:
//   - MaxBridgeAdapter (существующий sidecar PyMax / voxly-max-bridge:latest)
//   - MaxTsAdapter (нативный TypeScript WebSocket клиент по спецификации v11)
//   - MaxGreenApiAdapter (REST API шлюз GREEN-API для корпоративных SLA)
//
// Маршрутизирует исходящие сообщения и автоматически направляет входящие
// сообщения в CrmPipelineService с изоляцией tenant_id.
// ---------------------------------------------------------------------------

export class MessagingRegistry {
  private readonly adapters = new Map<string, IMessagingAdapter>();
  private readonly maxTsAdapter = new MaxTsAdapter();
  private crmPipeline: CrmPipelineService | null = null;
  private readonly eventUnsubscribers: Unsubscribe[] = [];

  constructor(crmPipeline?: CrmPipelineService) {
    if (crmPipeline) {
      this.crmPipeline = crmPipeline;
    }
    this.initDefaultAdapters();
  }

  private initDefaultAdapters() {
    this.registerAdapter(new MaxBridgeAdapter());
    this.registerAdapter(this.maxTsAdapter);
    this.registerAdapter(new MaxGreenApiAdapter());
  }

  getMaxTsAdapter(): MaxTsAdapter {
    return this.maxTsAdapter;
  }

  async start(): Promise<void> {
    await this.maxTsAdapter.startAllNativeSessions();
  }

  private async getCrmPipeline(): Promise<CrmPipelineService> {
    if (!this.crmPipeline) {
      const { CrmPipelineService } = await import("../crm/crm-pipeline.service.js");
      this.crmPipeline = new CrmPipelineService();
    }
    return this.crmPipeline;
  }

  /**
   * Регистрация адаптера в реестре с автоподпиской на входящие события
   */
  registerAdapter(adapter: IMessagingAdapter): void {
    const key = `${adapter.channel}:${adapter.providerName}`;
    this.adapters.set(key, adapter);

    // Подписка на входящие события для передачи в пайплайн CRM
    const unsubscribe = adapter.subscribeToEvents((event: IncomingEvent) => {
      this.handleIncomingEvent(event).catch(() => {});
    });
    this.eventUnsubscribers.push(unsubscribe);
  }

  /**
   * Получение адаптера по каналу и имени провайдера
   */
  getAdapter(channel: string, providerName: string): IMessagingAdapter | undefined {
    return this.adapters.get(`${channel}:${providerName}`);
  }

  /**
   * Резолвинг адаптера для конкретного подключенного аккаунта.
   * Выбирает провайдер на основе настроек в channel_accounts.credentials:
   *   - credentials.provider === 'native-ts' -> MaxTsAdapter
   *   - credentials.provider === 'green-api' -> MaxGreenApiAdapter
   *   - default -> MaxBridgeAdapter (обратная совместимость)
   */
  async resolveAdapterForAccount(
    tenantId: string,
    channelAccountId: string,
    channel: string,
  ): Promise<IMessagingAdapter | undefined> {
    if (channel !== "max") {
      return undefined;
    }

    const account = await queryOne<{
      credentials?: {
        provider?: string;
        adapter?: string;
      };
    }>(
      `SELECT credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = $3 AND deleted_at IS NULL`,
      [tenantId, channelAccountId, channel],
    );

    const provider = account?.credentials?.provider || account?.credentials?.adapter;
    if (provider === "native-ts" || provider === "ts") {
      return this.getAdapter("max", "max-native-ts");
    }
    if (provider === "green-api" || provider === "greenapi") {
      return this.getAdapter("max", "max-green-api");
    }

    // По умолчанию для существующих аккаунтов MAX используется max-bridge
    return this.getAdapter("max", "max-bridge");
  }

  /**
   * Универсальная отправка сообщения через IMessagingAdapter
   */
  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    const adapter = await this.resolveAdapterForAccount(
      params.tenantId,
      params.channelAccountId,
      "max",
    );

    if (!adapter) {
      return {
        ok: false,
        error: `Не найден адаптер для аккаунта ${params.channelAccountId}`,
      };
    }

    return adapter.sendMessage(params);
  }

  /**
   * Обработка входящего события от любого подключенного адаптера
   */
  private async handleIncomingEvent(event: IncomingEvent): Promise<void> {
    if (event.eventType !== "message" || !event.message) {
      return;
    }

    const msg = event.message;
    const rawPayload = msg.rawPayload ?? {};
    const peerUserId = typeof rawPayload.peerUserId === "string" ? rawPayload.peerUserId : msg.senderId;
    const selfPhone = typeof rawPayload.selfPhone === "string" ? rawPayload.selfPhone : null;
    const peerPhone =
      event.channel === "max"
        ? normalizeMaxPhone(msg.senderPhone, selfPhone)
        : msg.senderPhone;

    const isForwarded = rawPayload.isForwarded === true;
    const forwardFromUserId =
      typeof rawPayload.forwardFromUserId === "string" ? rawPayload.forwardFromUserId : null;
    const msgAtts = Array.isArray(msg.attachments) ? msg.attachments : [];

    const storedAttachments =
      event.channel === "max" && msgAtts.length > 0
        ? await storeMaxMessageAttachments({
            tenantId: event.tenantId,
            attachments: msgAtts,
            downloadMedia: (fileId) =>
              this.maxTsAdapter.downloadMedia(event.tenantId, event.channelAccountId, fileId),
          })
        : [];

    const baseText = msg.text.trim();
    const persistedEntries =
      storedAttachments.length > 0
        ? storedAttachments.map((item, pos) => ({
            text: (pos === 0 && baseText) || item.textLabel,
            attachmentUrl: item.url,
            attachmentType: item.mimeType,
            externalMessageId: msg.id ? maxAttachmentExternalId(msg.id, item.index) : undefined,
            sourceMetadata: buildMaxAttachmentMetadata({
              externalMessageId: msg.id ? maxAttachmentExternalId(msg.id, item.index) : undefined,
              parentMessageId: msg.id ?? null,
              attachmentFileId: item.attachment.fileId ?? null,
              isForwarded,
              forwardFromUserId,
            }),
            messageTimestamp: new Date(msg.timestamp + item.index),
          }))
        : [
            {
              text:
                baseText ||
                (msgAtts[0]
                  ? maxAttachmentDefaultLabel(
                      msgAtts[0].type,
                      msgAtts[0].fileName,
                      msgAtts[0].mimeType,
                    )
                  : ""),
              attachmentUrl: undefined as string | undefined,
              attachmentType: undefined as string | undefined,
              externalMessageId: msg.id,
              sourceMetadata:
                msg.id || isForwarded
                  ? buildMaxAttachmentMetadata({
                      externalMessageId: msg.id,
                      parentMessageId: msg.id ?? null,
                      isForwarded,
                      forwardFromUserId,
                    })
                  : undefined,
              messageTimestamp: new Date(msg.timestamp),
            },
          ];

    const effectiveText = persistedEntries[0]?.text ?? baseText;
    const pipeline = await this.getCrmPipeline();

    if (msg.direction === "outbound" || msg.fromMe === true) {
      for (const entry of persistedEntries) {
        if (!entry.text && !entry.attachmentUrl) continue;
        const outRes = await runWithTenantContext(event.tenantId, () =>
          pipeline.processNativeOutbound({
            tenantId: event.tenantId,
            channel: event.channel,
            channelAccountId: event.channelAccountId,
            chatId: event.chatId,
            peerUserId: peerUserId || null,
            senderPhone: peerPhone ?? null,
            username: msg.senderUsername ?? null,
            text: entry.text,
            senderName: "Менеджер",
            pauseMinutes: 60,
            attachment: entry.attachmentUrl ?? null,
            attachmentType: entry.attachmentType ?? null,
            externalMessageId: entry.externalMessageId,
            messageTimestamp: entry.messageTimestamp,
            sourceMetadata: entry.sourceMetadata,
          }),
        );
        if (outRes.messageId && entry.attachmentUrl) {
          void mediaEnrichmentService.enrichMessageMedia(event.tenantId, outRes.messageId).catch(() => {});
        }
      }
      return;
    }

    const rawFirstName =
      typeof rawPayload.senderFirstName === "string" ? rawPayload.senderFirstName.trim() : "";
    const rawLastName =
      typeof rawPayload.senderLastName === "string" ? rawPayload.senderLastName.trim() : "";

    const senderName =
      msg.senderName ||
      msg.senderUsername ||
      peerPhone ||
      event.chatId;

    const cleanSenderForSplit = /^(?:клиент\s+max|клиент|посетитель|unknown|неизвестно)$/i.test(senderName.trim())
      ? ""
      : senderName.trim();
    const nameParts = cleanSenderForSplit ? cleanSenderForSplit.split(/\s+/) : [];
    const profile: ChannelProfile = {
      firstName: rawFirstName || nameParts[0] || undefined,
      lastName: rawLastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined),
      phone: peerPhone,
      username: msg.senderUsername,
      isBot: false,
    };

    let crmResult: Awaited<ReturnType<typeof pipeline.processIncoming>> | null = null;
    for (const entry of persistedEntries) {
      if (!entry.text && !entry.attachmentUrl) continue;
      const entryResult = await runWithTenantContext(event.tenantId, () =>
        pipeline.processIncoming({
          tenantId: event.tenantId,
          channel: event.channel,
          channelAccountId: event.channelAccountId,
          chatId: event.chatId,
          peerUserId: peerUserId || undefined,
          chatThreadId: event.chatId,
          text: entry.text,
          senderName,
          senderPhone: peerPhone,
          senderUsername: msg.senderUsername,
          attachment: entry.attachmentUrl ?? null,
          attachmentType: entry.attachmentType ?? null,
          externalMessageId: entry.externalMessageId,
          messageTimestamp: entry.messageTimestamp,
          sourceMetadata: entry.sourceMetadata,
          profile,
        }),
      );
      if (entryResult.isPersonal || entryResult.isBot) {
        return;
      }
      if (!crmResult) {
        crmResult = entryResult;
      }
    }

    if (!crmResult) {
      return;
    }

    const dealIdToCheck = crmResult.dealId;
    const isAiPaused = await runWithTenantContext(event.tenantId, async () => {
      if (dealIdToCheck) {
        const row = await queryOne<{ id: string }>(
          `SELECT id FROM deals
           WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now()
           LIMIT 1`,
          [event.tenantId, dealIdToCheck],
        );
        if (row !== null) return true;
      }
      if (crmResult.contactId) {
        const contactDeal = await queryOne<{ id: string }>(
          `SELECT id FROM deals
           WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL AND ai_paused_until > now()
           LIMIT 1`,
          [event.tenantId, crmResult.contactId],
        );
        if (contactDeal !== null) return true;
      }
      return false;
    }).catch(() => false);

    if (!isAiPaused) {
      try {
        const agentService = new AgentPipelineService({
          info: () => {},
          warn: () => {},
          error: () => {},
        });
        const outcome = await runWithTenantContext(event.tenantId, () =>
          agentService.prepareReply({
            tenantId: event.tenantId,
            channelAccountId: event.channelAccountId,
            chatId: event.chatId,
            text: effectiveText,
            channelType: event.channel === "max" ? "MAX" : event.channel.toUpperCase(),
            dealId: dealIdToCheck || undefined,
          }),
        );

        if (outcome.kind === "replied") {
          if (crmResult.dealId !== null) {
            await runWithTenantContext(event.tenantId, () =>
              pipeline.saveAgentReply({
                tenantId: event.tenantId,
                dealId: crmResult.dealId,
                reply: outcome.reply,
                channel: event.channel,
                channelAccountId: event.channelAccountId,
              }),
            );
          }

          for (const replyText of outcome.reply.messages) {
            await this.sendMessage({
              tenantId: event.tenantId,
              channelAccountId: event.channelAccountId,
              recipient: event.chatId,
              text: replyText,
            });
          }
        }
      } catch {
        // Не роняем обработку события при ошибке AI-ассистента
      }
    }

    if (crmResult.dealId && crmResult.isNewDeal && event.channel === "max") {
      void import("../channels/max-integration.routes.js")
        .then(({ syncMaxDialogHistory }) =>
          syncMaxDialogHistory({
            tenantId: event.tenantId,
            dealId: crmResult.dealId,
            channelAccountId: event.channelAccountId,
            peerId: event.chatId,
            peerPhone: peerPhone ?? null,
            peerUserId: peerUserId || null,
            senderName,
          }),
        )
        .catch(() => {});
    }
  }

  /**
   * Создает OutboundSender для регистрации в реестре channels/outbound-registry.ts
   */
  createMaxOutboundSender(): OutboundSender {
    return async (message: OutboundMessage): Promise<OutboundSendResult> => {
      try {
        const adapter = await this.resolveAdapterForAccount(
          message.tenantId,
          message.channelAccountId,
          "max",
        );

        if (adapter) {
          let attachments: OutboundAttachment[] | undefined;
          let textToSend = message.text;

          if (message.attachment) {
            const media = await resolveOutboundMedia(
              message.attachment,
              message.tenantId,
              message.attachmentType,
            );
            if (media) {
              const attKind: OutboundAttachment["type"] = media.mimeType.startsWith("image/")
                ? "image"
                : media.mimeType.startsWith("video/")
                  ? "video"
                  : media.mimeType.startsWith("audio/")
                    ? "audio"
                    : "document";
              attachments = [
                {
                  type: attKind,
                  buffer: media.buffer,
                  base64: media.buffer.toString("base64"),
                  fileName: media.filename,
                  mimeType: media.mimeType,
                },
              ];
              textToSend = isMeaningfulCaption(message.text, media.filename) ? message.text : "";
            }
          }

          const res = await adapter.sendMessage({
            tenantId: message.tenantId,
            channelAccountId: message.channelAccountId,
            recipient: message.recipient,
            text: textToSend,
            attachments,
          });

          if (res.ok) {
            return { ok: true };
          }
          return {
            ok: false,
            reason: res.error || "Ошибка отправки MAX через IMessagingAdapter",
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: `Исключение при отправке MAX: ${msg}` };
      }

      // Fallback на системного бота платформы MAX, если аккаунт не найден
      const maxService = new MaxService();
      if (!maxService.isConfigured) {
        return { ok: false, reason: "MAX не настроен на платформе" };
      }
      const res = await maxService.sendMessage(message.recipient, message.text);
      if (res.ok) return { ok: true };
      return { ok: false, reason: res.reason ?? "Неизвестная ошибка платформы MAX" };
    };
  }

  /**
   * Очистка подписок при завершении процесса
   */
  destroy(): void {
    this.maxTsAdapter.destroyAll();
    for (const unsub of this.eventUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.eventUnsubscribers.length = 0;
  }
}

export const messagingRegistry = new MessagingRegistry();
