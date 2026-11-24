import { queryOne } from "../../../../db/client.js";
import { decryptSecret } from "../../../../services/credentials-cipher.js";
import { extractMaxIdentity, type MaxRawName } from "../../../channels/max-identity.js";
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
  PING = 1,
  INIT = 6,
  LOGIN = 19,
  CONTACT_INFO = 32,
  CONTACT_INFO_BY_PHONE = 46,
  GET_HISTORY = 49,
  MARK_READ = 50,
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
  private readonly contactCache = new Map<
    string,
    { firstName?: string; lastName?: string; senderName: string; phone?: string; expiresAt: number }
  >();

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

            // Настройка Keep-Alive (heartbeat) каждые 30 секунд через PING (opcode 1)
            session.heartbeatTimer = setInterval(() => {
              if (session.connected && session.ws.readyState === WebSocket.OPEN) {
                this.sendPacket(session, MaxOpcode.PING, { interactive: false }).catch(() => {});
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
      const senderId = String(rawMsg.sender ?? rawMsg.senderId ?? rawMsg.from ?? "");
      const isOutbound = Boolean(rawMsg.out || rawMsg.fromMe);

      void this.dispatchIncomingWithContact(session, chatId, senderId, isOutbound, rawMsg, pl);
    }
  }

  /**
   * Загружает профиль контакта через `CONTACT_INFO (op 32)` с кэшированием (10 мин),
   * извлекает `firstName`, `lastName` и `phone` и отправляет нормализованное событие подписчикам.
   */
  private async dispatchIncomingWithContact(
    session: ActiveSession,
    chatId: string,
    senderId: string,
    isOutbound: boolean,
    rawMsg: Record<string, unknown>,
    pl: Record<string, unknown>,
  ): Promise<void> {
    let profile: { firstName?: string; lastName?: string; senderName: string; phone?: string } | undefined;

    if (!isOutbound && senderId && /^\d+$/.test(senderId)) {
      const cacheKey = `${session.channelAccountId}:${senderId}`;
      const cached = this.contactCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        profile = cached;
      } else {
        try {
          const contactRes = await this.sendPacket<{
            contacts?: Array<{
              id?: number | string;
              names?: MaxRawName[];
              phone?: number | string;
              phones?: Array<{ number?: string }>;
            }>;
          }>(session, MaxOpcode.CONTACT_INFO, { contactIds: [Number(senderId)] });
          const c = contactRes.contacts?.[0];
          if (c) {
            const extracted = extractMaxIdentity({
              names: c.names,
              phone: c.phone ?? c.phones?.[0]?.number,
            });
            profile = extracted;
            this.contactCache.set(cacheKey, {
              ...extracted,
              expiresAt: Date.now() + 10 * 60_000,
            });
          }
        } catch {
          // Если CONTACT_INFO временно недоступен, используем данные из самого сообщения
        }
      }
    }

    const fallbackIdentity = extractMaxIdentity({
      senderName: (rawMsg.senderName as string) || undefined,
    });
    const finalIdentity = profile ?? fallbackIdentity;
    const rawTime = Number(rawMsg.time || rawMsg.date || Date.now());

    const normalized: NormalizedMessage = {
      id: String(rawMsg.id || rawMsg.messageId || Date.now()),
      chatId,
      senderId,
      senderName: finalIdentity.senderName,
      senderPhone: finalIdentity.phone,
      text: String(rawMsg.text || ""),
      direction: isOutbound ? "outbound" : "inbound",
      fromMe: isOutbound,
      timestamp: rawTime > 1e11 ? rawTime : rawTime * 1000,
      rawPayload: {
        ...pl,
        firstName: finalIdentity.firstName,
        lastName: finalIdentity.lastName,
        phone: finalIdentity.phone,
      },
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

  // --- IMessagingAdapter Implementation ---

  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    try {
      const session = await this.getOrCreateSession(params.tenantId, params.channelAccountId);

      const numericChatId = /^\d+$/.test(params.recipient) ? Number(params.recipient) : params.recipient;
      const messageBody: Record<string, unknown> = {
        text: params.text,
        cid: Date.now(),
        elements: [],
        attaches: [],
      };

      if (params.replyToMessageId && /^\d+$/.test(params.replyToMessageId)) {
        messageBody.link = {
          type: "REPLY",
          messageId: Number(params.replyToMessageId),
        };
      }

      const payload: Record<string, unknown> = {
        chatId: numericChatId,
        message: messageBody,
        notify: true,
      };

      const res = await this.sendPacket<{ message?: { id?: string | number }; messageId?: string }>(
        session,
        MaxOpcode.MSG_SEND,
        payload,
      );

      return {
        ok: true,
        messageId: String(res.message?.id ?? res.messageId ?? Date.now()),
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

      const numericChatId = /^\d+$/.test(params.chatId) ? Number(params.chatId) : params.chatId;
      const res = await this.sendPacket<{ messages?: Record<string, unknown>[] }>(
        session,
        MaxOpcode.GET_HISTORY,
        {
          chatId: numericChatId,
          from: Date.now(),
          forward: 0,
          backward: params.limit || 50,
          getMessages: true,
        },
      );

      const rawMessages = res.messages || [];
      const messages: NormalizedMessage[] = rawMessages.map((m) => {
        const rawTime = Number(m.time || m.date || Date.now());
        return {
          id: String(m.id || m.messageId),
          chatId: params.chatId,
          senderId: String(m.sender ?? m.senderId ?? m.from ?? ""),
          senderName: (m.senderName as string) || undefined,
          text: String(m.text || ""),
          direction: m.out ? "outbound" : "inbound",
          fromMe: Boolean(m.out),
          timestamp: rawTime > 1e11 ? rawTime : rawTime * 1000,
          rawPayload: m,
        };
      });

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
    tenantId: string,
    channelAccountId: string,
    identifier: string,
  ): Promise<ResolvedContact | null> {
    try {
      const session = await this.getOrCreateSession(tenantId, channelAccountId);
      const clean = identifier.trim();

      // Поиск по userId через CONTACT_INFO (opcode 32)
      if (/^\d+$/.test(clean) && clean.length < 11) {
        const res = await this.sendPacket<{
          contacts?: Array<{
            id?: number | string;
            names?: MaxRawName[];
            phone?: number | string;
            phones?: Array<{ number?: string }>;
          }>;
        }>(session, MaxOpcode.CONTACT_INFO, { contactIds: [Number(clean)] });
        const contact = res.contacts?.[0];
        if (!contact) return null;
        const identity = extractMaxIdentity({
          names: contact.names,
          phone: contact.phone ?? contact.phones?.[0]?.number,
        });
        return {
          id: String(contact.id ?? clean),
          name: identity.senderName,
          phone: identity.phone,
          isRegistered: true,
        };
      }

      // Поиск по номеру телефона через CONTACT_INFO_BY_PHONE (opcode 46)
      const digits = clean.replace(/\D/g, "");
      if (digits.length >= 10) {
        const phoneE164 = digits.length === 11 && digits.startsWith("8") ? `+7${digits.slice(1)}` : `+${digits}`;
        const res = await this.sendPacket<{
          contact?: {
            id?: number | string;
            names?: MaxRawName[];
            phone?: number | string;
          };
        }>(session, MaxOpcode.CONTACT_INFO_BY_PHONE, { phone: phoneE164 });
        if (!res.contact?.id) return null;
        const identity = extractMaxIdentity({
          names: res.contact.names,
          phone: res.contact.phone ?? phoneE164,
        });
        return {
          id: String(res.contact.id),
          name: identity.senderName,
          phone: identity.phone ?? phoneE164,
          isRegistered: true,
        };
      }

      return null;
    } catch {
      return {
        id: identifier,
        phone: identifier.startsWith("+") ? identifier : undefined,
        isRegistered: true,
      };
    }
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
