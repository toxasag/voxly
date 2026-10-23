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
  qr?: string | null;
}

export class MaxBridgeService {
  private get baseUrl(): string {
    return getEnv().MAX_BRIDGE_URL.replace(/\/$/, "");
  }

  private get serviceToken(): string | undefined {
    return getEnv().VOXLY_SERVICE_TOKEN;
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
      });
      const json = (await res.json().catch(() => ({}))) as T;
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(
        503,
        "MAX_BRIDGE_UNAVAILABLE",
        `Сервис max-bridge недоступен (${message}). Убедитесь, что контейнер max-bridge запущен.`,
      );
    }
  }

  /** Старт генерации QR-кода авторизации MAX */
  async startQr(tenantId: string, name: string): Promise<MaxQrStartResponse> {
    const res = await this.bridgeFetch<{ detail?: string; ok: boolean; status: string; name: string; qr?: string | null }>(
      "/auth/qr/start",
      {
        method: "POST",
        body: JSON.stringify({ tenantId, name }),
      },
    );

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_START_FAILED", res.json?.detail || "Не удалось запустить авторизацию MAX");
    }

    return res.json;
  }

  /** Проверка статуса QR-авторизации MAX */
  async checkStatus(tenantId: string, name: string): Promise<MaxQrStatusResponse> {
    const res = await this.bridgeFetch<MaxQrStatusResponse & { detail?: string }>(
      `/auth/qr/status?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`,
      { method: "GET" },
    );

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_STATUS_FAILED", res.json?.detail || "Не удалось проверить статус MAX");
    }

    return res.json;
  }

  /** Ввод облачного пароля 2FA MAX */
  async submitPassword(tenantId: string, name: string, password: string): Promise<{ ok: boolean; status: string }> {
    const res = await this.bridgeFetch<{ detail?: string; ok: boolean; status: string }>("/auth/qr/password", {
      method: "POST",
      body: JSON.stringify({ tenantId, name, password }),
    });

    if (!res.ok) {
      throw new AppError(res.status, "MAX_PASSWORD_FAILED", res.json?.detail || "Неверный пароль 2FA");
    }

    return res.json;
  }

  /** Отправка сообщения клиенту через max-bridge */
  async sendMessage(input: {
    tenantId: string;
    name?: string;
    botId?: string;
    chatId: string;
    text: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const res = await this.bridgeFetch<{ ok: boolean; messageId?: string; detail?: string }>(
      "/messages/send",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );

    if (!res.ok) {
      return { ok: false, error: res.json?.detail || "Ошибка отправки сообщения в max-bridge" };
    }

    return { ok: true, messageId: res.json?.messageId };
  }

  /** Получение бинарного PNG буфера QR-кода напрямую из max-bridge */
  async getQrPng(tenantId: string, name: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/auth/qr/png?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`;
    const headers = new Headers();
    if (this.serviceToken) {
      headers.set("Authorization", `Bearer ${this.serviceToken}`);
    }
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}
