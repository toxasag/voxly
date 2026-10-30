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

    // 1. Создаем инстанс с автоматической регистрацией webhook
    const publicApiUrl = getEnv().PUBLIC_API_URL;
    const webhookUrl = publicApiUrl
      ? `${publicApiUrl.replace(/\/+$/, "")}/api/internal/whatsapp/webhook`
      : "http://backend:4000/api/internal/whatsapp/webhook";

    const create = await this.evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: {
            "x-evolution-webhook-secret": getEnv().EVOLUTION_WEBHOOK_SECRET,
          },
          byEvents: false,
          base64: false,
          events: [
            "QRCODE_UPDATED",
            "CONNECTION_UPDATE",
            "MESSAGES_UPSERT",
          ],
        },
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
      const inst = instances.find((i: Record<string, unknown>) => i?.name === instanceName || i?.instanceName === instanceName) || instances[0];

      let phone = (typeof inst?.ownerJid === "string" ? inst.ownerJid : "") ||
                  (typeof inst?.owner === "string" ? inst.owner : "") ||
                  (typeof inst?.wuid === "string" ? inst.wuid : "") ||
                  (typeof inst?.number === "string" ? inst.number : "");
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
                 credentials = jsonb_set(
                   jsonb_set(COALESCE(credentials, '{}'::jsonb), '{instanceName}', to_jsonb($5::text)),
                   '{phone}', to_jsonb($4::text)
                 ),
                 connected_at = COALESCE(connected_at, now())
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, existing.id, label, phone, instanceName],
          );
          return existing.id;
        }

        const inserted = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, status_message, credentials, connected_at)
           VALUES ($1, 'whatsapp', $2, $3, 'connected', '', jsonb_build_object('instanceName', $4::text, 'phone', $3::text), now())
           RETURNING id`,
          [tenantId, label, phone, instanceName],
        );
        return inserted.id;
      });

      // Гарантируем регистрацию webhook для получения входящих сообщений
      const publicUrl = getEnv().PUBLIC_API_URL;
      const webhookUrl = publicUrl
        ? `${publicUrl.replace(/\/+$/, "")}/api/internal/whatsapp/webhook`
        : "http://backend:4000/api/internal/whatsapp/webhook";
      void this.setWebhook(instanceName, webhookUrl).catch(() => undefined);

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

  /** Отправка медиасообщения (документ, фото, видео, голосовое, аудио) через Evolution API */
  async sendMediaMessage(
    instanceName: string,
    recipient: string,
    input: {
      buffer: Buffer;
      filename: string;
      mimeType: string;
      caption?: string;
    },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const cleanNumber = recipient.replace(/[^\d]/g, "");
    if (!cleanNumber) {
      return { ok: false, error: "Некорректный номер получателя WhatsApp" };
    }

    const { buffer, filename, mimeType, caption } = input;
    const base64 = buffer.toString("base64");

    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    const isAudio = mimeType.startsWith("audio/");
    const isVoice = isAudio && (mimeType.includes("ogg") || mimeType.includes("opus"));

    if (isVoice) {
      const res = await this.evoFetch(`/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: JSON.stringify({
          number: cleanNumber,
          audio: base64,
        }),
      });
      if (res.ok) {
        return { ok: true, messageId: res.json?.key?.id };
      }
    }

    let mediatype: "image" | "document" | "video" | "audio" = "document";
    if (isImage) mediatype = "image";
    else if (isVideo) mediatype = "video";
    else if (isAudio) mediatype = "audio";

    const payload: Record<string, unknown> = {
      number: cleanNumber,
      mediatype,
      mimetype: mimeType,
      caption: caption || undefined,
      media: base64,
      fileName: filename,
    };

    const res = await this.evoFetch(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errMsg =
        res.json?.response?.message ||
        res.json?.message ||
        res.json?.error ||
        "Ошибка отправки медиа в WhatsApp";
      return { ok: false, error: errMsg };
    }

    return { ok: true, messageId: res.json?.key?.id };
  }

  /** Проверка регистрации номеров в WhatsApp через Evolution API */
  async checkNumberStatus(
    instanceName: string,
    numbers: string[],
  ): Promise<Array<{ exists: boolean; jid?: string; number?: string }>> {
    const res = await this.evoFetch(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ numbers }),
    });
    if (!res.ok) return [];
    const rows = Array.isArray(res.json) ? res.json : [];
    return rows.map((r: any) => ({
      exists: Boolean(r?.exists),
      jid: r?.jid,
      number: r?.number,
    }));
  }

  /** Настройка webhook в Evolution API */
  async setWebhook(instanceName: string, webhookUrl: string): Promise<boolean> {
    const secret = getEnv().EVOLUTION_WEBHOOK_SECRET;
    if (!secret) return false;
    const res = await this.evoFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: {
            "x-evolution-webhook-secret": secret,
          },
          byEvents: false,
          base64: false,
          events: [
            "QRCODE_UPDATED",
            "CONNECTION_UPDATE",
            "MESSAGES_UPSERT",
          ],
        },
      }),
    });
    return res.ok;
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

  /**
   * Скачивает медиа-вложение сообщения через Evolution API в base64
   */
  async downloadMedia(
    instanceName: string,
    messageItem: Record<string, any>,
  ): Promise<{ base64: string; mimetype?: string; fileName?: string } | null> {
    try {
      const messageId = messageItem?.key?.id;

      // Вариант 1: передаём messageItem целиком
      let res = await this.evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: JSON.stringify({
          message: messageItem,
          convertToMp4: false,
        }),
      });

      // Вариант 2: если ошибка или нет base64, пробуем передать { key: { id } }
      if ((!res.ok || !res.json?.base64) && messageId) {
        res = await this.evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          body: JSON.stringify({
            message: { key: { id: messageId } },
            convertToMp4: false,
          }),
        });
      }

      if (!res.ok || !res.json) {
        return null;
      }

      const base64 = res.json.base64 || res.json.data?.base64;
      if (!base64 || typeof base64 !== "string") {
        return null;
      }

      return {
        base64,
        mimetype: res.json.mimetype || res.json.data?.mimetype,
        fileName: res.json.fileName || res.json.data?.fileName,
      };
    } catch {
      return null;
    }
  }
}
