import { query, queryOne } from "../../db/client.js";
import { decryptSecret } from "../../services/credentials-cipher.js";

export interface YandexChatUploadPayload {
  tenantId: string;
  dealId?: string | null;
  contactId?: string | null;
  counterId: string;
  oauthToken: string;
  chatPlatform: "telegram" | "whatsapp" | "viber";
  chatUserId?: string | null;
  chatUsername?: string | null;
  phoneNumber?: string | null;
  clientId?: string | null;
  userId?: string | null;
  yclid?: string | null;
  chatAnswered?: number; // 0 или 1
  tag?: string | null;
  price?: number | null;
  currency?: string;
  sourceUrl?: string | null;
  trackerUrl?: string | null;
  initialDateTime?: number; // Unix timestamp в секундах
}

export interface YandexChatUploadResult {
  success: boolean;
  uploadId?: string;
  status: number;
  message?: string;
  initialDateTime: number;
}

export class YandexChatUploadService {
  /**
   * Загрузка или обновление чат-конверсии в Яндекс.Метрику (POST .../offline_conversions/upload?type=CHATS).
   * Если конверсия с таким (counterId, initialDateTime, chatPlatform, chatUserId) уже создавалась,
   * повторный вызов с тем же initialDateTime секунда-в-секунду обновляет запись в Метрике.
   */
  async uploadChat(payload: YandexChatUploadPayload): Promise<YandexChatUploadResult> {
    const rawToken = payload.oauthToken.trim();
    const token = rawToken.startsWith("v1:") ? decryptSecret(rawToken) : rawToken;

    if (!token || !payload.counterId) {
      return {
        success: false,
        status: 400,
        message: "Yandex counterId or oauthToken is missing",
        initialDateTime: payload.initialDateTime || Math.floor(Date.now() / 1000),
      };
    }

    const initialDateTime = payload.initialDateTime || Math.floor(Date.now() / 1000);
    const chatPlatform = payload.chatPlatform.toLowerCase() as "telegram" | "whatsapp" | "viber";
    const chatUserId = payload.chatUserId?.trim() || "";
    const chatUsername = (payload.chatUsername?.trim() || "").replace(/^@/, "");
    const phoneNumber = payload.phoneNumber?.trim() || "";
    const clientId = payload.clientId?.trim() || "";
    const yclid = payload.yclid?.trim() || "";
    const userId = payload.userId?.trim() || "";
    const chatAnswered = payload.chatAnswered !== undefined ? payload.chatAnswered : 0;
    const tag = (payload.tag?.trim() || "").slice(0, 100);
    const price = payload.price !== undefined && payload.price !== null ? Math.round(payload.price * 100) / 100 : "";
    const currency = payload.currency || "RUB";
    const sourceUrl = payload.sourceUrl?.trim() || "";
    const trackerUrl = payload.trackerUrl?.trim() || "";

    // Минимум один идентификатор собеседника обязателен
    if (!chatUsername && !chatUserId && !phoneNumber) {
      return {
        success: false,
        status: 400,
        message: "At least one of ChatUsername, ChatUserID, PhoneNumber must be provided",
        initialDateTime,
      };
    }

    // Сохраняем или обновляем запись в yandex_chat_conversions для дедупликации
    await query(
      `INSERT INTO yandex_chat_conversions (
         tenant_id, deal_id, contact_id, counter_id, chat_platform,
         chat_user_id, chat_username, phone_number, client_id, yclid,
         initial_datetime, chat_answered, price, currency, source_url,
         upload_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
       ON CONFLICT (tenant_id, counter_id, initial_datetime, chat_platform, chat_user_id)
       DO UPDATE SET
         chat_answered = EXCLUDED.chat_answered,
         price = CASE WHEN EXCLUDED.price > 0 THEN EXCLUDED.price ELSE yandex_chat_conversions.price END,
         updated_at = now()`,
      [
        payload.tenantId,
        payload.dealId || null,
        payload.contactId || null,
        payload.counterId,
        chatPlatform,
        chatUserId || null,
        chatUsername || null,
        phoneNumber || null,
        clientId || null,
        yclid || null,
        initialDateTime,
        chatAnswered,
        typeof price === "number" ? price : 0,
        currency,
        sourceUrl || null,
      ],
    );

    // Формируем CSV в строгом соответствии со спецификацией Яндекс.Метрики
    const csvHeaders = "DateTime,ChatPlatform,ChatUsername,ChatUserID,PhoneNumber,ClientID,UserId,Yclid,ChatAnswered,Tag,Price,Currency,URL,MessengerTrackerURL";
    const csvRow = [
      String(initialDateTime),
      chatPlatform,
      chatUsername,
      chatUserId,
      phoneNumber,
      clientId,
      userId,
      yclid,
      String(chatAnswered),
      tag,
      String(price),
      currency,
      sourceUrl,
      trackerUrl,
    ].map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",");

    const csvContent = `${csvHeaders}\n${csvRow}\n`;

    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chats.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from(csvContent, "utf-8"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const url = `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(payload.counterId)}/offline_conversions/upload?type=CHATS`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "User-Agent": "GetVoxly-Chats-Tracker/1.0",
        },
        body: multipartBody,
        signal: AbortSignal.timeout(8000),
      });

      const responseText = await res.text();
      let uploadId: string | undefined;

      try {
        const json = JSON.parse(responseText) as { uploading?: { id?: number } };
        if (json?.uploading?.id) {
          uploadId = String(json.uploading.id);
        }
      } catch {
        // Ответ может быть не JSON
      }

      const success = res.ok;

      await query(
        `UPDATE yandex_chat_conversions
         SET upload_status = $1, upload_id = $2, last_error = $3, updated_at = now()
         WHERE tenant_id = $4 AND counter_id = $5 AND initial_datetime = $6 AND chat_platform = $7 AND chat_user_id = $8`,
        [
          success ? "uploaded" : "error",
          uploadId || null,
          success ? null : responseText.slice(0, 500),
          payload.tenantId,
          payload.counterId,
          initialDateTime,
          chatPlatform,
          chatUserId,
        ],
      );

      return {
        success,
        status: res.status,
        uploadId,
        message: success ? "Успешно отправлено в Яндекс.Метрику" : responseText.slice(0, 200),
        initialDateTime,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE yandex_chat_conversions
         SET upload_status = 'error', last_error = $1, updated_at = now()
         WHERE tenant_id = $2 AND counter_id = $3 AND initial_datetime = $4 AND chat_platform = $5 AND chat_user_id = $6`,
        [errMsg.slice(0, 500), payload.tenantId, payload.counterId, initialDateTime, chatPlatform, chatUserId],
      );

      return {
        success: false,
        status: 500,
        message: errMsg,
        initialDateTime,
      };
    }
  }

  /**
   * Получение исходного timestamp старта чата для сделки/контакта (для обновления статуса или цены).
   */
  async getInitialChatDateTime(
    tenantId: string,
    counterId: string,
    chatPlatform: string,
    chatUserId: string,
  ): Promise<number | null> {
    const row = await queryOne<{ initial_datetime: string | number }>(
      `SELECT initial_datetime FROM yandex_chat_conversions
       WHERE tenant_id = $1 AND counter_id = $2 AND chat_platform = $3 AND chat_user_id = $4
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId, counterId, chatPlatform, chatUserId],
    );
    if (!row) return null;
    return typeof row.initial_datetime === "number" ? row.initial_datetime : parseInt(row.initial_datetime, 10);
  }
}

export const yandexChatUploadService = new YandexChatUploadService();
