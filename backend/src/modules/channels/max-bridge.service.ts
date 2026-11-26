import { getEnv } from "../../config/env.js";
import { AppError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Интеграция личных аккаунтов MAX через сервис max-bridge (PyMax / maxapi-python).
// ---------------------------------------------------------------------------

export interface MaxQrStatusResponse {
  ok: boolean;
  status: "preparing" | "qr_ready" | "authorized" | "waiting_password" | "processing_password" | "error" | "unknown";
  botId?: string;
  qr?: string | null;
  qrExpiresAt?: number | null;
  error?: string | null;
  passwordHint?: string | null;
  user?: {
    id: string;
    username?: string;
    firstName?: string;
  } | null;
}

export interface MaxQrStartResponse {
  ok: boolean;
  status: string;
  name: string;
  botId?: string | null;
  qr?: string | null;
}

export interface MaxSessionBackup {
  token: string;
  deviceId?: string;
  phone?: string;
  mtInstanceId?: string;
  chatsSync?: number;
  contactsSync?: number;
  draftsSync?: number;
  presenceSync?: number;
  configHash?: string;
  userAgent?: Record<string, unknown> | null;
}

export interface MaxBridgeDialogMessage {
  id: string | number;
  out: boolean;
  text: string;
  date: number;
  attachments?: Array<{
    type: string;
    fileId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  }>;
}

export interface MaxBridgeDialog {
  chatId: string;
  userId?: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  names?: Array<{
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    type?: string | null;
  }> | null;
  phone?: string | null;
  link?: string | null;
  messages: MaxBridgeDialogMessage[];
}

export interface MaxPrivateDialogsResponse {
  ok: boolean;
  dialogs: MaxBridgeDialog[];
  selfPhone?: string;
  selfMaxUserId?: string;
  error?: string;
}

const LIVE_BOTS_CACHE_TTL_MS = 10_000;
let liveBotsCache: { ids: Set<string>; expiresAt: number } | null = null;

export function invalidateMaxBridgeLiveBotsCache(): void {
  liveBotsCache = null;
}

export function isMaxSessionExpiredError(status?: number, errorText?: string): boolean {
  if (status === 401 || status === 404) return true;
  if (!errorText) return false;
  return /session not connected|session not found|сессия max|qr-код|qr authentication|авторизац|не подключ/i.test(
    errorText,
  );
}

export class MaxBridgeService {
  private get baseUrl(): string {
    return getEnv().MAX_BRIDGE_URL.replace(/\/$/, "");
  }

  private get serviceToken(): string | undefined {
    return getEnv().VOXLY_SERVICE_TOKEN;
  }

  /**
   * Возвращает множество botId (UUID из channel_accounts), у которых прямо сейчас
   * есть активная авторизованная сессия в max-bridge. Возвращает null, если
   * max-bridge недоступен или его /health не отдаёт liveBotIds (безопасный фоллбэк).
   */
  async getLiveBotIds(): Promise<Set<string> | null> {
    const now = Date.now();
    if (liveBotsCache && liveBotsCache.expiresAt > now) {
      return liveBotsCache.ids;
    }

    try {
      const headers = new Headers();
      if (this.serviceToken) {
        headers.set("Authorization", `Bearer ${this.serviceToken}`);
      }
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { liveBotIds?: unknown } | null;
      if (!json || !Array.isArray(json.liveBotIds)) return null;

      const ids = new Set(json.liveBotIds.filter((v): v is string => typeof v === "string"));
      liveBotsCache = { ids, expiresAt: now + LIVE_BOTS_CACHE_TTL_MS };
      return ids;
    } catch {
      return null;
    }
  }

  private async bridgeFetch<T = Record<string, unknown>>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; json: T }> {
    const headers = new Headers(options.headers ?? {});
    if (this.serviceToken) {
      headers.set("Authorization", `Bearer ${this.serviceToken}`);
    }
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(30_000),
      });
      const json = (await res.json().catch(() => ({}))) as T;
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout =
        (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
        /timeout|aborted/i.test(message);

      if (isTimeout) {
        invalidateMaxBridgeLiveBotsCache();
        throw new AppError(
          504,
          "MAX_BRIDGE_TIMEOUT",
          "Превышено время ожидания ответа от MAX — сессия этого аккаунта не отвечает или истекла. Переподключите аккаунт по QR-коду в разделе «Интеграции → MAX» или выберите другой аккаунт.",
        );
      }

      throw new AppError(
        503,
        "MAX_BRIDGE_UNAVAILABLE",
        `Сервис max-bridge недоступен (${message}). Убедитесь, что контейнер max-bridge запущен.`,
      );
    }
  }

  /** Старт генерации QR-кода авторизации MAX */
  async startQr(tenantId: string, name: string, botId?: string): Promise<MaxQrStartResponse> {
    const res = await this.bridgeFetch<{
      detail?: string;
      ok: boolean;
      status: string;
      name: string;
      botId?: string | null;
      qr?: string | null;
    }>("/auth/qr/start", {
      method: "POST",
      body: JSON.stringify({ tenantId, name, ...(botId ? { botId } : {}) }),
    });

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_START_FAILED", res.json?.detail || "Не удалось запустить авторизацию MAX");
    }

    return res.json;
  }

  /** Проверка статуса QR-авторизации MAX */
  async checkStatus(tenantId: string, name: string, botId?: string): Promise<MaxQrStatusResponse> {
    const botParam = botId ? `&botId=${encodeURIComponent(botId)}` : "";
    const res = await this.bridgeFetch<MaxQrStatusResponse & { detail?: string }>(
      `/auth/qr/status?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}${botParam}`,
      { method: "GET" },
    );

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_STATUS_FAILED", res.json?.detail || "Не удалось проверить статус MAX");
    }

    return res.json;
  }

  /** Ввод облачного пароля 2FA MAX */
  async submitPassword(
    tenantId: string,
    name: string,
    password: string,
    botId?: string,
  ): Promise<{ ok: boolean; status: string }> {
    const res = await this.bridgeFetch<{ detail?: string; ok: boolean; status: string }>("/auth/qr/password", {
      method: "POST",
      body: JSON.stringify({ tenantId, name, password, ...(botId ? { botId } : {}) }),
    });

    if (!res.ok) {
      throw new AppError(res.status, "MAX_PASSWORD_FAILED", res.json?.detail || "Неверный пароль 2FA");
    }

    return res.json;
  }

  /** Проверка живости сессии MAX с опциональным восстановлением из зашифрованного бэкапа */
  async checkSession(
    botId: string,
    sessionBackup?: MaxSessionBackup | null,
  ): Promise<{
    ok: boolean;
    alive: boolean;
    reason?: string;
    maxUserId?: string | null;
    username?: string | null;
    firstName?: string | null;
    sessionBackup?: MaxSessionBackup | null;
  }> {
    const res = await this.bridgeFetch<{
      ok: boolean;
      alive: boolean;
      reason?: string;
      maxUserId?: string | null;
      username?: string | null;
      firstName?: string | null;
      sessionBackup?: MaxSessionBackup | null;
    }>("/sessions/check", {
      method: "POST",
      body: JSON.stringify({ botId, ...(sessionBackup ? { sessionBackup } : {}) }),
    });
    if (!res.ok) {
      return { ok: false, alive: false, reason: "Сервис max-bridge не подтвердил статус сессии" };
    }
    return res.json;
  }

  /** Восстановление сессии MAX в max-bridge */
  async connectSession(botId: string, sessionBackup?: MaxSessionBackup | null): Promise<boolean> {
    const res = await this.bridgeFetch<{ ok: boolean }>("/sessions/connect", {
      method: "POST",
      body: JSON.stringify({ botId, ...(sessionBackup ? { sessionBackup } : {}) }),
    });
    return Boolean(res.ok && res.json?.ok);
  }

  /** Остановка runtime-клиента без удаления файла сессии */
  async disconnectSession(botId: string): Promise<void> {
    await this.bridgeFetch("/sessions/disconnect", {
      method: "POST",
      body: JSON.stringify({ botId }),
    }).catch(() => {});
  }

  /** Полная очистка сессии MAX при удалении аккаунта */
  async deleteAccount(tenantId: string, botId: string, notifyBackend = false): Promise<void> {
    await this.bridgeFetch("/accounts/delete", {
      method: "POST",
      body: JSON.stringify({ tenantId, botId, notifyBackend }),
    }).catch(() => {});
  }

  /** Отправка сообщения клиенту через max-bridge */
  async sendMessage(input: {
    tenantId: string;
    name?: string;
    botId?: string;
    chatId?: string;
    recipient?: string;
    text: string;
    mediaBase64?: string;
    fileName?: string;
    mimeType?: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string; status?: number; sessionExpired?: boolean }> {
    const target = (input.recipient || input.chatId || "").trim();
    let peerUserId = "";
    let resolvePhone: string | undefined;

    const maxUrlMatch = target.match(/id=(\d+)/);
    if (maxUrlMatch && maxUrlMatch[1]) {
      peerUserId = maxUrlMatch[1];
    } else if (target.startsWith("+") || /^[78]\d{10}$/.test(target.replace(/\D/g, ""))) {
      resolvePhone = target.startsWith("+") ? target : `+${target.replace(/\D/g, "")}`;
    } else if (/^\d+$/.test(target)) {
      peerUserId = target;
    } else {
      resolvePhone = target;
    }

    const payload: Record<string, unknown> = {
      botId: input.botId,
      text: input.text,
    };
    if (peerUserId) {
      payload.peerUserId = peerUserId;
    }
    if (resolvePhone) {
      payload.resolvePhone = resolvePhone;
    }
    if (input.mediaBase64) {
      payload.mediaBase64 = input.mediaBase64;
    }
    if (input.fileName) {
      payload.fileName = input.fileName;
    }
    if (input.mimeType) {
      payload.mimeType = input.mimeType;
    }

    const res = await this.bridgeFetch<{ ok?: boolean; messageId?: string; detail?: string; error?: string }>(
      "/messages/send",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errorMsg = res.json?.error || res.json?.detail || "Ошибка отправки сообщения в max-bridge";
      const sessionExpired = isMaxSessionExpiredError(res.status, errorMsg);
      if (sessionExpired) {
        invalidateMaxBridgeLiveBotsCache();
      }
      return { ok: false, error: errorMsg, status: res.status, sessionExpired };
    }

    return { ok: true, messageId: res.json?.messageId };
  }

  /** Получение истории приватных диалогов и сообщений из max-bridge */
  async getPrivateDialogs(input: {
    botId: string;
    dialogLimit?: number;
    messageLimit?: number;
  }): Promise<MaxPrivateDialogsResponse> {
    const res = await this.bridgeFetch<MaxPrivateDialogsResponse>("/crm/private-dialogs", {
      method: "POST",
      body: JSON.stringify({
        botId: input.botId,
        dialogLimit: input.dialogLimit ?? 20,
        messageLimit: input.messageLimit ?? 50,
      }),
    });

    if (!res.ok || !res.json) {
      return { ok: false, dialogs: [], error: res.json?.error || "Не удалось загрузить диалоги из max-bridge" };
    }

    return res.json;
  }

  /** Получение бинарного PNG буфера QR-кода напрямую из max-bridge */
  async getQrPng(tenantId: string, name: string, botId?: string): Promise<Buffer | null> {
    const botParam = botId ? `&botId=${encodeURIComponent(botId)}` : "";
    const url = `${this.baseUrl}/auth/qr/png?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}${botParam}`;
    const headers = new Headers();
    if (this.serviceToken) {
      headers.set("Authorization", `Bearer ${this.serviceToken}`);
    }
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Скачивание вложения из max-bridge в виде буфера */
  async downloadMedia(input: {
    botId: string;
    fileId: string;
  }): Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; error?: string }> {
    const res = await this.bridgeFetch<{
      ok: boolean;
      dataBase64?: string;
      mimeType?: string;
      detail?: string;
    }>("/messages/media", {
      method: "POST",
      body: JSON.stringify({
        botId: input.botId,
        fileId: input.fileId,
      }),
    });

    if (!res.ok || !res.json?.dataBase64) {
      return { ok: false, error: res.json?.detail || "Ошибка скачивания медиа из max-bridge" };
    }

    const buffer = Buffer.from(res.json.dataBase64, "base64");
    return {
      ok: true,
      buffer,
      mimeType: res.json.mimeType || "application/octet-stream",
    };
  }
}
