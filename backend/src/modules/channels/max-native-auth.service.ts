import { randomUUID } from "node:crypto";

import { withTenant } from "../../db/client.js";
import { encryptSecret } from "../../services/credentials-cipher.js";
import { AppError } from "../../plugins/errorHandler.js";
import {
  buildMaxUserAgent,
  MAX_WS_ENDPOINT,
  MaxCommand,
  MaxOpcode,
  normalizeUuidDeviceId,
  openMaxWebSocket,
  packMaxFrame,
  unpackMaxFrame,
} from "../messaging/adapters/max/max-protocol.js";
import { MaxTsAdapter } from "../messaging/adapters/max/MaxTsAdapter.js";
import { messagingRegistry } from "../messaging/messaging-registry.js";
import { invalidateMaxBridgeLiveBotsCache } from "./max-bridge.service.js";
import { extractMaxIdentity, normalizeMaxPhone, type MaxRawName } from "./max-identity.js";

// ---------------------------------------------------------------------------
// Нативная авторизация MAX по протоколу web.max.ru (без PyMax):
//   - QR-код: opcode 288 (GET_QR) -> 289 (GET_QR_STATUS) -> 291 (LOGIN_BY_QR)
//     с авто-обновлением по expiresAt
//   - Телефон + SMS / звонок: opcode 17 (AUTH_REQUEST) -> 18 (AUTH) / 294
//   - Облачный 2FA-пароль: opcode 115 (AUTH_LOGIN_CHECK_PASSWORD)
// ---------------------------------------------------------------------------

const MAX_QR_REFRESHES = 10;
const AUTH_IDLE_TTL_MS = 15 * 60_000;

interface AuthRpcSocket {
  ws: WebSocket;
  rpc: (opcode: number, payload: unknown, timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
}

interface NativeQrSessionState {
  key: string;
  tenantId: string;
  name: string;
  targetBotId?: string;
  deviceId: string;
  status:
    | "preparing"
    | "qr_ready"
    | "waiting_password"
    | "processing_password"
    | "authorized"
    | "error";
  qrUrl: string | null;
  qrExpiresAt: number | null;
  error: string | null;
  passwordHint: string | null;
  passwordTrackId: string | null;
  botId: string | null;
  user: { id: string; username?: string; firstName?: string } | null;
  cancelled: boolean;
  socket: AuthRpcSocket | null;
  updatedAt: number;
}

interface NativePhoneSessionState {
  authSessionId: string;
  tenantId: string;
  name: string;
  phone: string;
  targetBotId?: string;
  deviceId: string;
  authToken: string;
  trackId?: string;
  passwordTrackId?: string;
  passwordHint?: string | null;
  status: "code_sent" | "waiting_password" | "authorized" | "error";
  error?: string | null;
  botId?: string;
  user?: { id: string; username?: string; firstName?: string } | null;
  socket: AuthRpcSocket;
  updatedAt: number;
}

function formatMaxLabel(name: string, firstName?: string | null, preserve = false): string {
  const cleanName = name.trim();
  if (preserve) return cleanName;
  const cleanFirst = firstName?.trim();
  if (!cleanFirst) return cleanName;
  const suffix = `(${cleanFirst})`;
  if (cleanName.toLowerCase().includes(suffix.toLowerCase())) {
    return cleanName;
  }
  return `${cleanName} ${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MaxNativeAuthService {
  private readonly qrStates = new Map<string, NativeQrSessionState>();
  private readonly phoneStates = new Map<string, NativePhoneSessionState>();

  private qrKey(tenantId: string, name: string, botId?: string): string {
    return botId ? `${tenantId}:bot:${botId}` : `${tenantId}:${name}`;
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [k, s] of this.qrStates.entries()) {
      if (now - s.updatedAt > AUTH_IDLE_TTL_MS) {
        s.cancelled = true;
        s.socket?.close();
        this.qrStates.delete(k);
      }
    }
    for (const [k, s] of this.phoneStates.entries()) {
      if (now - s.updatedAt > AUTH_IDLE_TTL_MS) {
        s.socket.close();
        this.phoneStates.delete(k);
      }
    }
  }

  private async resolveDeviceId(tenantId: string, botId?: string): Promise<string> {
    if (!botId) return randomUUID();
    const row = await withTenant(tenantId, (tx) =>
      tx.queryOne<{ credentials: Record<string, unknown> | null }>(
        `SELECT credentials FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [tenantId, botId],
      ),
    );
    const existing = typeof row?.credentials?.deviceId === "string" ? row.credentials.deviceId : undefined;
    return normalizeUuidDeviceId(existing);
  }

  private async openInitializedSocket(deviceId: string): Promise<AuthRpcSocket> {
    const ws = openMaxWebSocket(MAX_WS_ENDPOINT);
    let seq = 0;
    const pending = new Map<
      number,
      { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
    >();

    const rpc = (opcode: number, payload: unknown, timeoutMs = 15_000): Promise<Record<string, unknown>> => {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("MAX WebSocket не подключён"));
      }
      const id = ++seq & 0xffff || (++seq & 0xffff);
      const frame = packMaxFrame({ cmd: MaxCommand.REQUEST, seq: id, opcode, payload });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MAX auth RPC timeout opcode=${opcode}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(frame);
      });
    };

    ws.addEventListener("message", (event) => {
      try {
        const raw =
          event.data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(event.data))
            : Buffer.from(event.data as Uint8Array);
        const frame = unpackMaxFrame<Record<string, unknown>>(raw);

        if (frame.cmd === MaxCommand.REQUEST) {
          ws.send(packMaxFrame({ cmd: MaxCommand.ACK, seq: frame.seq, opcode: frame.opcode, payload: {} }));
          return;
        }

        const wait = pending.get(frame.seq);
        if (!wait) return;
        clearTimeout(wait.timer);
        pending.delete(frame.seq);

        if (frame.cmd === MaxCommand.ERROR) {
          const code = String(frame.payload?.error ?? "max.auth.error");
          const msg = String(frame.payload?.localizedMessage ?? frame.payload?.message ?? code);
          const err = new AppError(400, code.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), msg);
          wait.reject(err);
        } else {
          wait.resolve(frame.payload ?? {});
        }
      } catch {
        // ignore decode noise
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error("Таймаут подключения к web.max.ru"));
      }, 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Ошибка соединения с wss://api.oneme.ru/websocket"));
      });
      ws.addEventListener("close", () => {
        for (const [id, wait] of pending.entries()) {
          clearTimeout(wait.timer);
          pending.delete(id);
          wait.reject(new Error("Соединение MAX закрыто"));
        }
      });
    });

    await rpc(MaxOpcode.SESSION_INIT, {
      userAgent: buildMaxUserAgent(null),
      deviceId,
      clientSessionId: BigInt(Date.now()),
    });

    return {
      ws,
      rpc,
      close: () => {
        try {
          ws.close();
        } catch {}
      },
    };
  }

  private async finalizeAccountLogin(opts: {
    socket: AuthRpcSocket;
    tenantId: string;
    name: string;
    deviceId: string;
    loginToken: string;
    targetBotId?: string;
    phoneHint?: string;
  }): Promise<{
    botId: string;
    user: { id: string; username?: string; firstName?: string };
  }> {
    const loginResp = await opts.socket.rpc(MaxOpcode.LOGIN, {
      token: opts.loginToken,
      chatsCount: 40,
      interactive: true,
      chatsSync: -1,
      contactsSync: -1,
      presenceSync: -1,
      draftsSync: -1,
    });

    const finalToken =
      typeof loginResp.token === "string" && loginResp.token ? loginResp.token : opts.loginToken;

    const rawProfile = loginResp.profile as
      | { contact?: { id?: unknown; names?: MaxRawName[]; username?: string; phone?: unknown } }
      | { id?: unknown; names?: MaxRawName[]; username?: string; phone?: unknown }
      | undefined;
    const contact =
      rawProfile && typeof rawProfile === "object" && "contact" in rawProfile && rawProfile.contact
        ? rawProfile.contact
        : (rawProfile as { id?: unknown; names?: MaxRawName[]; username?: string; phone?: unknown } | undefined);

    const maxUserId = contact?.id !== undefined ? String(contact.id) : "";
    const identity = extractMaxIdentity({
      names: contact?.names,
      username: contact?.username,
      phone: contact?.phone !== undefined ? String(contact.phone) : opts.phoneHint,
    });
    const firstName = identity.firstName ?? null;
    const username = contact?.username ?? undefined;
    const phone = identity.phone ?? opts.phoneHint ?? "";

    const sessionBackup = {
      token: finalToken,
      deviceId: opts.deviceId,
      phone,
      chatsSync: typeof loginResp.chatsSync === "number" ? loginResp.chatsSync : -1,
      contactsSync: typeof loginResp.contactsSync === "number" ? loginResp.contactsSync : -1,
      draftsSync: typeof loginResp.draftsSync === "number" ? loginResp.draftsSync : -1,
      presenceSync: typeof loginResp.presenceSync === "number" ? loginResp.presenceSync : -1,
      configHash: typeof loginResp.configHash === "string" ? loginResp.configHash : "",
      userAgent: buildMaxUserAgent(null),
    };

    const encryptedSession = encryptSecret(JSON.stringify(sessionBackup));
    const encryptedToken = encryptSecret(finalToken);

    const botId = await withTenant(opts.tenantId, async (tx) => {
      const extId = maxUserId || username || phone || opts.name;
      let existing: { id: string; label: string } | null = null;
      if (opts.targetBotId) {
        existing = await tx.queryOne<{ id: string; label: string }>(
          `SELECT id, label FROM channel_accounts
           WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL
           LIMIT 1`,
          [opts.tenantId, opts.targetBotId],
        );
      }
      if (!existing) {
        existing = await tx.queryOne<{ id: string; label: string }>(
          `SELECT id, label FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL
             AND (external_id = $2 OR label = $3)
           LIMIT 1`,
          [opts.tenantId, extId, opts.name],
        );
      }

      const label = existing && opts.targetBotId
        ? existing.label
        : formatMaxLabel(opts.name, firstName, Boolean(existing));

      const credsMerge = JSON.stringify({
        provider: "native-ts",
        deviceId: opts.deviceId,
        phone,
        encrypted_session: encryptedSession,
        encrypted_token: encryptedToken,
        session_backed_up_at: new Date().toISOString(),
      });

      if (existing) {
        await tx.query(
          `UPDATE channel_accounts
           SET status = 'connected',
               status_message = '',
               label = $3,
               external_id = $4,
               remote_user_id = $5,
               credentials = COALESCE(credentials, '{}'::jsonb) || $6::jsonb,
               credentials_encrypted = true,
               connected_at = COALESCE(connected_at, now()),
               last_sync_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [opts.tenantId, existing.id, label, extId, maxUserId || null, credsMerge],
        );
        return existing.id;
      }

      const inserted = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO channel_accounts (
           tenant_id, channel, label, external_id, status, status_message,
           remote_user_id, credentials, credentials_encrypted, connected_at, last_sync_at
         )
         VALUES ($1, 'max', $2, $3, 'connected', '', $4, $5::jsonb, true, now(), now())
         RETURNING id`,
        [opts.tenantId, label, extId, maxUserId || null, credsMerge],
      );
      return inserted.id;
    });

    invalidateMaxBridgeLiveBotsCache();
    opts.socket.close();

    // Поднимаем постоянное native-ts соединение через MaxTsAdapter
    const nativeAdapter = messagingRegistry.getAdapter("max", "max-native-ts");
    if (nativeAdapter instanceof MaxTsAdapter) {
      nativeAdapter.disconnectAccount(botId);
      await nativeAdapter.connectAccount(opts.tenantId, botId).catch(() => {});
    }

    void import("./channel-history-sync.service.js")
      .then(({ enqueueChannelHistorySync }) =>
        enqueueChannelHistorySync({
          tenantId: opts.tenantId,
          channelAccountId: botId,
          channel: "max",
        }),
      )
      .catch(() => {});

    return {
      botId,
      user: {
        id: maxUserId || botId,
        username,
        firstName: firstName ?? undefined,
      },
    };
  }

  // -------------------------------------------------------------------------
  // QR-авторизация (288 / 289 / 291 + 115) с авто-обновлением по expiresAt
  // -------------------------------------------------------------------------

  async startQr(input: {
    tenantId: string;
    name: string;
    botId?: string;
  }): Promise<{ ok: boolean; status: string; name: string; botId?: string | null }> {
    this.cleanupExpiredStates();
    const key = this.qrKey(input.tenantId, input.name, input.botId);

    const prev = this.qrStates.get(key);
    if (prev) {
      prev.cancelled = true;
      prev.socket?.close();
    }

    const deviceId = await this.resolveDeviceId(input.tenantId, input.botId);
    const state: NativeQrSessionState = {
      key,
      tenantId: input.tenantId,
      name: input.name,
      targetBotId: input.botId,
      deviceId,
      status: "preparing",
      qrUrl: null,
      qrExpiresAt: null,
      error: null,
      passwordHint: null,
      passwordTrackId: null,
      botId: input.botId ?? null,
      user: null,
      cancelled: false,
      socket: null,
      updatedAt: Date.now(),
    };
    this.qrStates.set(key, state);
    void this.runQrLoop(state);

    return {
      ok: true,
      status: state.status,
      name: state.name,
      botId: input.botId ?? null,
    };
  }

  private async runQrLoop(state: NativeQrSessionState): Promise<void> {
    try {
      const socket = await this.openInitializedSocket(state.deviceId);
      if (state.cancelled) {
        socket.close();
        return;
      }
      state.socket = socket;

      let confirmedTrackId: string | null = null;
      for (let attempt = 0; attempt < MAX_QR_REFRESHES && !state.cancelled; attempt++) {
        const qrInfo = await socket.rpc(MaxOpcode.GET_QR, {});
        const trackId = String(qrInfo.trackId ?? "");
        const qrLink = String(qrInfo.qrLink ?? "");
        const expiresAt = Number(qrInfo.expiresAt ?? Date.now() + 60_000);
        const pollingMs = Math.max(1500, Number(qrInfo.pollingInterval ?? 3000));

        if (!trackId || !qrLink) {
          throw new Error("MAX не вернул QR-ссылку");
        }

        state.qrUrl = qrLink;
        state.qrExpiresAt = expiresAt;
        state.error = null;
        state.status = "qr_ready";
        state.updatedAt = Date.now();

        while (!state.cancelled && Date.now() < expiresAt - 2000) {
          await sleep(pollingMs);
          if (state.cancelled) return;
          const st = await socket.rpc(MaxOpcode.GET_QR_STATUS, { trackId });
          const innerStatus = st.status as { loginAvailable?: boolean } | undefined;
          if (innerStatus?.loginAvailable) {
            confirmedTrackId = trackId;
            break;
          }
        }
        if (confirmedTrackId) break;
      }

      if (state.cancelled) {
        socket.close();
        return;
      }

      if (!confirmedTrackId) {
        throw new Error("Срок ожидания сканирования QR-кода истёк. Нажмите «Обновить QR».");
      }

      const confirm = await socket.rpc(MaxOpcode.LOGIN_BY_QR, { trackId: confirmedTrackId });
      const tokenAttrs = confirm.tokenAttrs as { LOGIN?: { token?: string } } | undefined;
      const loginToken = tokenAttrs?.LOGIN?.token;
      const pwChallenge = confirm.passwordChallenge as { trackId?: string; hint?: string } | undefined;

      if (loginToken) {
        const finalized = await this.finalizeAccountLogin({
          socket,
          tenantId: state.tenantId,
          name: state.name,
          deviceId: state.deviceId,
          loginToken,
          targetBotId: state.targetBotId,
        });
        state.botId = finalized.botId;
        state.user = finalized.user;
        state.status = "authorized";
        state.qrUrl = null;
        state.error = null;
        state.updatedAt = Date.now();
        return;
      }

      if (pwChallenge?.trackId) {
        state.passwordTrackId = pwChallenge.trackId;
        state.passwordHint = pwChallenge.hint ?? null;
        state.status = "waiting_password";
        state.qrUrl = null;
        state.error = null;
        state.updatedAt = Date.now();
        return;
      }

      throw new Error("MAX не вернул токен авторизации после подтверждения QR");
    } catch (err) {
      if (state.cancelled) return;
      state.status = "error";
      state.qrUrl = null;
      state.error = err instanceof Error ? err.message : "Ошибка авторизации MAX по QR";
      state.updatedAt = Date.now();
      state.socket?.close();
    }
  }

  getQrStatus(input: { tenantId: string; name: string; botId?: string }) {
    this.cleanupExpiredStates();
    const state = this.qrStates.get(this.qrKey(input.tenantId, input.name, input.botId));
    if (!state) {
      return { ok: true, status: "unknown" as const, qr: null, user: null };
    }
    state.updatedAt = Date.now();
    return {
      ok: true,
      status: state.status,
      botId: state.botId ?? state.targetBotId,
      qr: state.status === "qr_ready" ? state.qrUrl : null,
      qrExpiresAt: state.qrExpiresAt,
      error: state.error,
      passwordHint: state.passwordHint,
      user: state.user,
    };
  }

  async submitQrPassword(input: {
    tenantId: string;
    name: string;
    password: string;
    botId?: string;
  }): Promise<{ ok: boolean; status: string }> {
    const state = this.qrStates.get(this.qrKey(input.tenantId, input.name, input.botId));
    if (!state || !state.socket || !state.passwordTrackId) {
      throw new AppError(400, "MAX_NO_2FA_CHALLENGE", "Нет активного запроса пароля 2FA");
    }

    state.status = "processing_password";
    state.error = null;
    state.updatedAt = Date.now();

    try {
      const resp = await state.socket.rpc(MaxOpcode.AUTH_LOGIN_CHECK_PASSWORD, {
        trackId: state.passwordTrackId,
        password: input.password,
      });
      const tokenAttrs = resp.tokenAttrs as { LOGIN?: { token?: string } } | undefined;
      const loginToken = tokenAttrs?.LOGIN?.token;
      if (!loginToken) {
        const errMsg = typeof resp.error === "string" ? resp.error : "Неверный облачный пароль 2FA";
        state.status = "waiting_password";
        state.error = errMsg;
        throw new AppError(400, "MAX_PASSWORD_FAILED", errMsg);
      }

      const finalized = await this.finalizeAccountLogin({
        socket: state.socket,
        tenantId: state.tenantId,
        name: state.name,
        deviceId: state.deviceId,
        loginToken,
        targetBotId: state.targetBotId,
      });
      state.botId = finalized.botId;
      state.user = finalized.user;
      state.status = "authorized";
      state.error = null;
      state.updatedAt = Date.now();
      return { ok: true, status: "authorized" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неверный пароль 2FA";
      const low = msg.toLowerCase();
      if (low.includes("limit") || low.includes("flood") || low.includes("expired") || low.includes("track")) {
        state.status = "error";
        state.error = msg;
        state.socket.close();
      } else {
        state.status = "waiting_password";
        state.error = msg;
      }
      if (err instanceof AppError) throw err;
      throw new AppError(400, "MAX_PASSWORD_FAILED", msg);
    }
  }

  // -------------------------------------------------------------------------
  // Запасной вход по телефону + SMS/звонку (17 / 18 / 294) + 2FA (115)
  // -------------------------------------------------------------------------

  async startPhoneAuth(input: {
    tenantId: string;
    phone: string;
    name: string;
    botId?: string;
  }): Promise<{
    authSessionId: string;
    codeLength: number;
    requestMaxDuration: number;
    altActionDuration: number;
    hasCallTrack: boolean;
  }> {
    this.cleanupExpiredStates();
    const normalizedPhone = normalizeMaxPhone(input.phone, null);
    if (!normalizedPhone) {
      throw new AppError(400, "INVALID_PHONE", "Укажите корректный номер телефона в формате +7...");
    }

    const deviceId = await this.resolveDeviceId(input.tenantId, input.botId);
    const socket = await this.openInitializedSocket(deviceId);

    try {
      let res: Record<string, unknown>;
      try {
        res = await socket.rpc(MaxOpcode.AUTH_REQUEST, {
          phone: normalizedPhone,
          type: "START_AUTH",
          language: "ru",
        });
      } catch (err) {
        if (
          err instanceof AppError &&
          (err.code === "CAPTCHA_VALIDATION_FAILED" || /captcha/i.test(err.message))
        ) {
          throw new AppError(
            400,
            "MAX_CAPTCHA_REQUIRED",
            "MAX требует прохождения капчи VK (id.vk.ru), доступной только на официальном сайте web.max.ru. Используйте подключение по QR-коду.",
          );
        }
        throw err;
      }

      const authToken = String(res.token ?? "");
      if (!authToken) {
        throw new AppError(502, "MAX_AUTH_REQUEST_FAILED", "MAX не выдал токен подтверждения телефона");
      }

      const authSessionId = randomUUID();
      const callOutParams = res.callOutParams as { trackId?: string } | undefined;
      const trackId =
        typeof res.trackId === "string"
          ? res.trackId
          : typeof callOutParams?.trackId === "string"
            ? callOutParams.trackId
            : undefined;

      this.phoneStates.set(authSessionId, {
        authSessionId,
        tenantId: input.tenantId,
        name: input.name || "Основной",
        phone: normalizedPhone,
        targetBotId: input.botId,
        deviceId,
        authToken,
        trackId,
        status: "code_sent",
        socket,
        updatedAt: Date.now(),
      });

      return {
        authSessionId,
        codeLength: Number(res.codeLength ?? 6),
        requestMaxDuration: Number(res.requestMaxDuration ?? 60),
        altActionDuration: Number(res.altActionDuration ?? 30),
        hasCallTrack: Boolean(trackId),
      };
    } catch (err) {
      socket.close();
      throw err;
    }
  }

  async verifyPhoneCode(input: {
    tenantId: string;
    authSessionId: string;
    code: string;
  }): Promise<{
    status: "authorized" | "waiting_password";
    botId?: string;
    passwordHint?: string | null;
    user?: { id: string; username?: string; firstName?: string } | null;
  }> {
    const state = this.phoneStates.get(input.authSessionId);
    if (!state || state.tenantId !== input.tenantId) {
      throw new AppError(404, "MAX_AUTH_SESSION_NOT_FOUND", "Сессия авторизации не найдена — запросите код заново");
    }
    state.updatedAt = Date.now();

    const res = await state.socket.rpc(MaxOpcode.AUTH, {
      token: state.authToken,
      verifyCode: input.code.trim(),
      authTokenType: "CHECK_CODE",
    });

    const tokenAttrs = res.tokenAttrs as { LOGIN?: { token?: string } } | undefined;
    const loginToken = tokenAttrs?.LOGIN?.token;
    const pwChallenge = res.passwordChallenge as { trackId?: string; hint?: string } | undefined;

    if (loginToken) {
      const finalized = await this.finalizeAccountLogin({
        socket: state.socket,
        tenantId: state.tenantId,
        name: state.name,
        deviceId: state.deviceId,
        loginToken,
        targetBotId: state.targetBotId,
        phoneHint: state.phone,
      });
      state.status = "authorized";
      state.botId = finalized.botId;
      state.user = finalized.user;
      return {
        status: "authorized",
        botId: finalized.botId,
        user: finalized.user,
      };
    }

    if (pwChallenge?.trackId) {
      state.passwordTrackId = pwChallenge.trackId;
      state.passwordHint = pwChallenge.hint ?? null;
      state.status = "waiting_password";
      return {
        status: "waiting_password",
        passwordHint: state.passwordHint,
      };
    }

    throw new AppError(400, "MAX_CODE_INVALID", "Неверный код подтверждения или незавершённая регистрация");
  }

  async checkPhoneCallTrack(input: {
    tenantId: string;
    authSessionId: string;
  }): Promise<{
    status: "waiting_call" | "waiting_password" | "authorized";
    botId?: string;
    passwordHint?: string | null;
    user?: { id: string; username?: string; firstName?: string } | null;
  }> {
    const state = this.phoneStates.get(input.authSessionId);
    if (!state || state.tenantId !== input.tenantId) {
      throw new AppError(404, "MAX_AUTH_SESSION_NOT_FOUND", "Сессия авторизации не найдена");
    }
    state.updatedAt = Date.now();

    const trackId = state.trackId || state.authToken;
    const res = await state.socket.rpc(MaxOpcode.AUTH_PHONE_CALL_STATUS, { trackId });
    const tokenAttrs = res.tokenAttrs as { LOGIN?: { token?: string } } | undefined;
    const loginToken =
      tokenAttrs?.LOGIN?.token ?? (typeof res.loginToken === "string" ? res.loginToken : undefined);
    const pwChallenge = res.passwordChallenge as { trackId?: string; hint?: string } | undefined;

    if (loginToken) {
      const finalized = await this.finalizeAccountLogin({
        socket: state.socket,
        tenantId: state.tenantId,
        name: state.name,
        deviceId: state.deviceId,
        loginToken,
        targetBotId: state.targetBotId,
        phoneHint: state.phone,
      });
      state.status = "authorized";
      state.botId = finalized.botId;
      state.user = finalized.user;
      return {
        status: "authorized",
        botId: finalized.botId,
        user: finalized.user,
      };
    }

    if (pwChallenge?.trackId) {
      state.passwordTrackId = pwChallenge.trackId;
      state.passwordHint = pwChallenge.hint ?? null;
      state.status = "waiting_password";
      return {
        status: "waiting_password",
        passwordHint: state.passwordHint,
      };
    }

    return { status: "waiting_call" };
  }

  async submitPhonePassword(input: {
    tenantId: string;
    authSessionId: string;
    password: string;
  }): Promise<{
    status: "authorized";
    botId: string;
    user: { id: string; username?: string; firstName?: string };
  }> {
    const state = this.phoneStates.get(input.authSessionId);
    if (!state || state.tenantId !== input.tenantId || !state.passwordTrackId) {
      throw new AppError(400, "MAX_NO_2FA_CHALLENGE", "Нет активного запроса пароля 2FA");
    }
    state.updatedAt = Date.now();

    const resp = await state.socket.rpc(MaxOpcode.AUTH_LOGIN_CHECK_PASSWORD, {
      trackId: state.passwordTrackId,
      password: input.password,
    });
    const tokenAttrs = resp.tokenAttrs as { LOGIN?: { token?: string } } | undefined;
    const loginToken = tokenAttrs?.LOGIN?.token;
    if (!loginToken) {
      throw new AppError(400, "MAX_PASSWORD_FAILED", "Неверный облачный пароль 2FA");
    }

    const finalized = await this.finalizeAccountLogin({
      socket: state.socket,
      tenantId: state.tenantId,
      name: state.name,
      deviceId: state.deviceId,
      loginToken,
      targetBotId: state.targetBotId,
      phoneHint: state.phone,
    });
    state.status = "authorized";
    state.botId = finalized.botId;
    state.user = finalized.user;
    return {
      status: "authorized",
      botId: finalized.botId,
      user: finalized.user,
    };
  }
}

export const maxNativeAuthService = new MaxNativeAuthService();
