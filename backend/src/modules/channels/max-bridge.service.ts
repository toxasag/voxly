import { getEnv } from "../../config/env.js";
import { AppError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Интеграция личных аккаунтов MAX через сервис max-bridge (PyMax / maxapi-python).
// ---------------------------------------------------------------------------

export class MaxBridgeService {
  private get baseUrl(): string {
    return getEnv().MAX_BRIDGE_URL.replace(/\/$/, "");
  }

  private get serviceToken(): string | undefined {
    return getEnv().VOXLY_SERVICE_TOKEN;
  }

  private async bridgeFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; json: any }> {
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
      const json = await res.json().catch(() => ({}));
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
  async startQr(tenantId: string, name: string): Promise<any> {
    const res = await this.bridgeFetch("/auth/qr/start", {
      method: "POST",
      body: JSON.stringify({ tenantId, name }),
    });

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_START_FAILED", res.json?.detail || "Не удалось запустить авторизацию MAX");
    }

    return res.json;
  }

  /** Проверка статуса QR-авторизации MAX */
  async checkStatus(tenantId: string, name: string): Promise<any> {
    const res = await this.bridgeFetch(
      `/auth/qr/status?tenantId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`,
      { method: "GET" },
    );

    if (!res.ok) {
      throw new AppError(res.status, "MAX_QR_STATUS_FAILED", res.json?.detail || "Не удалось проверить статус MAX");
    }

    return res.json;
  }

  /** Ввод облачного пароля 2FA MAX */
  async submitPassword(tenantId: string, name: string, password: string): Promise<any> {
    const res = await this.bridgeFetch("/auth/qr/password", {
      method: "POST",
      body: JSON.stringify({ tenantId, name, password }),
    });

    if (!res.ok) {
      throw new AppError(res.status, "MAX_PASSWORD_FAILED", res.json?.detail || "Неверный пароль 2FA");
    }

    return res.json;
  }
}
