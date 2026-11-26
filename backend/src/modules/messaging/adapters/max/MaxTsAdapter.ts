import { query, runWithPlatformScope, withTenant } from "../../../../db/client.js";
import { decryptSecret, encryptSecret } from "../../../../services/credentials-cipher.js";
import { extractMaxIdentity, normalizeMaxPhone, type MaxRawName } from "../../../channels/max-identity.js";
import type { MaxBridgeDialog, MaxBridgeDialogMessage, MaxPrivateDialogsResponse } from "../../../channels/max-bridge.service.js";
import {
  buildMaxUserAgent,
  isFatalMaxAuthError,
  MAX_WS_ENDPOINT,
  MaxCommand,
  MaxOpcode,
  normalizeUuidDeviceId,
  openMaxWebSocket,
  packMaxFrame,
  toMaxIdValue,
  unpackMaxFrame,
} from "./max-protocol.js";
import type {
  AdapterHealthStatus,
  IMessagingAdapter,
  InboundAttachment,
  IncomingEvent,
  MessageHistoryParams,
  MessagePage,
  NormalizedMessage,
  OutboundAttachment,
  ResolvedContact,
  SendMessageParams,
  SentMessageResult,
  Unsubscribe,
} from "../IMessagingAdapter.js";

// ---------------------------------------------------------------------------
// MaxTsAdapter — нативный TypeScript-клиент протокола web.max.ru (ver = 10).
//
// Работает напрямую с wss://api.oneme.ru/websocket:
//   - Binary framing ver=10 (10-байтовый BE header + MessagePack + ext 1 + LZ4)
//   - SessionInit (opcode 6) с userAgent web.max.ru 26.11.10, UUID v4 deviceId
//     и clientSessionId = BigInt(Date.now())
//   - Обязательные ACK (cmd=1) на server-initiated cmd=0:
//       1 (ping), 128 ({ chatId, messageId }), 137 (call), и прочие push
//   - Дедупликация входящих по lastInSeq, read-timeout 35s, jittered backoff
//     реконнект и переотправка очереди с cmd=2 после повторного LOGIN
//   - Обновление токена из opcode 19 (LOGIN) и opcode 23 (AUTH_CONFIRM)
//   - Сброс сессии строго при ['login.token','login.blocked','login.flood','user.not.found']
// ---------------------------------------------------------------------------

const READ_TIMEOUT_MS = 35_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PING_IDLE_THRESHOLD_MS = 20_000;
const RPC_TIMEOUT_MS = 20_000;
const UPLOAD_WAIT_TIMEOUT_MS = 60_000;

export interface MaxSessionRecord {
  id: number | string;
  deviceId?: string;
  current?: boolean;
  client?: string;
  info?: string;
  time?: number;
  userAgent?: string;
  appVersion?: string;
  deviceName?: string;
  deviceType?: string;
  platform?: string;
  ip?: string;
  location?: string;
  created?: number;
  updated?: number;
  lastActivity?: number;
}

interface StoredMaxSession {
  token: string;
  deviceId: string;
  phone?: string;
  chatsSync?: number;
  contactsSync?: number;
  draftsSync?: number;
  presenceSync?: number;
  configHash?: string;
  userAgent?: Record<string, unknown> | null;
}

interface RawMaxAttach {
  _type?: string;
  type?: string;
  photoToken?: string;
  photoId?: number | string | bigint;
  baseUrl?: string;
  fileId?: number | string | bigint;
  videoId?: number | string | bigint;
  audioId?: number | string | bigint;
  name?: string;
  fileName?: string;
  size?: number;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  phone?: string | number;
  firstName?: string;
  lastName?: string;
  vcfBody?: string;
  contactId?: number | string | bigint;
}

interface RawMaxMessage {
  id?: number | string | bigint;
  sender?: number | string | bigint;
  senderId?: number | string | bigint;
  from?: number | string | bigint;
  chatId?: number | string | bigint;
  time?: number | bigint;
  date?: number | bigint;
  text?: string;
  out?: boolean;
  attaches?: RawMaxAttach[];
  link?: {
    type?: string;
    message?: RawMaxMessage;
    chatId?: number | string | bigint;
    sender?: number | string | bigint;
  };
}

interface RawMaxChat {
  id: number | string | bigint;
  type?: string;
  lastEventTime?: number;
  modified?: number;
  owner?: number | string | bigint;
  participants?: Record<string, unknown>;
}

interface RawMaxContact {
  id?: number | string | bigint;
  names?: MaxRawName[];
  phone?: string | number;
  phones?: Array<{ number?: string }>;
  accountStatus?: number;
  link?: string;
  username?: string;
  options?: Array<string | { value?: string }>;
  isBot?: boolean;
}

interface PendingRpc {
  opcode: number;
  payload: unknown;
  retryable: boolean;
  resolve: (val: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface QueuedRetryItem {
  opcode: number;
  payload: unknown;
  resolve: (val: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

interface ActiveSession {
  ws: WebSocket;
  channelAccountId: string;
  tenantId: string;
  token: string;
  deviceId: string;
  userAgent: Record<string, unknown> | null;
  chatsSync: number;
  contactsSync: number;
  draftsSync: number;
  presenceSync: number;
  configHash?: string;
  seq: number;
  lastInSeq: number;
  lastRecvAt: number;
  selfUserId: string | null;
  selfPhone: string | null;
  chats: Map<string, RawMaxChat>;
  contacts: Map<string, RawMaxContact>;
  pendingRequests: Map<number, PendingRpc>;
  retryQueue: QueuedRetryItem[];
  attachWaiters: Map<string, { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  photoUrlCache: Map<string, string>;
  heartbeatTimer?: NodeJS.Timeout;
  reconnectTimer?: NodeJS.Timeout;
  reconnectAttempts: number;
  connected: boolean;
  authorized: boolean;
  manuallyClosed: boolean;
  fatalError: boolean;
}

export class MaxProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly opcode: number,
  ) {
    super(message);
    this.name = "MaxProtocolError";
  }
}

function asStrId(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDialogChatId(meId: string, peerUserId: string): bigint {
  return BigInt(meId) ^ BigInt(peerUserId);
}

export class MaxTsAdapter implements IMessagingAdapter {
  readonly channel = "max";
  readonly providerName = "max-native-ts";

  private readonly sessions = new Map<string, ActiveSession>();
  private readonly connectingPromises = new Map<string, Promise<ActiveSession>>();
  private readonly eventSubscribers = new Set<(event: IncomingEvent) => void>();
  private readonly contactCache = new Map<
    string,
    {
      firstName?: string;
      lastName?: string;
      senderName: string;
      phone?: string;
      username?: string;
      link?: string;
      isBot?: boolean;
      expiresAt: number;
    }
  >();
  private readonly dedupInbound = new Map<string, number>();

  private sessionKey(tenantId: string, channelAccountId: string): string {
    return `${tenantId}:${channelAccountId}`;
  }

  private findSessionByAccountId(channelAccountId: string): ActiveSession | undefined {
    for (const sess of this.sessions.values()) {
      if (sess.channelAccountId === channelAccountId) return sess;
    }
    return undefined;
  }

  isSessionLive(channelAccountId: string): boolean {
    const sess = this.findSessionByAccountId(channelAccountId);
    return Boolean(sess && sess.connected && sess.authorized && !sess.fatalError);
  }

  getLiveBotIds(): Set<string> {
    const out = new Set<string>();
    for (const sess of this.sessions.values()) {
      if (sess.connected && sess.authorized && !sess.fatalError) {
        out.add(sess.channelAccountId);
      }
    }
    return out;
  }

  private loadStoredCredentials(
    accountId: string,
    creds: Record<string, unknown> | null | undefined,
  ): StoredMaxSession {
    const c = creds ?? {};
    let token = typeof c.token === "string" ? c.token : "";
    let deviceId = typeof c.deviceId === "string" ? c.deviceId : "";
    let phone = typeof c.phone === "string" ? c.phone : undefined;
    let chatsSync = -1;
    let contactsSync = -1;
    let draftsSync = -1;
    let presenceSync = -1;
    let configHash: string | undefined;
    let userAgent: Record<string, unknown> | null = null;

    if (typeof c.encrypted_session === "string" && c.encrypted_session.trim()) {
      try {
        const parsed = JSON.parse(decryptSecret(c.encrypted_session)) as Record<string, unknown>;
        if (typeof parsed.token === "string" && parsed.token) token = parsed.token;
        if (typeof parsed.deviceId === "string" && parsed.deviceId) deviceId = parsed.deviceId;
        if (typeof parsed.phone === "string" && parsed.phone) phone = parsed.phone;
        if (typeof parsed.chatsSync === "number") chatsSync = parsed.chatsSync;
        if (typeof parsed.contactsSync === "number") contactsSync = parsed.contactsSync;
        if (typeof parsed.draftsSync === "number") draftsSync = parsed.draftsSync;
        if (typeof parsed.presenceSync === "number") presenceSync = parsed.presenceSync;
        if (typeof parsed.configHash === "string") configHash = parsed.configHash;
        if (parsed.userAgent && typeof parsed.userAgent === "object") {
          userAgent = parsed.userAgent as Record<string, unknown>;
        }
      } catch {
        // Fallback to encrypted_token below
      }
    }

    if (!token && typeof c.encrypted_token === "string" && c.encrypted_token.trim()) {
      token = decryptSecret(c.encrypted_token);
    }

    if (!token) {
      throw new Error(`No auth token configured for MAX account ${accountId}`);
    }

    return {
      token,
      deviceId: deviceId.trim() || normalizeUuidDeviceId(null),
      phone,
      chatsSync,
      contactsSync,
      draftsSync,
      presenceSync,
      configHash,
      userAgent,
    };
  }

  private async persistSessionUpdate(
    session: ActiveSession,
    updates: {
      token?: string;
      status?: "connected" | "error";
      statusMessage?: string;
      clearSession?: boolean;
      maxUserId?: string | null;
    },
  ): Promise<void> {
    if (updates.token) {
      session.token = updates.token;
    }

    const backupPayload = {
      token: session.token,
      deviceId: session.deviceId,
      phone: session.selfPhone ?? "",
      chatsSync: session.chatsSync,
      contactsSync: session.contactsSync,
      draftsSync: session.draftsSync,
      presenceSync: session.presenceSync,
      configHash: session.configHash ?? "",
      userAgent: session.userAgent ?? buildMaxUserAgent(null),
    };

    const encryptedSession = updates.clearSession ? null : encryptSecret(JSON.stringify(backupPayload));
    const encryptedToken = updates.clearSession ? null : encryptSecret(session.token);

    await withTenant(session.tenantId, async (tx) => {
      await tx.query(
        `UPDATE channel_accounts
         SET status = COALESCE($3, status),
             status_message = COALESCE($4, status_message),
             remote_user_id = COALESCE($5, remote_user_id),
             connected_at = CASE WHEN $3 = 'connected' AND connected_at IS NULL THEN now() ELSE connected_at END,
             last_sync_at = CASE WHEN $3 = 'connected' THEN now() ELSE last_sync_at END,
             credentials = CASE
               WHEN $6::boolean THEN COALESCE(credentials, '{}'::jsonb) - 'encrypted_session' - 'encrypted_token' - 'token' - 'session_backed_up_at'
               ELSE COALESCE(credentials, '{}'::jsonb) || jsonb_build_object(
                 'deviceId', $7::text,
                 'encrypted_session', $8::text,
                 'encrypted_token', $9::text,
                 'session_backed_up_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               ) || CASE WHEN $10::text <> '' THEN jsonb_build_object('phone', $10::text) ELSE '{}'::jsonb END
             END,
             credentials_encrypted = CASE WHEN $6::boolean THEN false ELSE true END
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [
          session.tenantId,
          session.channelAccountId,
          updates.status ?? null,
          updates.statusMessage ?? null,
          updates.maxUserId ?? null,
          Boolean(updates.clearSession),
          session.deviceId,
          encryptedSession,
          encryptedToken,
          session.selfPhone ?? "",
        ],
      );
    }).catch(() => {});
  }

  private async getOrCreateSession(
    tenantId: string,
    channelAccountId: string,
  ): Promise<ActiveSession> {
    const key = this.sessionKey(tenantId, channelAccountId);
    const existing = this.sessions.get(key);
    if (existing && existing.connected && existing.authorized && !existing.fatalError) {
      return existing;
    }

    const inflight = this.connectingPromises.get(key);
    if (inflight) {
      return inflight;
    }

    const connectPromise = this.openAndLoginSession(tenantId, channelAccountId).finally(() => {
      this.connectingPromises.delete(key);
    });
    this.connectingPromises.set(key, connectPromise);
    return connectPromise;
  }

  private async openAndLoginSession(
    tenantId: string,
    channelAccountId: string,
    reuseSession?: ActiveSession,
  ): Promise<ActiveSession> {
    const account = await withTenant(tenantId, (tx) =>
      tx.queryOne<{
        id: string;
        tenant_id: string;
        remote_user_id: string | null;
        credentials: Record<string, unknown> | null;
      }>(
        `SELECT id, tenant_id, remote_user_id, credentials FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [tenantId, channelAccountId],
      ),
    );

    if (!account) {
      throw new Error(`Channel account ${channelAccountId} not found for tenant ${tenantId}`);
    }

    const stored = this.loadStoredCredentials(channelAccountId, account.credentials);
    const key = this.sessionKey(tenantId, channelAccountId);

    const ws = openMaxWebSocket(MAX_WS_ENDPOINT);
    const session: ActiveSession = reuseSession ?? {
      ws,
      channelAccountId,
      tenantId,
      token: stored.token,
      deviceId: stored.deviceId,
      userAgent: stored.userAgent ?? null,
      chatsSync: stored.chatsSync ?? -1,
      contactsSync: stored.contactsSync ?? -1,
      draftsSync: stored.draftsSync ?? -1,
      presenceSync: stored.presenceSync ?? -1,
      configHash: stored.configHash,
      seq: 0,
      lastInSeq: 0,
      lastRecvAt: Date.now(),
      selfUserId: account.remote_user_id ?? null,
      selfPhone: stored.phone ?? null,
      chats: new Map(),
      contacts: new Map(),
      pendingRequests: new Map(),
      retryQueue: [],
      attachWaiters: new Map(),
      photoUrlCache: new Map(),
      reconnectAttempts: 0,
      connected: false,
      authorized: false,
      manuallyClosed: false,
      fatalError: false,
    };

    session.ws = ws;
    session.seq = 0;
    session.lastInSeq = 0;
    session.lastRecvAt = Date.now();
    session.connected = false;
    session.authorized = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error("Timeout connecting to MAX WebSocket"));
      }, 15_000);

      ws.addEventListener("open", async () => {
        session.connected = true;
        session.lastRecvAt = Date.now();
        try {
          // 1. SessionInit (opcode 6)
          await this.sendRpc(session, MaxOpcode.SESSION_INIT, {
            userAgent: buildMaxUserAgent(session.userAgent),
            deviceId: session.deviceId,
            clientSessionId: BigInt(Date.now()),
          });

          // 2. LOGIN (opcode 19)
          const loginResp = await this.sendRpc(session, MaxOpcode.LOGIN, {
            token: session.token,
            chatsCount: 40,
            interactive: true,
            chatsSync: session.chatsSync,
            contactsSync: session.contactsSync,
            presenceSync: session.presenceSync,
            draftsSync: session.draftsSync,
          });

          this.applyLoginState(session, loginResp);
          session.authorized = true;
          session.reconnectAttempts = 0;
          clearTimeout(timeout);

          this.startHeartbeat(session);
          this.sessions.set(key, session);
          await this.persistSessionUpdate(session, {
            token: typeof loginResp.token === "string" && loginResp.token ? loginResp.token : undefined,
            status: "connected",
            statusMessage: "",
            maxUserId: session.selfUserId,
          });

          // Переотправка очереди ожидающих запросов с cmd = 2 (RETRY) после логина
          void this.flushRetryQueue(session);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          const errCode = err instanceof MaxProtocolError ? err.code : "";
          if (isFatalMaxAuthError(errCode || (err instanceof Error ? err.message : ""))) {
            session.fatalError = true;
            await this.persistSessionUpdate(session, {
              status: "error",
              statusMessage: `Сессия MAX истекла (${errCode || "auth"}) — требуется повторная авторизация`,
              clearSession: true,
            });
          }
          try {
            ws.close();
          } catch {}
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.addEventListener("message", (event) => {
        this.handleRawFrame(session, event.data);
      });

      ws.addEventListener("error", () => {
        session.connected = false;
      });

      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        session.connected = false;
        session.authorized = false;
        if (session.heartbeatTimer) {
          clearInterval(session.heartbeatTimer);
          session.heartbeatTimer = undefined;
        }
        this.movePendingToRetryQueueOrReject(session);

        if (!session.manuallyClosed && !session.fatalError && this.sessions.get(key) === session) {
          this.scheduleReconnect(session);
        }
      });
    });

    return session;
  }

  private applyLoginState(session: ActiveSession, resp: Record<string, unknown>): void {
    const profile = resp.profile as { contact?: RawMaxContact } | RawMaxContact | undefined;
    const meContact =
      profile && typeof profile === "object" && "contact" in profile && profile.contact
        ? profile.contact
        : (profile as RawMaxContact | undefined);

    if (meContact?.id !== undefined) {
      session.selfUserId = asStrId(meContact.id);
    }
    if (meContact?.phone !== undefined) {
      session.selfPhone = normalizeMaxPhone(String(meContact.phone), null) ?? session.selfPhone;
    }

    if (typeof resp.chatsSync === "number") session.chatsSync = resp.chatsSync;
    if (typeof resp.contactsSync === "number") session.contactsSync = resp.contactsSync;
    if (typeof resp.draftsSync === "number") session.draftsSync = resp.draftsSync;
    if (typeof resp.presenceSync === "number") session.presenceSync = resp.presenceSync;
    if (typeof resp.configHash === "string") session.configHash = resp.configHash;

    const chats = Array.isArray(resp.chats) ? (resp.chats as RawMaxChat[]) : [];
    for (const chat of chats) {
      if (chat?.id !== undefined) {
        session.chats.set(asStrId(chat.id), chat);
      }
    }

    const contacts = Array.isArray(resp.contacts) ? (resp.contacts as RawMaxContact[]) : [];
    for (const c of contacts) {
      if (c?.id !== undefined) {
        session.contacts.set(asStrId(c.id), c);
      }
    }
  }

  private startHeartbeat(session: ActiveSession): void {
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = setInterval(() => {
      if (!session.connected || session.ws.readyState !== WebSocket.OPEN) return;

      const idleMs = Date.now() - session.lastRecvAt;
      if (idleMs > READ_TIMEOUT_MS) {
        try {
          session.ws.close();
        } catch {}
        return;
      }

      if (idleMs >= PING_IDLE_THRESHOLD_MS) {
        this.sendRpc(session, MaxOpcode.PING, { interactive: false }).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);
    session.heartbeatTimer.unref?.();
  }

  private scheduleReconnect(session: ActiveSession): void {
    if (session.reconnectTimer || session.manuallyClosed || session.fatalError) return;
    const base = Math.min(60_000, 1_500 * Math.pow(2, session.reconnectAttempts));
    const jittered = Math.round(base * (0.8 + Math.random() * 0.4));
    session.reconnectAttempts++;

    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = undefined;
      if (session.manuallyClosed || session.fatalError) return;
      this.openAndLoginSession(session.tenantId, session.channelAccountId, session).catch(() => {
        if (!session.manuallyClosed && !session.fatalError) {
          this.scheduleReconnect(session);
        }
      });
    }, jittered);
    session.reconnectTimer.unref?.();
  }

  private movePendingToRetryQueueOrReject(session: ActiveSession): void {
    for (const [seq, pending] of session.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      session.pendingRequests.delete(seq);
      if (pending.retryable && !session.manuallyClosed && !session.fatalError) {
        session.retryQueue.push({
          opcode: pending.opcode,
          payload: pending.payload,
          resolve: pending.resolve,
          reject: pending.reject,
        });
      } else {
        pending.reject(new Error("MAX WebSocket connection closed"));
      }
    }
  }

  private async flushRetryQueue(session: ActiveSession): Promise<void> {
    if (!session.connected || !session.authorized) return;
    const items = session.retryQueue.splice(0, session.retryQueue.length);
    for (const item of items) {
      try {
        const res = await this.sendRpc(session, item.opcode, item.payload, {
          cmd: MaxCommand.RETRY,
          retryable: false,
        });
        item.resolve(res);
      } catch (err) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private sendAck(session: ActiveSession, seq: number, opcode: number, payload: Record<string, unknown> = {}): void {
    if (!session.connected || session.ws.readyState !== WebSocket.OPEN) return;
    const frame = packMaxFrame({
      cmd: MaxCommand.ACK,
      seq,
      opcode,
      payload,
    });
    session.ws.send(frame);
  }

  private sendRpc(
    session: ActiveSession,
    opcode: number,
    payload: unknown,
    opts?: { cmd?: number; retryable?: boolean; timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    if (!session.connected || session.ws.readyState !== WebSocket.OPEN) {
      if (opts?.retryable && !session.manuallyClosed && !session.fatalError) {
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          session.retryQueue.push({ opcode, payload, resolve, reject });
        });
      }
      return Promise.reject(new Error("MAX WebSocket is not connected"));
    }

    const seq = ++session.seq & 0xffff || (++session.seq & 0xffff);
    const frame = packMaxFrame({
      cmd: opts?.cmd ?? MaxCommand.REQUEST,
      seq,
      opcode,
      payload,
    });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pendingRequests.delete(seq);
        reject(new Error(`MAX RPC timeout opcode=${opcode} seq=${seq}`));
      }, opts?.timeoutMs ?? RPC_TIMEOUT_MS);

      session.pendingRequests.set(seq, {
        opcode,
        payload,
        retryable: Boolean(opts?.retryable),
        resolve,
        reject,
        timer,
      });
      session.ws.send(frame);
    });
  }

  private handleRawFrame(session: ActiveSession, rawData: unknown): void {
    session.lastRecvAt = Date.now();
    try {
      const buf =
        rawData instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(rawData))
          : typeof rawData === "string"
            ? Buffer.from(rawData, "utf8")
            : Buffer.from(rawData as Uint8Array);

      const frame = unpackMaxFrame<Record<string, unknown>>(buf);

      // Ответ на наш запрос (ACK / ERROR)
      if (frame.cmd === MaxCommand.ACK || frame.cmd === MaxCommand.ERROR) {
        // Обновление токена из LOGIN (19) или AUTH_CONFIRM (23)
        if (
          frame.cmd === MaxCommand.ACK &&
          (frame.opcode === MaxOpcode.LOGIN || frame.opcode === MaxOpcode.AUTH_CONFIRM) &&
          typeof frame.payload?.token === "string" &&
          frame.payload.token &&
          frame.payload.token !== session.token
        ) {
          void this.persistSessionUpdate(session, { token: frame.payload.token });
        }

        const pending = session.pendingRequests.get(frame.seq);
        if (pending) {
          clearTimeout(pending.timer);
          session.pendingRequests.delete(frame.seq);

          if (frame.cmd === MaxCommand.ERROR) {
            const errCode = String(frame.payload?.error ?? "max.error");
            const errMsg = String(
              frame.payload?.localizedMessage ?? frame.payload?.message ?? errCode,
            );
            if (isFatalMaxAuthError(errCode)) {
              session.fatalError = true;
              void this.persistSessionUpdate(session, {
                status: "error",
                statusMessage: `Сессия MAX отозвана (${errCode}) — переподключите аккаунт`,
                clearSession: true,
              });
              try {
                session.ws.close();
              } catch {}
            }
            pending.reject(new MaxProtocolError(errCode, errMsg, frame.opcode));
          } else {
            pending.resolve(frame.payload ?? {});
          }
        }
        return;
      }

      // Server-initiated REQUEST (cmd === 0) или EVENT (cmd === 2)
      if (frame.cmd === MaxCommand.REQUEST || frame.cmd === MaxCommand.RETRY) {
        // Обязательный ACK cmd=1 на входящие cmd=0
        if (frame.cmd === MaxCommand.REQUEST) {
          if (frame.opcode === MaxOpcode.PING) {
            this.sendAck(session, frame.seq, MaxOpcode.PING, {});
          } else if (frame.opcode === MaxOpcode.NOTIF_MESSAGE) {
            const msg = frame.payload?.message as RawMaxMessage | undefined;
            const ackPayload: Record<string, unknown> = {};
            if (frame.payload?.chatId !== undefined) {
              ackPayload.chatId = frame.payload.chatId;
            }
            if (msg?.id !== undefined) {
              ackPayload.messageId = msg.id;
            }
            this.sendAck(session, frame.seq, MaxOpcode.NOTIF_MESSAGE, ackPayload);
          } else if (frame.opcode === MaxOpcode.NOTIF_CALL_START) {
            this.sendAck(session, frame.seq, MaxOpcode.NOTIF_CALL_START, {});
          } else {
            this.sendAck(session, frame.seq, frame.opcode, {});
          }
        }

        // Дедупликация по lastInSeq для входящих cmd=0
        if (frame.cmd === MaxCommand.REQUEST && frame.seq > 0) {
          if (frame.seq <= session.lastInSeq && session.lastInSeq - frame.seq < 0x8000) {
            return;
          }
          session.lastInSeq = frame.seq;
        }

        // Обновление токена, если пришло push AUTH_CONFIRM (23)
        if (
          frame.opcode === MaxOpcode.AUTH_CONFIRM &&
          typeof frame.payload?.token === "string" &&
          frame.payload.token &&
          frame.payload.token !== session.token
        ) {
          void this.persistSessionUpdate(session, { token: frame.payload.token });
        }

        // Завершение загрузки файла/видео (NOTIF_ATTACH = 136)
        if (frame.opcode === MaxOpcode.NOTIF_ATTACH) {
          const fid = asStrId(frame.payload?.fileId ?? frame.payload?.videoId ?? frame.payload?.audioId);
          if (fid) {
            const waiter = session.attachWaiters.get(fid);
            if (waiter) {
              clearTimeout(waiter.timer);
              session.attachWaiters.delete(fid);
              waiter.resolve();
            }
          }
          return;
        }

        if (frame.opcode === MaxOpcode.NOTIF_MESSAGE) {
          void this.handleInboundNotifMessage(session, frame.payload);
        }
      }
    } catch {
      // Игнорируем повреждённый фрейм, чтобы не обрывать живой сокет
    }
  }

  private extractMessageAttachments(
    session: ActiveSession,
    rawMsg: RawMaxMessage,
    chatId: string,
  ): { text: string; attachments: InboundAttachment[] } {
    const forwarded = rawMsg.link?.type === "FORWARD" ? rawMsg.link.message : undefined;
    const rawAtts = [
      ...(Array.isArray(rawMsg.attaches) ? rawMsg.attaches : []),
      ...(Array.isArray(forwarded?.attaches) ? forwarded.attaches : []),
    ];

    const attachments: InboundAttachment[] = [];
    const msgId = asStrId(rawMsg.id ?? "0");

    for (const att of rawAtts) {
      const kind = String(att._type ?? att.type ?? "").toUpperCase();
      if (kind === "PHOTO") {
        const photoId = asStrId(att.photoId ?? att.photoToken ?? Date.now());
        const fileId = `max:${chatId}:${msgId}:photo:${photoId}`;
        if (att.baseUrl) {
          session.photoUrlCache.set(fileId, att.baseUrl);
        }
        attachments.push({
          type: "photo",
          fileId,
          url: att.baseUrl,
          mimeType: "image/jpeg",
        });
      } else if (kind === "VIDEO") {
        const videoId = asStrId(att.videoId ?? Date.now());
        attachments.push({
          type: "video",
          fileId: `max:${chatId}:${msgId}:video:${videoId}`,
          mimeType: "video/mp4",
        });
      } else if (kind === "AUDIO") {
        const audioId = asStrId(att.audioId ?? Date.now());
        attachments.push({
          type: "voice",
          fileId: `max:${chatId}:${msgId}:audio:${audioId}`,
          mimeType: "audio/ogg",
        });
      } else if (kind === "FILE") {
        const fileId = asStrId(att.fileId ?? Date.now());
        attachments.push({
          type: "document",
          fileId: `max:${chatId}:${msgId}:file:${fileId}`,
          fileName: att.name ?? att.fileName ?? "file.bin",
          mimeType: att.mimeType ?? "application/octet-stream",
          fileSize: att.size ?? att.fileSize,
        });
      }
    }

    const baseText = (rawMsg.text ?? "").trim() || (forwarded?.text ?? "").trim();
    const fallbackLabel =
      attachments[0]?.type === "photo"
        ? "[фото]"
        : attachments[0]?.type === "video"
          ? "[видео]"
          : attachments[0]?.type === "voice"
            ? "[голосовое]"
            : attachments[0]?.fileName
              ? `[файл: ${attachments[0].fileName}]`
              : "";

    return {
      text: baseText || fallbackLabel,
      attachments,
    };
  }

  private async handleInboundNotifMessage(
    session: ActiveSession,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const rawMsg = (payload.message ?? payload) as RawMaxMessage | undefined;
    if (!rawMsg || typeof rawMsg !== "object") return;

    const chatId = asStrId(payload.chatId ?? rawMsg.chatId);
    if (!chatId || chatId.startsWith("-")) return;

    const chatObj = session.chats.get(chatId);
    if (chatObj?.type && String(chatObj.type).toUpperCase() !== "DIALOG") return;

    const msgId = asStrId(rawMsg.id);
    if (msgId) {
      const dedupKey = `${session.channelAccountId}:${msgId}`;
      const now = Date.now();
      if (this.dedupInbound.has(dedupKey)) return;
      this.dedupInbound.set(dedupKey, now);
      if (this.dedupInbound.size > 2000) {
        for (const [k, ts] of this.dedupInbound.entries()) {
          if (now - ts > 10 * 60_000) this.dedupInbound.delete(k);
        }
      }
    }

    const senderId = asStrId(rawMsg.sender ?? rawMsg.senderId ?? rawMsg.from);
    const isOut = Boolean(rawMsg.out) || Boolean(session.selfUserId && senderId === session.selfUserId);

    // Для входящих и исходящих сообщений при необходимости довычисляем peerUserId из chat.participants или XOR
    let peerUserId = senderId;
    if ((isOut || !peerUserId) && session.selfUserId) {
      if (chatObj?.participants) {
        const other = Object.keys(chatObj.participants).find((k) => k !== session.selfUserId && k !== "0");
        if (other) peerUserId = other;
      } else if (/^\d+$/.test(chatId) && /^\d+$/.test(session.selfUserId)) {
        peerUserId = (BigInt(chatId) ^ BigInt(session.selfUserId)).toString();
      }
    }

    if (session.selfUserId && peerUserId === session.selfUserId && chatId === session.selfUserId) {
      return;
    }

    const { text, attachments } = this.extractMessageAttachments(session, rawMsg, chatId);
    if (!text && attachments.length === 0) return;

    const profile = await this.lookupContactInfo(session, peerUserId);
    if (profile?.isBot) return;

    const rawTime = Number(rawMsg.time ?? rawMsg.date ?? Date.now());
    const timestamp = rawTime > 1e11 ? rawTime : rawTime * 1000;

    const event: IncomingEvent = {
      tenantId: session.tenantId,
      channelAccountId: session.channelAccountId,
      channel: "max",
      eventType: "message",
      chatId,
      timestamp,
      message: {
        id: msgId || String(timestamp),
        chatId,
        senderId: peerUserId || chatId,
        senderName: profile?.senderName,
        senderPhone: profile?.phone,
        senderUsername: profile?.username,
        text,
        direction: isOut ? "outbound" : "inbound",
        fromMe: isOut,
        timestamp,
        attachments: attachments.length > 0 ? attachments : undefined,
        rawPayload: {
          ...payload,
          peerUserId,
          selfPhone: session.selfPhone,
          senderFirstName: profile?.firstName,
          senderLastName: profile?.lastName,
        },
      },
    };

    for (const sub of this.eventSubscribers) {
      try {
        sub(event);
      } catch {}
    }
  }

  private async lookupContactInfo(
    session: ActiveSession,
    userId: string,
    forceRefresh = false,
  ): Promise<{
    firstName?: string;
    lastName?: string;
    senderName: string;
    phone?: string;
    username?: string;
    link?: string;
    isBot?: boolean;
  } | null> {
    if (!userId || !/^\d+$/.test(userId)) return null;
    const cacheKey = `${session.channelAccountId}:${userId}`;
    if (!forceRefresh) {
      const cached = this.contactCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached;
      }
    }

    let rawContact = forceRefresh ? undefined : session.contacts.get(userId);
    const missingPhone =
      !rawContact ||
      (rawContact.phone === undefined && (!rawContact.phones || rawContact.phones.length === 0));
    if (!rawContact || missingPhone) {
      try {
        const res = await this.sendRpc(session, MaxOpcode.CONTACT_INFO, {
          contactIds: [toMaxIdValue(userId)],
        });
        const list = Array.isArray(res.contacts) ? (res.contacts as RawMaxContact[]) : [];
        if (list[0]) {
          rawContact = rawContact ? { ...rawContact, ...list[0] } : list[0];
          session.contacts.set(userId, rawContact);
        }
      } catch {
        if (!rawContact) return null;
      }
    }

    if (!rawContact) return null;
    const rawPhone = rawContact.phone ?? rawContact.phones?.[0]?.number;
    const identity = extractMaxIdentity({
      names: rawContact.names,
      username: rawContact.username,
      phone: rawPhone !== undefined ? String(rawPhone) : undefined,
      selfPhone: session.selfPhone,
    });
    const isBot =
      rawContact.isBot === true ||
      Boolean(
        rawContact.options?.some((o) => {
          const v = typeof o === "string" ? o : (o?.value ?? "");
          return v.toUpperCase().includes("BOT") && !v.toUpperCase().includes("ONEME");
        }),
      );

    const result = {
      firstName: identity.firstName,
      lastName: identity.lastName,
      senderName: identity.senderName,
      phone: identity.phone,
      username: rawContact.username,
      link: rawContact.link,
      isBot,
      expiresAt: Date.now() + 10 * 60_000,
    };
    this.contactCache.set(cacheKey, result);
    return result;
  }

  private async resolveTargetChatId(session: ActiveSession, recipient: string): Promise<number | bigint> {
    const clean = recipient.trim();

    // 1. Ссылка max.ru?...id=123
    const urlMatch = clean.match(/id=(\d+)/);
    if (urlMatch?.[1]) {
      const uid = urlMatch[1];
      if (session.selfUserId && uid === session.selfUserId) {
        throw new Error("Отправка самому себе заблокирована");
      }
      await this.sendRpc(session, MaxOpcode.CONTACT_ADD, {
        contactId: toMaxIdValue(uid),
        action: "ADD",
      }).catch(() => {});
      if (session.selfUserId) {
        return computeDialogChatId(session.selfUserId, uid);
      }
      return toMaxIdValue(uid);
    }

    // 2. Телефон (+7... или 10-11 цифр)
    const digits = clean.replace(/\D/g, "");
    if (clean.startsWith("+") || (/^[78]\d{10}$/.test(digits) && !session.chats.has(clean))) {
      const phoneE164 =
        clean.startsWith("+") ? `+${digits}` : digits.startsWith("8") ? `+7${digits.slice(1)}` : `+${digits}`;
      let uid = "";
      try {
        const res = await this.sendRpc(session, MaxOpcode.CONTACT_INFO_BY_PHONE, { phone: phoneE164 });
        const contact = res.contact as RawMaxContact | undefined;
        if (contact?.id) {
          uid = asStrId(contact.id);
        }
      } catch {
        // Fallback ниже поищет среди уже известных контактов/диалогов текущей сессии
      }

      if (!uid && digits.length >= 10) {
        const tail10 = digits.slice(-10);
        for (const cachedContact of session.contacts.values()) {
          const cPhone = String(cachedContact.phone ?? cachedContact.phones?.[0]?.number ?? "").replace(/\D/g, "");
          if (cPhone.length >= 10 && cPhone.slice(-10) === tail10 && cachedContact.id !== undefined) {
            uid = asStrId(cachedContact.id);
            break;
          }
        }
      }

      if (!uid) {
        throw new Error("Контакт не найден в MAX по номеру телефона");
      }
      if (session.selfUserId && uid === session.selfUserId) {
        throw new Error("Телефон совпадает с номером подключённого MAX-аккаунта");
      }
      await this.sendRpc(session, MaxOpcode.CONTACT_ADD, {
        contactId: toMaxIdValue(uid),
        action: "ADD",
      }).catch(() => {});
      if (session.selfUserId) {
        return computeDialogChatId(session.selfUserId, uid);
      }
      return toMaxIdValue(uid);
    }

    // 3. Уже известный chatId
    if (session.chats.has(clean)) {
      return toMaxIdValue(clean);
    }

    // 4. Может быть передан bare peerUserId (из contact.socials max_user_id) вместо XOR chatId:
    //    ищем среди участников загруженных диалогов или резолвим user -> chatId XOR meId
    if (/^\d+$/.test(clean) && session.selfUserId) {
      for (const chat of session.chats.values()) {
        if (chat.participants && Object.prototype.hasOwnProperty.call(chat.participants, clean)) {
          return toMaxIdValue(chat.id);
        }
      }
      if (session.contacts.has(clean)) {
        await this.sendRpc(session, MaxOpcode.CONTACT_ADD, {
          contactId: toMaxIdValue(clean),
          action: "ADD",
        }).catch(() => {});
        return computeDialogChatId(session.selfUserId, clean);
      }
      const contactCheck = await this.sendRpc(session, MaxOpcode.CONTACT_INFO, {
        contactIds: [toMaxIdValue(clean)],
      }).catch(() => null);
      const foundList = Array.isArray(contactCheck?.contacts) ? (contactCheck?.contacts as RawMaxContact[]) : [];
      if (foundList[0]?.id !== undefined) {
        session.contacts.set(clean, foundList[0]);
        await this.sendRpc(session, MaxOpcode.CONTACT_ADD, {
          contactId: toMaxIdValue(clean),
          action: "ADD",
        }).catch(() => {});
        return computeDialogChatId(session.selfUserId, clean);
      }
    }

    return toMaxIdValue(clean);
  }

  private async uploadAttachment(
    session: ActiveSession,
    att: OutboundAttachment,
  ): Promise<Record<string, unknown>> {
    const rawBuffer = att.buffer
      ? att.buffer
      : att.base64
        ? Buffer.from(att.base64, "base64")
        : att.url
          ? Buffer.from(await (await fetch(att.url)).arrayBuffer())
          : null;

    if (!rawBuffer || rawBuffer.length === 0) {
      throw new Error("Пустое вложение для отправки в MAX");
    }

    const mime = (att.mimeType ?? "application/octet-stream").toLowerCase();
    const isPhoto = att.type === "image" || mime.startsWith("image/");

    if (isPhoto) {
      const res = await this.sendRpc(session, MaxOpcode.PHOTO_UPLOAD, {
        count: 1,
        type: 0,
        uploaderType: 0,
        profile: false,
      });
      const uploadUrl = typeof res.url === "string" ? res.url : "";
      if (!uploadUrl) {
        throw new Error("MAX не вернул URL для загрузки фото");
      }
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(rawBuffer)], { type: mime }), att.fileName || `image.${ext}`);

      const uploadResp = await fetch(uploadUrl, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(UPLOAD_WAIT_TIMEOUT_MS),
      });
      if (!uploadResp.ok) {
        throw new Error(`Ошибка загрузки фото в MAX: HTTP ${uploadResp.status}`);
      }
      const uploadJson = (await uploadResp.json()) as {
        photos?: Record<string, { token?: string }>;
      };
      const firstPhoto = uploadJson.photos ? Object.values(uploadJson.photos)[0] : undefined;
      if (!firstPhoto?.token) {
        throw new Error("MAX не вернул photoToken после загрузки фото");
      }
      return {
        _type: "PHOTO",
        photoToken: firstPhoto.token,
      };
    }

    // Файл / документ / видео / аудио → FILE_UPLOAD (87) + ожидание NOTIF_ATTACH (136)
    const fileRes = await this.sendRpc(session, MaxOpcode.FILE_UPLOAD, {
      count: 1,
      type: 0,
      uploaderType: 0,
      profile: false,
    });
    const infoList = Array.isArray(fileRes.info)
      ? (fileRes.info as Array<{ fileId?: number | string | bigint; url?: string }>)
      : [];
    const info = infoList[0];
    if (!info?.url || info.fileId === undefined) {
      throw new Error("MAX не вернул fileId/url для загрузки файла");
    }

    const fileIdKey = asStrId(info.fileId);
    const fileName = (att.fileName || "file.bin").trim();

    const waitAttachPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.attachWaiters.delete(fileIdKey);
        reject(new Error(`Таймаут обработки файла MAX (${fileIdKey})`));
      }, UPLOAD_WAIT_TIMEOUT_MS);
      session.attachWaiters.set(fileIdKey, { resolve, reject, timer });
    });

    const uploadResp = await fetch(info.url, {
      method: "POST",
      headers: {
        "Content-Disposition": `attachment; filename=${encodeURIComponent(fileName)}`,
        "Content-Length": String(rawBuffer.length),
        "Content-Range": `0-${rawBuffer.length - 1}/${rawBuffer.length}`,
      },
      body: new Uint8Array(rawBuffer),
      signal: AbortSignal.timeout(UPLOAD_WAIT_TIMEOUT_MS),
    });

    if (!uploadResp.ok) {
      const w = session.attachWaiters.get(fileIdKey);
      if (w) {
        clearTimeout(w.timer);
        session.attachWaiters.delete(fileIdKey);
      }
      throw new Error(`Ошибка загрузки файла в MAX: HTTP ${uploadResp.status}`);
    }

    await waitAttachPromise;
    return {
      _type: "FILE",
      fileId: toMaxIdValue(fileIdKey),
    };
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessageResult> {
    try {
      const session = await this.getOrCreateSession(params.tenantId, params.channelAccountId);
      const chatId = await this.resolveTargetChatId(session, params.recipient);

      const attaches: Array<Record<string, unknown>> = [];
      if (params.attachments && params.attachments.length > 0) {
        for (const att of params.attachments) {
          attaches.push(await this.uploadAttachment(session, att));
        }
      }

      const cid = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      const payload = {
        chatId,
        message: {
          text: params.text || null,
          cid,
          elements: [],
          attaches,
          ...(params.replyToMessageId
            ? { link: { type: "REPLY", messageId: toMaxIdValue(params.replyToMessageId) } }
            : {}),
        },
        notify: true,
      };

      let res: Record<string, unknown>;
      try {
        res = await this.sendRpc(session, MaxOpcode.MSG_SEND, payload, { retryable: true });
      } catch (err) {
        if (err instanceof MaxProtocolError && err.code === "attachment.not.ready") {
          await sleep(1500);
          res = await this.sendRpc(session, MaxOpcode.MSG_SEND, payload, { retryable: true });
        } else {
          throw err;
        }
      }

      const sentMsg = res.message as { id?: number | string | bigint; time?: number } | undefined;
      return {
        ok: true,
        messageId: sentMsg?.id !== undefined ? String(sentMsg.id) : String(Date.now()),
        timestamp: sentMsg?.time ?? Date.now(),
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
      const res = await this.sendRpc(session, MaxOpcode.CHAT_HISTORY, {
        chatId: toMaxIdValue(params.chatId),
        from: params.cursor ? toMaxIdValue(params.cursor) : Date.now(),
        forward: 0,
        backward: params.limit || 50,
        backwardTime: 0,
        forwardTime: 0,
        getChat: false,
        itemType: "REGULAR",
        getMessages: true,
        interactive: false,
      });

      const rawMessages = Array.isArray(res.messages) ? (res.messages as RawMaxMessage[]) : [];
      const messages: NormalizedMessage[] = rawMessages.map((m) => {
        const rawTime = Number(m.time ?? m.date ?? Date.now());
        const senderId = asStrId(m.sender ?? m.senderId ?? m.from);
        const fromMe = Boolean(m.out) || Boolean(session.selfUserId && senderId === session.selfUserId);
        const { text, attachments } = this.extractMessageAttachments(session, m, params.chatId);
        return {
          id: asStrId(m.id ?? rawTime),
          chatId: params.chatId,
          senderId,
          text,
          direction: fromMe ? "outbound" : "inbound",
          fromMe,
          timestamp: rawTime > 1e11 ? rawTime : rawTime * 1000,
          attachments: attachments.length > 0 ? attachments : undefined,
          rawPayload: m as unknown as Record<string, unknown>,
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

  async getPrivateDialogs(
    tenantId: string,
    channelAccountId: string,
    dialogLimit = 80,
    messageLimit = 50,
  ): Promise<MaxPrivateDialogsResponse> {
    try {
      const session = await this.getOrCreateSession(tenantId, channelAccountId);
      const chatsResp = await this.sendRpc(session, MaxOpcode.CHATS_LIST, { marker: Date.now() });
      const rawChats = Array.isArray(chatsResp.chats) ? (chatsResp.chats as RawMaxChat[]) : [];
      for (const c of rawChats) {
        if (c?.id !== undefined) session.chats.set(asStrId(c.id), c);
      }

      const privateChats = Array.from(session.chats.values())
        .filter((c) => {
          const idNum = Number(c.id);
          if (!Number.isNaN(idNum) && idNum <= 0) return false;
          const t = String(c.type ?? "").toUpperCase();
          return !t || t === "DIALOG";
        })
        .sort((a, b) => Number(b.lastEventTime ?? b.modified ?? 0) - Number(a.lastEventTime ?? a.modified ?? 0));

      const dialogs: MaxBridgeDialog[] = [];
      for (const chat of privateChats) {
        if (dialogLimit > 0 && dialogs.length >= dialogLimit) break;
        const chatId = asStrId(chat.id);
        let peerUserId = "";
        if (chat.participants) {
          peerUserId = Object.keys(chat.participants).find((k) => k !== session.selfUserId && k !== "0") ?? "";
        }
        if (!peerUserId && session.selfUserId && /^\d+$/.test(chatId) && /^\d+$/.test(session.selfUserId)) {
          peerUserId = (BigInt(chatId) ^ BigInt(session.selfUserId)).toString();
        }
        if (!peerUserId || peerUserId === session.selfUserId) continue;

        const profile = await this.lookupContactInfo(session, peerUserId);
        if (profile?.isBot) continue;

        const hist = await this.getHistory({
          tenantId,
          channelAccountId,
          chatId,
          limit: messageLimit,
        });

        const msgs: MaxBridgeDialogMessage[] = hist.messages
          .slice()
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((m) => ({
            id: m.id,
            out: m.fromMe,
            text: m.text,
            date: Math.floor(m.timestamp / 1000),
            attachments: m.attachments?.map((a) => ({
              type: a.type,
              fileId: a.fileId,
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
            })),
          }));

        dialogs.push({
          chatId,
          userId: peerUserId,
          username: profile?.username ?? null,
          firstName: profile?.firstName ?? (profile?.senderName && profile.senderName !== "Клиент MAX" ? profile.senderName : null),
          lastName: profile?.lastName ?? null,
          phone: profile?.phone ?? null,
          link: profile?.link ?? null,
          messages: msgs,
        });
      }

      return {
        ok: true,
        dialogs,
        selfPhone: session.selfPhone ?? undefined,
        selfMaxUserId: session.selfUserId ?? undefined,
      };
    } catch (err) {
      return {
        ok: false,
        dialogs: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async downloadMedia(
    tenantId: string,
    channelAccountId: string,
    fileId: string,
  ): Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; error?: string }> {
    try {
      const session = await this.getOrCreateSession(tenantId, channelAccountId);

      // max:<chatId>:<msgId>:<kind>:<nativeId>
      const parts = fileId.split(":");
      if (parts.length < 5 || parts[0] !== "max") {
        return { ok: false, error: `Unsupported MAX fileId format: ${fileId}` };
      }

      const chatId = parts[1]!;
      const msgId = parts[2]!;
      const kind = parts[3]!;
      const nativeId = parts.slice(4).join(":");

      let mediaUrl = session.photoUrlCache.get(fileId);
      let fallbackMime = kind === "photo" ? "image/jpeg" : kind === "video" ? "video/mp4" : "application/octet-stream";

      if (!mediaUrl && kind === "file") {
        const res = await this.sendRpc(session, MaxOpcode.FILE_DOWNLOAD, {
          chatId: toMaxIdValue(chatId),
          messageId: toMaxIdValue(msgId),
          fileId: toMaxIdValue(nativeId),
        });
        if (typeof res.url === "string") mediaUrl = res.url;
      } else if (!mediaUrl && kind === "video") {
        const res = await this.sendRpc(session, MaxOpcode.VIDEO_PLAY, {
          chatId: toMaxIdValue(chatId),
          messageId: toMaxIdValue(msgId),
          videoId: toMaxIdValue(nativeId),
        });
        const videoUrl = Object.entries(res).find(([k, v]) => k.startsWith("MP4") && typeof v === "string")?.[1];
        if (typeof videoUrl === "string") mediaUrl = videoUrl;
      }

      if (!mediaUrl) {
        const msgRes = await this.sendRpc(session, MaxOpcode.MSG_GET, {
          chatId: toMaxIdValue(chatId),
          messageIds: [toMaxIdValue(msgId)],
        });
        const list = Array.isArray(msgRes.messages) ? (msgRes.messages as RawMaxMessage[]) : [];
        if (list[0]) {
          const { attachments } = this.extractMessageAttachments(session, list[0], chatId);
          const matched = attachments.find((a) => a.fileId === fileId) ?? attachments[0];
          if (matched?.url) mediaUrl = matched.url;
          if (matched?.mimeType) fallbackMime = matched.mimeType;
        }
      }

      if (!mediaUrl) {
        return { ok: false, error: "URL вложения MAX не найден" };
      }

      const resp = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status} при скачивании медиа из MAX` };
      }
      const buffer = Buffer.from(await resp.arrayBuffer());
      const mimeType = resp.headers.get("content-type")?.split(";")[0]?.trim() || fallbackMime;
      return { ok: true, buffer, mimeType };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async lookupProfileByPhone(
    tenantId: string,
    channelAccountId: string,
    phone: string,
  ): Promise<{
    exists: boolean;
    userId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    link?: string;
    error?: string;
  }> {
    try {
      const session = await this.getOrCreateSession(tenantId, channelAccountId);
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        return { exists: false, error: "Invalid phone number" };
      }
      const phoneE164 =
        digits.length === 11 && digits.startsWith("8") ? `+7${digits.slice(1)}` : `+${digits}`;
      const res = await this.sendRpc(session, MaxOpcode.CONTACT_INFO_BY_PHONE, { phone: phoneE164 });
      const contact = res.contact as RawMaxContact | undefined;
      if (!contact?.id) {
        return { exists: false };
      }
      const identity = extractMaxIdentity({
        names: contact.names,
        username: contact.username,
        phone: contact.phone !== undefined ? String(contact.phone) : phoneE164,
        selfPhone: session.selfPhone,
      });
      return {
        exists: true,
        userId: asStrId(contact.id),
        username: contact.username,
        firstName: identity.firstName,
        lastName: identity.lastName,
        link: contact.link,
      };
    } catch (err) {
      if (err instanceof MaxProtocolError && err.code.includes("not.found")) {
        return { exists: false };
      }
      return {
        exists: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async lookupProfileByUserId(
    tenantId: string,
    channelAccountId: string,
    userId?: string | null,
    chatId?: string | null,
  ): Promise<{
    exists: boolean;
    userId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    link?: string;
    isBot?: boolean;
    error?: string;
  }> {
    try {
      const session = await this.getOrCreateSession(tenantId, channelAccountId);
      let targetUserId = (userId ?? "").trim();
      const cleanChatId = (chatId ?? "").trim();
      if (!targetUserId && cleanChatId) {
        let chat = session.chats.get(cleanChatId);
        if (!chat) {
          const chatInfoRes = await this.sendRpc(session, MaxOpcode.CHAT_INFO, {
            chatIds: [toMaxIdValue(cleanChatId)],
          }).catch(() => null);
          const list = Array.isArray(chatInfoRes?.chats) ? (chatInfoRes?.chats as RawMaxChat[]) : [];
          if (list[0]) {
            chat = list[0];
            session.chats.set(cleanChatId, chat);
          }
        }
        if (chat?.participants) {
          targetUserId = Object.keys(chat.participants).find((k) => k !== session.selfUserId && k !== "0") ?? "";
        }
        if (!targetUserId && chat && session.selfUserId && /^\d+$/.test(cleanChatId) && /^\d+$/.test(session.selfUserId)) {
          targetUserId = (BigInt(cleanChatId) ^ BigInt(session.selfUserId)).toString();
        }
      }
      if (!targetUserId || !/^\d+$/.test(targetUserId) || (session.selfUserId && targetUserId === session.selfUserId)) {
        return { exists: false };
      }

      const profile = await this.lookupContactInfo(session, targetUserId, true);
      if (!profile || profile.isBot) {
        return { exists: false, isBot: profile?.isBot };
      }

      return {
        exists: true,
        userId: targetUserId,
        username: profile.username,
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone,
        link: profile.link,
        isBot: false,
      };
    } catch (err) {
      return {
        exists: false,
        error: err instanceof Error ? err.message : String(err),
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

      if (/^\d+$/.test(clean) && clean.length < 11) {
        const res = await this.sendRpc(session, MaxOpcode.CONTACT_INFO, {
          contactIds: [toMaxIdValue(clean)],
        });
        const contacts = Array.isArray(res.contacts) ? (res.contacts as RawMaxContact[]) : [];
        const contact = contacts[0];
        if (!contact) return null;
        const identity = extractMaxIdentity({
          names: contact.names,
          username: contact.username,
          phone: contact.phone !== undefined ? String(contact.phone) : contact.phones?.[0]?.number,
          selfPhone: session.selfPhone,
        });
        return {
          id: asStrId(contact.id ?? clean),
          name: identity.senderName,
          phone: identity.phone,
          username: contact.username,
          isRegistered: true,
        };
      }

      const digits = clean.replace(/\D/g, "");
      if (digits.length >= 10) {
        const phoneE164 =
          digits.length === 11 && digits.startsWith("8") ? `+7${digits.slice(1)}` : `+${digits}`;
        const res = await this.sendRpc(session, MaxOpcode.CONTACT_INFO_BY_PHONE, { phone: phoneE164 });
        const contact = res.contact as RawMaxContact | undefined;
        if (!contact?.id) return null;
        const identity = extractMaxIdentity({
          names: contact.names,
          username: contact.username,
          phone: contact.phone !== undefined ? String(contact.phone) : phoneE164,
          selfPhone: session.selfPhone,
        });
        return {
          id: asStrId(contact.id),
          name: identity.senderName,
          phone: identity.phone ?? phoneE164,
          username: contact.username,
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

  async getActiveSessions(tenantId: string, channelAccountId: string): Promise<MaxSessionRecord[]> {
    const session = await this.getOrCreateSession(tenantId, channelAccountId);
    const res = await this.sendRpc(session, MaxOpcode.SESSIONS_INFO, {});
    const list = Array.isArray(res.sessions) ? (res.sessions as Record<string, unknown>[]) : [];
    return list.map((s, idx) => {
      const client = typeof s.client === "string" ? s.client : undefined;
      const info = typeof s.info === "string" ? s.info : undefined;
      const time = typeof s.time === "number" ? s.time : undefined;
      const id =
        s.id !== undefined && s.id !== null
          ? typeof s.id === "bigint"
            ? s.id.toString()
            : (s.id as string | number)
          : `${client ?? "session"}-${time ?? idx}`;
      return {
        id,
        deviceId: typeof s.deviceId === "string" ? s.deviceId : undefined,
        current: Boolean(s.current),
        client,
        info,
        time,
        userAgent: typeof s.userAgent === "string" ? s.userAgent : undefined,
        appVersion: typeof s.appVersion === "string" ? s.appVersion : undefined,
        deviceName: (typeof s.deviceName === "string" ? s.deviceName : undefined) ?? info,
        deviceType: (typeof s.deviceType === "string" ? s.deviceType : undefined) ?? client,
        platform: typeof s.platform === "string" ? s.platform : undefined,
        ip: typeof s.ip === "string" ? s.ip : undefined,
        location: typeof s.location === "string" ? s.location : undefined,
        created: typeof s.created === "number" ? s.created : undefined,
        updated: typeof s.updated === "number" ? s.updated : undefined,
        lastActivity: (typeof s.lastActivity === "number" ? s.lastActivity : undefined) ?? time,
      };
    });
  }

  async closeOtherSessions(tenantId: string, channelAccountId: string): Promise<boolean> {
    const session = await this.getOrCreateSession(tenantId, channelAccountId);
    const res = await this.sendRpc(session, MaxOpcode.SESSIONS_CLOSE, {});
    const newToken = typeof res.token === "string" ? res.token : "";
    if (newToken) {
      await this.persistSessionUpdate(session, { token: newToken });
      return true;
    }
    return false;
  }

  async connectAccount(tenantId: string, channelAccountId: string): Promise<boolean> {
    try {
      const sess = await this.getOrCreateSession(tenantId, channelAccountId);
      return sess.authorized && sess.connected;
    } catch {
      return false;
    }
  }

  disconnectAccount(channelAccountId: string): void {
    const sess = this.findSessionByAccountId(channelAccountId);
    if (!sess) return;
    sess.manuallyClosed = true;
    if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
    if (sess.heartbeatTimer) clearInterval(sess.heartbeatTimer);
    try {
      sess.ws.close();
    } catch {}
    this.sessions.delete(this.sessionKey(sess.tenantId, sess.channelAccountId));
  }

  async startAllNativeSessions(): Promise<void> {
    const accounts = await runWithPlatformScope(() =>
      query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM channel_accounts
         WHERE channel = 'max'
           AND deleted_at IS NULL
           AND status <> 'disabled'
           AND (credentials->>'provider' = 'native-ts' OR credentials->>'adapter' = 'native-ts')
         ORDER BY created_at ASC`,
      ),
    ).catch(() => []);

    for (const acc of accounts) {
      void this.getOrCreateSession(acc.tenant_id, acc.id).catch(() => {});
    }
  }

  destroyAll(): void {
    for (const sess of this.sessions.values()) {
      sess.manuallyClosed = true;
      if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
      if (sess.heartbeatTimer) clearInterval(sess.heartbeatTimer);
      try {
        sess.ws.close();
      } catch {}
    }
    this.sessions.clear();
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
      if (session && session.connected && session.authorized && !session.fatalError) {
        return {
          ok: true,
          status: "connected",
          lastSyncAt: new Date().toISOString(),
        };
      }

      const newSession = await this.getOrCreateSession(tenantId, channelAccountId);
      return {
        ok: newSession.authorized,
        status: newSession.authorized ? "connected" : "error",
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
