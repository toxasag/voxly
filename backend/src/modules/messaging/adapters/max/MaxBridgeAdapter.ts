import { MaxBridgeService } from "../../../channels/max-bridge.service.js";
import { queryOne, withTenant } from "../../../../db/client.js";
import type {
  IMessagingAdapter,
  SendMessageParams,
  SentMessageResult,
  MessageHistoryParams,
  MessagePage,
  ResolvedContact,
  IncomingEvent,
  Unsubscribe,
  AdapterHealthStatus,
  NormalizedMessage,
} from "../IMessagingAdapter.js";

// ---------------------------------------------------------------------------
// MaxBridgeAdapter — Адаптер для существующего сервиса max-bridge (PyMax).
//
// Реализует IMessagingAdapter поверх контейнера voxly-max-bridge:latest.
// Гарантирует обратную совместимость для всех существующих подключений MAX,
// пока арендаторы не переведены на MaxTsAdapter или MaxGreenApiAdapter.
// ---------------------------------------------------------------------------

export class MaxBridgeAdapter implements IMessagingAdapter {
  readonly channel = "max";
  readonly providerName = "max-bridge";

  private readonly bridgeService: MaxBridgeService;
  private readonly eventSubscribers = new Set<(event: IncomingEvent) => void>();

  constructor(bridgeService?: MaxBridgeService) {
    this.bridgeService = bridgeService ?? new MaxBridgeService();
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    try {
      let mediaBase64: string | undefined;
      let fileName: string | undefined;
      let mimeType: string | undefined;

      if (params.attachments && params.attachments.length > 0 && params.attachments[0]) {
        const att = params.attachments[0];
        if (att.base64) {
          mediaBase64 = att.base64;
        } else if (att.buffer) {
          mediaBase64 = att.buffer.toString("base64");
        }
        fileName = att.fileName;
        mimeType = att.mimeType;
      }

      // Получаем label подключенного аккаунта для max-bridge
      const account = await queryOne<{ label: string }>(
        `SELECT label FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [params.tenantId, params.channelAccountId],
      );

      const res = await this.bridgeService.sendMessage({
        tenantId: params.tenantId,
        name: account?.label,
        botId: params.channelAccountId,
        recipient: params.recipient,
        text: params.text,
        mediaBase64,
        fileName,
        mimeType,
      });

      if (!res.ok) {
        if (res.sessionExpired) {
          const accountTitle = account?.label ? ` «${account.label}»` : "";
          await withTenant(params.tenantId, (tx) =>
            tx.query(
              `UPDATE channel_accounts
               SET status = 'error',
                   status_message = 'Сессия истекла — требуется повторная авторизация по QR-коду'
               WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
              [params.tenantId, params.channelAccountId],
            ),
          ).catch(() => {});

          return {
            ok: false,
            error: `Сессия MAX-аккаунта${accountTitle} истекла — переподключите его по QR-коду в разделе «Интеграции → MAX» или выберите другой аккаунт в «Пишем от:».`,
          };
        }

        return {
          ok: false,
          error: res.error || "Ошибка отправки через max-bridge",
        };
      }

      await withTenant(params.tenantId, (tx) =>
        tx.query(
          `UPDATE channel_accounts
           SET status = 'connected',
               status_message = '',
               last_sync_at = now()
           WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND status = 'error' AND deleted_at IS NULL`,
          [params.tenantId, params.channelAccountId],
        ),
      ).catch(() => {});

      return {
        ok: true,
        messageId: res.messageId || String(Date.now()),
        timestamp: Date.now(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: msg,
      };
    }
  }

  async getHistory(params: MessageHistoryParams): Promise<MessagePage> {
    try {
      const res = await this.bridgeService.getPrivateDialogs({
        botId: params.channelAccountId,
        dialogLimit: 50,
        messageLimit: params.limit || 50,
      });

      if (!res.ok || !res.dialogs) {
        return { messages: [], hasMore: false };
      }

      // Ищем диалог по chatId
      const dialog = res.dialogs.find(
        (d) => d.chatId === params.chatId || d.userId === params.chatId,
      );

      if (!dialog) {
        return { messages: [], hasMore: false };
      }

      const messages: NormalizedMessage[] = dialog.messages.map((m) => ({
        id: String(m.id),
        chatId: params.chatId,
        senderId: m.out ? params.channelAccountId : (dialog.userId || params.chatId),
        senderName: m.out ? undefined : (dialog.firstName || dialog.username || undefined),
        senderPhone: dialog.phone || undefined,
        senderUsername: dialog.username || undefined,
        text: m.text,
        direction: m.out ? "outbound" : "inbound",
        fromMe: m.out,
        timestamp: m.date > 1e11 ? m.date : m.date * 1000,
        attachments: m.attachments?.map((a) => ({
          type: a.type,
          fileId: a.fileId,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
        })),
      }));

      return {
        messages,
        hasMore: false,
      };
    } catch {
      return { messages: [], hasMore: false };
    }
  }

  async resolveContact(
    _tenantId: string,
    _channelAccountId: string,
    identifier: string,
  ): Promise<ResolvedContact | null> {
    return {
      id: identifier,
      phone: identifier.startsWith("+") ? identifier : `+${identifier.replace(/\D/g, "")}`,
      isRegistered: true,
    };
  }

  subscribeToEvents(handler: (event: IncomingEvent) => void): Unsubscribe {
    this.eventSubscribers.add(handler);
    return () => {
      this.eventSubscribers.delete(handler);
    };
  }

  /**
   * Прием входящих событий от max-bridge вебхука или intake-пайплайна
   */
  dispatchIncomingEvent(event: IncomingEvent) {
    for (const sub of this.eventSubscribers) {
      try {
        sub(event);
      } catch {}
    }
  }

  async healthCheck(tenantId: string, channelAccountId: string): Promise<AdapterHealthStatus> {
    try {
      const account = await queryOne<{ label: string; status: string }>(
        `SELECT label, status FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [tenantId, channelAccountId],
      );

      if (!account) {
        return { ok: false, status: "error", error: "Account not found" };
      }

      const statusRes = await this.bridgeService.checkStatus(tenantId, account.label);
      const isConnected = statusRes.status === "authorized";

      return {
        ok: isConnected,
        status: isConnected ? "connected" : "disconnected",
        lastSyncAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
