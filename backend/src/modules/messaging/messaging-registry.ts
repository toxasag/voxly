import { queryOne } from "../../db/client.js";
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
import type { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import type { OutboundSender, OutboundMessage, OutboundSendResult } from "../channels/outbound-registry.js";
import { resolveOutboundMedia, isMeaningfulCaption } from "../channels/media-resolver.js";
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
    this.registerAdapter(new MaxTsAdapter());
    this.registerAdapter(new MaxGreenApiAdapter());
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

    // Сохраняем в CRM только входящие сообщения от клиентов
    if (event.message.direction === "inbound" && event.message.fromMe !== true) {
      const pipeline = await this.getCrmPipeline();
      await pipeline.processIncoming({
        tenantId: event.tenantId,
        channel: event.channel,
        channelAccountId: event.channelAccountId,
        chatId: event.chatId,
        text: event.message.text,
        senderName:
          event.message.senderName ||
          event.message.senderUsername ||
          event.message.senderPhone ||
          event.chatId,
        senderPhone: event.message.senderPhone,
        senderUsername: event.message.senderUsername,
      });
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
              attachments = [
                {
                  type: "document",
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
    for (const unsub of this.eventUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.eventUnsubscribers.length = 0;
  }
}

export const messagingRegistry = new MessagingRegistry();
