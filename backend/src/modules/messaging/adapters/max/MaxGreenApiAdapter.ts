import { queryOne } from "../../../../db/client.js";
import { decryptSecret } from "../../../../services/credentials-cipher.js";
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
// MaxGreenApiAdapter — Адаптер облачного шлюза GREEN-API для MAX (Option E).
//
// Идеален для Enterprise-клиентов и режима без необходимости держать
// постоянные WebSocket-соединения в self-hosted процессе:
//   - REST API шлюза (https://api.green-api.com)
//   - Webhook-приём входящих сообщений
//   - Автоматическая ротация IP-адресов и защита от банов на стороне провайдера
//   - Полная изоляция по tenant_id и шифрование idInstance / apiTokenInstance
// ---------------------------------------------------------------------------

interface GreenApiCredentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl?: string;
  encrypted_api_token?: string;
}

export class MaxGreenApiAdapter implements IMessagingAdapter {
  readonly channel = "max";
  readonly providerName = "max-green-api";

  private readonly eventSubscribers = new Set<(event: IncomingEvent) => void>();

  private async getCredentials(
    tenantId: string,
    channelAccountId: string,
  ): Promise<{ idInstance: string; apiTokenInstance: string; apiUrl: string }> {
    const account = await queryOne<{
      id: string;
      tenant_id: string;
      credentials: GreenApiCredentials;
    }>(
      `SELECT id, tenant_id, credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
      [tenantId, channelAccountId],
    );

    if (!account) {
      throw new Error(`Channel account ${channelAccountId} not found for tenant ${tenantId}`);
    }

    const creds = account.credentials;
    if (!creds?.idInstance) {
      throw new Error(`GREEN-API idInstance missing for account ${channelAccountId}`);
    }

    let token = creds.apiTokenInstance;
    if (creds.encrypted_api_token) {
      token = decryptSecret(creds.encrypted_api_token);
    }

    if (!token) {
      throw new Error(`GREEN-API apiTokenInstance missing for account ${channelAccountId}`);
    }

    const apiUrl = (creds.apiUrl || "https://api.green-api.com").replace(/\/+$/, "");
    return {
      idInstance: creds.idInstance,
      apiTokenInstance: token,
      apiUrl,
    };
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    try {
      const { idInstance, apiTokenInstance, apiUrl } = await this.getCredentials(
        params.tenantId,
        params.channelAccountId,
      );

      // Форматируем chatId в стандарт GREEN-API
      let targetChatId = params.recipient.trim();
      if (!targetChatId.includes("@")) {
        const cleanDigits = targetChatId.replace(/\D/g, "");
        targetChatId = `${cleanDigits}@c.us`;
      }

      const url = `${apiUrl}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

      const body: Record<string, unknown> = {
        chatId: targetChatId,
        message: params.text,
      };

      if (params.replyToMessageId) {
        body.quotedMessageId = params.replyToMessageId;
      }

      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as { idMessage?: string; message?: string };

      if (!res.ok) {
        return {
          ok: false,
          error: json.message || `GREEN-API HTTP error: ${res.status}`,
        };
      }

      return {
        ok: true,
        messageId: json.idMessage || String(Date.now()),
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getHistory(params: MessageHistoryParams): Promise<MessagePage> {
    try {
      const { idInstance, apiTokenInstance, apiUrl } = await this.getCredentials(
        params.tenantId,
        params.channelAccountId,
      );

      let targetChatId = params.chatId.trim();
      if (!targetChatId.includes("@")) {
        targetChatId = `${targetChatId.replace(/\D/g, "")}@c.us`;
      }

      const url = `${apiUrl}/waInstance${idInstance}/getChatHistory/${apiTokenInstance}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: targetChatId,
          count: params.limit || 50,
        }),
      });

      if (!res.ok) {
        return { messages: [], hasMore: false };
      }

      const rawList = (await res.json()) as Array<{
        idMessage: string;
        type: string;
        timestamp: number;
        textMessage?: string;
        senderId?: string;
        senderName?: string;
      }>;

      const messages: NormalizedMessage[] = rawList.map((m) => ({
        id: m.idMessage,
        chatId: params.chatId,
        senderId: m.senderId || "",
        senderName: m.senderName,
        text: m.textMessage || "",
        direction: m.type === "outgoing" ? "outbound" : "inbound",
        fromMe: m.type === "outgoing",
        timestamp: m.timestamp * 1000,
      }));

      return {
        messages,
        hasMore: messages.length >= (params.limit || 50),
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
   * Точка входа для вебхука от GREEN-API
   */
  dispatchWebhookEvent(event: IncomingEvent) {
    for (const sub of this.eventSubscribers) {
      try {
        sub(event);
      } catch {}
    }
  }

  async healthCheck(tenantId: string, channelAccountId: string): Promise<AdapterHealthStatus> {
    try {
      const { idInstance, apiTokenInstance, apiUrl } = await this.getCredentials(
        tenantId,
        channelAccountId,
      );

      const url = `${apiUrl}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const json = (await res.json().catch(() => ({}))) as { stateInstance?: string };

      const isAuthorized = json.stateInstance === "authorized";

      return {
        ok: isAuthorized,
        status: isAuthorized ? "connected" : "unauthorized",
        lastSyncAt: new Date().toISOString(),
        details: json,
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
