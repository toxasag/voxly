import { getEnv } from "../../config/env.js";
import { withTenant } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Интеграция WhatsApp через Evolution API (Baileys WhatsApp Web).
//
// Создает инстанс WhatsApp Web, получает base64 QR-код, опрашивает статус
// авторизации и при успешном сканировании сохраняет аккаунт в channel_accounts.
// ---------------------------------------------------------------------------

export class WhatsappEvolutionService {
  private get baseUrl(): string {
    return getEnv().EVOLUTION_API_URL.replace(/\/$/, "");
  }

  private get apiKey(): string | undefined {
    return getEnv().EVOLUTION_API_KEY;
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  private async evoFetch(path: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; json: any }> {
    const headers = new Headers(options.headers ?? {});
    if (this.apiKey) {
      headers.set("apikey", this.apiKey);
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
        "EVOLUTION_API_UNAVAILABLE",
        `Evolution API недоступен (${message}). Убедитесь, что контейнер evolution-api запущен.`,
      );
    }
  }

  private pickQr(data: any): string | null {
    const b64 =
      data?.qrcode?.base64 ||
      data?.base64 ||
      data?.qr?.base64 ||
      data?.instance?.qrcode?.base64 ||
      null;
    if (!b64 || typeof b64 !== "string") return null;
    return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  }

  /** Создание новой сессии подключения и получение QR-кода */
  async startQr(tenantId: string, label: string): Promise<{
    ok: boolean;
    instanceName: string;
    qr: string | null;
    status: "qr_ready" | "preparing" | "connected";
  }> {
    const cleanLabel = label.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "main";
    const instanceName = `wa_${tenantId.replace(/-/g, "").slice(0, 8)}_${cleanLabel}_${Date.now().toString(36)}`;

    // Чистим старые незавершенные инстансы этого тенанта, чтобы не плодить зомби
    try {
      const prefix = `wa_${tenantId.replace(/-/g, "").slice(0, 8)}_`;
      const allRes = await this.evoFetch("/instance/fetchInstances");
      const list = Array.isArray(allRes.json) ? allRes.json : [];
      for (const item of list) {
        const name = item?.name || item?.instanceName;
        const state = String(item?.connectionStatus || item?.state || "").toLowerCase();
        if (typeof name === "string" && name.startsWith(prefix) && state !== "open") {
          await this.deleteInstance(name);
        }
      }
    } catch {
      // Игнорируем ошибки очистки
    }

    // 1. Создаем инстанс
    const create = await this.evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });

    let qr = this.pickQr(create.json);

    // 2. Если инстанс уже создан или QR не пришел в ответе create — запрашиваем connect
    if (!qr) {
      const connect = await this.evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: "GET",
      });
      qr = this.pickQr(connect.json);
    }

    // 3. Проверяем текущее состояние
    const stateRes = await this.evoFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const state = String(stateRes.json?.instance?.state || stateRes.json?.state || "close").toLowerCase();

    return {
      ok: true,
      instanceName,
      qr,
      status: state === "open" ? "connected" : qr ? "qr_ready" : "preparing",
    };
  }

  /** Проверка статуса авторизации инстанса */
  async checkStatus(
    tenantId: string,
    instanceName: string,
    label: string,
    refreshQr?: boolean,
  ): Promise<{
    ok: boolean;
    status: "connected" | "qr_ready" | "preparing";
    qr?: string | null;
    phone?: string;
    accountId?: string;
  }> {
    const stateRes = await this.evoFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const state = String(stateRes.json?.instance?.state || stateRes.json?.state || "close").toLowerCase();

    if (state === "open") {
      // Инстанс успешно подключен! Получаем информацию о номере
      const infoRes = await this.evoFetch(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`);
      const instances = Array.isArray(infoRes.json) ? infoRes.json : [infoRes.json];
      const inst = instances.find((i: any) => i?.name === instanceName || i?.instanceName === instanceName) || instances[0];

      let phone = inst?.owner || inst?.wuid || inst?.number || "";
      if (phone.includes("@")) {
        phone = phone.split("@")[0];
      }
      if (phone && !phone.startsWith("+")) {
        phone = `+${phone}`;
      }
      if (!phone) {
        phone = `WA-${instanceName.slice(-6)}`;
      }

      // Сохраняем или обновляем аккаунт в channel_accounts
      const accountId = await withTenant(tenantId, async (tx) => {
        const existing = await tx.queryOne<{ id: string }>(
          `SELECT id FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'whatsapp' AND deleted_at IS NULL
             AND (external_id = $2 OR credentials->>'instanceName' = $3)
           LIMIT 1`,
          [tenantId, phone, instanceName],
        );

        if (existing) {
          await tx.query(
            `UPDATE channel_accounts
             SET status = 'connected', status_message = '', label = $3, external_id = $4,
                 credentials = jsonb_set(COALESCE(credentials, '{}'::jsonb), '{instanceName}', to_jsonb($5::text)),
                 connected_at = COALESCE(connected_at, now())
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, existing.id, label, phone, instanceName],
          );
          return existing.id;
        }

        const inserted = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, status_message, credentials, connected_at)
           VALUES ($1, 'whatsapp', $2, $3, 'connected', '', jsonb_build_object('instanceName', $4::text), now())
           RETURNING id`,
          [tenantId, label, phone, instanceName],
        );
        return inserted.id;
      });

      return {
        ok: true,
        status: "connected",
        phone,
        accountId,
      };
    }

    // Не вызываем /instance/connect при обычном поллинге статуса:
    // это сбрасывает Baileys-сокет и аннулирует QR-код каждые 2.5 секунды.
    // Вызываем только при явном флаге refreshQr.
    let qr: string | null = null;
    if (refreshQr) {
      const connect = await this.evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: "GET",
      });
      qr = this.pickQr(connect.json);
    }

    return {
      ok: true,
      status: "qr_ready",
      qr,
    };
  }

  /** Отправка текстового сообщения через Evolution API */
  async sendTextMessage(
    instanceName: string,
    recipient: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const cleanNumber = recipient.replace(/[^\d]/g, "");
    const res = await this.evoFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: cleanNumber,
        text,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: res.json?.response?.message || "Ошибка отправки WhatsApp" };
    }

    return { ok: true, messageId: res.json?.key?.id };
  }

  /** Удаление инстанса из Evolution API */
  async deleteInstance(instanceName: string): Promise<void> {
    try {
      await this.evoFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
        method: "DELETE",
      });
    } catch {
      // Игнорируем ошибку при удалении
    }
  }
}
