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
// MaxTsAdapter — Нативный TypeScript-клиент протокола MAX Messenger (Option C).
//
// Спроектирован на основе реверс-инжиниринга pr0bel1230/max-api-docs:
//   - Транспорт: WebSocket (wss://ws-api.oneme.ru/websocket, ver=11)
//   - Пакеты: { ver: 11, cmd: 0|1|3, seq, opcode, payload }
//   - Опкоды:
//       6   = INIT (deviceId, client ver)
//       19  = LOGIN (token из __oneme_auth)
//       49  = GET_HISTORY (chatId, limit)
//       53  = GET_CHATS (список диалогов)
//       64  = MSG_SEND (отправка сообщения)
//       128 = INCOMING_EVENT (входящее сообщение)
//
// Изоляция:
//   - Каждое подключение привязано к конкретному channelAccountId и tenant_id.
//   - Секреты (token) хранятся в БД в зашифрованном виде (AES-256-GCM v1).
// ---------------------------------------------------------------------------

const MAX_WS_ENDPOINT = "wss://ws-api.oneme.ru/websocket";
const PROTOCOL_VERSION = 11;

enum MaxOpcode {
  INIT = 6,
  LOGIN = 19,
  GET_HISTORY = 49,
  GET_CHATS = 53,
  MSG_SEND = 64,
  INCOMING_EVENT = 128,
}

interface MaxPacket<T = Record<string, unknown>> {
  ver: number;
  cmd: number; // 0 = req, 1 = ack, 3 = error
  seq: number;
  opcode: number;
  payload: T;
}

interface ActiveSession {
  ws: WebSocket;
  channelAccountId: string;
  tenantId: string;
  seq: number;
  pendingRequests: Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >;
  heartbeatTimer?: NodeJS.Timeout;
  connected: boolean;
  authorized: boolean;
}

export class MaxTsAdapter implements IMessagingAdapter {
  readonly channel = "max";
  readonly providerName = "max-native-ts";

  private readonly sessions = new Map<string, ActiveSession>();
  private readonly eventSubscribers = new Set<(event: IncomingEvent) => void>();

  private sessionKey(tenantId: string, channelAccountId: string): string {
    return `${tenantId}:${channelAccountId}`;
  }

  /**
   * Подключение к сессии аккаунта или получение существующего активного сокета.
   */
  private async getOrCreateSession(
    tenantId: string,
    channelAccountId: string,
  ): Promise<ActiveSession> {
    const key = this.sessionKey(tenantId, channelAccountId);
    const existing = this.sessions.get(key);
    if (existing && existing.tenantId === tenantId && existing.connected && existing.authorized) {
      return existing;
    }

    // Загрузка зашифрованных креденшелов из БД с изоляцией по tenant_id
    const account = await queryOne<{
      id: string;
      tenant_id: string;
      credentials: {
        token?: string;
        encrypted_token?: string;
        deviceId?: string;
      };
    }>(
      `SELECT id, tenant_id, credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
      [tenantId, channelAccountId],
    );

    if (!account) {
      throw new Error(`Channel account ${channelAccountId} not found for tenant ${tenantId}`);
    }

    let authToken = account.credentials?.token;
    if (account.credentials?.encrypted_token) {
      authToken = decryptSecret(account.credentials.encrypted_token);
    }

    if (!authToken) {
      throw new Error(`No auth token configured for MAX account ${channelAccountId}`);
    }

    const deviceId = account.credentials?.deviceId || `getvoxly-web-${channelAccountId.slice(0, 8)}`;

    return new Promise<ActiveSession>((resolve, reject) => {
      try {
        const ws = new WebSocket(MAX_WS_ENDPOINT);
        const session: ActiveSession = {
          ws,
          channelAccountId,
          tenantId,
          seq: 1,
          pendingRequests: new Map(),
          connected: false,
          authorized: false,
        };

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Timeout connecting to MAX WebSocket"));
        }, 15_000);

        ws.onopen = async () => {
          session.connected = true;

          try {
            // Шаг 1: INIT (opcode 6)
            await this.sendPacket(session, MaxOpcode.INIT, {
              deviceId,
              clientVer: "web-2.0.0",
              platform: "web",
            });

            // Шаг 2: LOGIN (opcode 19)
            await this.sendPacket(session, MaxOpcode.LOGIN, {
              token: authToken,
              deviceId,
            });

            session.authorized = true;
            clearTimeout(timeout);

            // Настройка Keep-Alive (heartbeat) каждые 30 секунд
            session.heartbeatTimer = setInterval(() => {
              if (session.connected && session.ws.readyState === WebSocket.OPEN) {
                this.sendPacket(session, MaxOpcode.INIT, { ping: true }).catch(() => {});
              }
            }, 30_000);
            session.heartbeatTimer.unref?.();

            this.sessions.set(key, session);
            resolve(session);
          } catch (err) {
            clearTimeout(timeout);
            ws.close();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };

        ws.onmessage = (event: MessageEvent) => {
          this.handleIncomingMessage(session, event.data);
        };

        ws.onerror = (_err: Event) => {
          clearTimeout(timeout);
          session.connected = false;
        };

        ws.onclose = () => {
          session.connected = false;
          session.authorized = false;
          if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
          this.sessions.delete(key);
        };
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Отправка запроса с seq-номером и ожидание соответствующего ACK.
   */
  private sendPacket<T = Record<string, unknown>>(
    session: ActiveSession,
    opcode: MaxOpcode,
    payload: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const seq = session.seq++;
      const packet: MaxPacket = {
        ver: PROTOCOL_VERSION,
        cmd: 0,
        seq,
        opcode,
        payload,
      };

      const timer = setTimeout(() => {
        session.pendingRequests.delete(seq);
        reject(new Error(`MAX request timed out (opcode: ${opcode}, seq: ${seq})`));
      }, 10_000);

      session.pendingRequests.set(seq, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(packet));
      } else {
        clearTimeout(timer);
        session.pendingRequests.delete(seq);
        reject(new Error("WebSocket is not open"));
      }
    });
  }

  /**
   * Обработка входящего пакета от сервера MAX.
   */
  private handleIncomingMessage(session: ActiveSession, rawData: unknown) {
    let packet: MaxPacket;
    try {
      const text = typeof rawData === "string" ? rawData : String(rawData);
      packet = JSON.parse(text);
    } catch {
      return;
    }

    // 1. Проверяем seq-матчинг для ожидающих промисов
    if (packet.seq && session.pendingRequests.has(packet.seq)) {
      const req = session.pendingRequests.get(packet.seq)!;
      clearTimeout(req.timer);
      session.pendingRequests.delete(packet.seq);

      if (packet.cmd === 3) {
        req.reject(
          new Error((packet.payload as { error?: string })?.error || "MAX command error"),
        );
      } else {
        req.resolve(packet.payload);
      }
      return;
    }

    // 2. Обрабатываем асинхронные события (opcode 128 = новое входящее сообщение)
    if (packet.opcode === MaxOpcode.INCOMING_EVENT) {
      const pl = packet.payload as Record<string, unknown>;
      const rawMsg = (pl.message as Record<string, unknown>) || pl;
      const chatId = String(rawMsg.chatId || pl.chatId || "");

      const normalized: NormalizedMessage = {
        id: String(rawMsg.id || rawMsg.messageId || Date.now()),
        chatId,
        senderId: String(rawMsg.senderId || rawMsg.from || ""),
        senderName: (rawMsg.senderName as string) || undefined,
        text: String(rawMsg.text || ""),
        direction: rawMsg.out || rawMsg.fromMe ? "outbound" : "inbound",
        fromMe: Boolean(rawMsg.out || rawMsg.fromMe),
        timestamp: Number(rawMsg.date || Date.now()),
        rawPayload: pl,
      };

      const event: IncomingEvent = {
        tenantId: session.tenantId,
        channelAccountId: session.channelAccountId,
        channel: "max",
        eventType: "message",
        chatId,
        message: normalized,
        timestamp: Date.now(),
      };

      for (const subscriber of this.eventSubscribers) {
        try {
          subscriber(event);
        } catch {}
      }
    }
  }

  // --- IMessagingAdapter Implementation ---

  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    try {
      const session = await this.getOrCreateSession(params.tenantId, params.channelAccountId);

      const payload: Record<string, unknown> = {
        chatId: params.recipient,
        text: params.text,
      };

      if (params.replyToMessageId) {
        payload.replyId = params.replyToMessageId;
      }

      if (params.attachments && params.attachments.length > 0 && params.attachments[0]) {
        const att = params.attachments[0];
        payload.media = {
          type: att.type,
          base64: att.base64,
          name: att.fileName,
        };
      }

      const res = await this.sendPacket<{ messageId?: string }>(
        session,
        MaxOpcode.MSG_SEND,
        payload,
      );

      return {
        ok: true,
        messageId: res.messageId || String(Date.now()),
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
      const session = await this.getOrCreateSession(params.tenantId, params.channelAccountId);

      const res = await this.sendPacket<{ messages?: Record<string, unknown>[] }>(
        session,
        MaxOpcode.GET_HISTORY,
        {
          chatId: params.chatId,
          count: params.limit || 50,
        },
      );

      const rawMessages = res.messages || [];
      const messages: NormalizedMessage[] = rawMessages.map((m) => ({
        id: String(m.id || m.messageId),
        chatId: params.chatId,
        senderId: String(m.senderId || m.from || ""),
        senderName: (m.senderName as string) || undefined,
        text: String(m.text || ""),
        direction: m.out ? "outbound" : "inbound",
        fromMe: Boolean(m.out),
        timestamp: Number(m.date || Date.now()),
        rawPayload: m,
      }));

      return {
        messages,
        hasMore: messages.length >= (params.limit || 50),
      };
    } catch {
      return {
        messages: [],
        hasMore: false,
      };
    }
  }

  async resolveContact(
    _tenantId: string,
    _channelAccountId: string,
    identifier: string,
  ): Promise<ResolvedContact | null> {
    // В протоколе MAX поиск контакта по номеру телефона выполняется через синхронизацию контактов
    return {
      id: identifier,
      phone: identifier.startsWith("+") ? identifier : undefined,
      isRegistered: true,
    };
  }

  subscribeToEvents(handler: (event: IncomingEvent) => void): Unsubscribe {
    this.eventSubscribers.add(handler);
    return () => {
      this.eventSubscribers.delete(handler);
    };
  }

  async healthCheck(tenantId: string, channelAccountId: string): Promise<AdapterHealthStatus> {
    try {
      const session = this.sessions.get(this.sessionKey(tenantId, channelAccountId));
      if (session && session.tenantId === tenantId && session.connected && session.authorized) {
        return {
          ok: true,
          status: "connected",
          lastSyncAt: new Date().toISOString(),
        };
      }

      // Пробуем инициализировать сессию
      const newSession = await this.getOrCreateSession(tenantId, channelAccountId);
      return {
        ok: newSession.authorized,
        status: newSession.authorized ? "connected" : "error",
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
