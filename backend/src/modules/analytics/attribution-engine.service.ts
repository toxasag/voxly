import { randomBytes } from "node:crypto";
import { query, queryOne } from "../../db/client.js";
import { conversionDispatcher } from "./conversion-dispatcher.service.js";
import { yandexChatUploadService } from "./yandex-chat-upload.service.js";
import type {
  CreateAnalyticsClickPayload,
  CreateAnalyticsClickResult,
  MessengerType,
} from "./analytics.types.js";

interface AnalyticsSessionRow {
  id: string;
  tenant_id: string;
  session_token: string;
  ga_client_id: string | null;
  ym_client_id: string | null;
  yandexuid: string | null;
  gclid: string | null;
  yclid: string | null;
  fbclid: string | null;
  vkclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  page_url: string | null;
  channel_account_id: string | null;
  messenger_type: MessengerType;
  messenger_user_id: string | null;
  messenger_username: string | null;
  messenger_chat_id: string | null;
  status: "clicked" | "opened" | "first_message_received" | "channel_subscribed";
  yandex_conversion_sent: boolean;
  ga4_conversion_sent: boolean;
  google_ads_conversion_sent: boolean;
  created_at: Date | string;
}

export class AttributionEngineService {
  /**
   * Регистрация клика по ссылке мессенджера на сайте клиента.
   * Генерирует компактный безопасный токен (16 hex-символов), сохраняет контекст сессии
   * и возвращает готовую ссылку с токеном.
   */
  async registerClick(
    tenantId: string,
    payload: CreateAnalyticsClickPayload,
  ): Promise<CreateAnalyticsClickResult> {
    const rawToken = randomBytes(8).toString("hex");
    const sessionToken = `ref_${rawToken}`;

    const messenger = payload.messenger;
    const utm = payload.utm || {};

    await query(
      `INSERT INTO analytics_sessions (
         tenant_id, session_token, ga_client_id, ym_client_id, yandexuid,
         gclid, yclid, fbclid, vkclid, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, referrer, page_url, channel_account_id,
         messenger_type, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'clicked')`,
      [
        tenantId,
        sessionToken,
        payload.gaClientId || null,
        payload.ymClientId || null,
        payload.yandexuid || null,
        payload.gclid || null,
        payload.yclid || null,
        payload.fbclid || null,
        payload.vkclid || null,
        utm.source || null,
        utm.medium || null,
        utm.campaign || null,
        utm.content || null,
        utm.term || null,
        payload.referrer || null,
        payload.pageUrl || null,
        payload.channelAccountId || null,
        messenger,
      ],
    );

    // Разрешаем имя бота или номер телефона для формирования deep link
    let deepLink = "";
    let botUsername = "GetVoxlybot";
    let waPhone = "79991234567";

    if (payload.channelAccountId) {
      const channelRow = await queryOne<{ credentials: Record<string, unknown> }>(
        `SELECT credentials FROM channel_accounts WHERE id = $1 AND tenant_id = $2`,
        [payload.channelAccountId, tenantId],
      );
      if (channelRow?.credentials) {
        if (typeof channelRow.credentials.telegramBot === "string") {
          botUsername = channelRow.credentials.telegramBot.replace(/^@/, "");
        }
        if (typeof channelRow.credentials.whatsappNumber === "string") {
          waPhone = channelRow.credentials.whatsappNumber.replace(/\D/g, "");
        }
      }
    }

    if (messenger === "telegram") {
      deepLink = `https://t.me/${botUsername}?start=${sessionToken}`;
    } else if (messenger === "whatsapp") {
      const text = encodeURIComponent(`Здравствуйте! [ID:${sessionToken}]`);
      deepLink = `https://wa.me/${waPhone}?text=${text}`;
    } else if (messenger === "vk") {
      deepLink = `https://vk.me/${botUsername}?ref=${sessionToken}`;
    } else if (messenger === "max") {
      deepLink = `https://max.ru/${botUsername}?start=${sessionToken}`;
    } else {
      deepLink = `https://t.me/${botUsername}?start=${sessionToken}`;
    }

    return {
      sessionToken,
      deepLink,
    };
  }

  /**
   * Связывание сессии при старте бота (/start ref_xxx).
   * ВНИМАНИЕ: Конверсия на этом шаге НЕ отправляется — это защита от слива бюджета.
   */
  async handleBotStart(
    sessionToken: string,
    messengerType: MessengerType,
    messengerUserId: string,
    username?: string | null,
    chatId?: string | null,
  ): Promise<AnalyticsSessionRow | null> {
    const session = await queryOne<AnalyticsSessionRow>(
      `UPDATE analytics_sessions
       SET status = 'opened',
           messenger_type = $2,
           messenger_user_id = $3,
           messenger_username = $4,
           messenger_chat_id = $5
       WHERE session_token = $1
       RETURNING *`,
      [sessionToken, messengerType, messengerUserId, username || null, chatId || null],
    );
    return session;
  }

  /**
   * Фиксация первого реального текстового сообщения от пользователя.
   * Переводит сессию в статус 'first_message_received' и отправляет серверные конверсии.
   */
  async handleIncomingMessage(
    messengerType: MessengerType,
    messengerUserId: string,
    text: string,
    extraMeta?: {
      username?: string | null;
      chatId?: string | null;
      tokenFromText?: string | null;
    },
  ): Promise<boolean> {
    // Извлекаем токен из текста, если это WhatsApp/VK
    let token = extraMeta?.tokenFromText;
    if (!token && text) {
      const match = text.match(/\[ID:(ref_[a-zA-Z0-9_-]+)\]/) || text.match(/(ref_[a-zA-Z0-9_-]+)/);
      if (match) {
        token = match[1];
      }
    }

    // Ищем подходящую сессию
    let session: AnalyticsSessionRow | null = null;
    if (token) {
      session = await queryOne<AnalyticsSessionRow>(
        `SELECT * FROM analytics_sessions WHERE session_token = $1`,
        [token],
      );
    }

    if (!session && messengerUserId) {
      session = await queryOne<AnalyticsSessionRow>(
        `SELECT * FROM analytics_sessions
         WHERE messenger_type = $1 AND messenger_user_id = $2 AND status IN ('opened', 'clicked')
         ORDER BY created_at DESC
         LIMIT 1`,
        [messengerType, messengerUserId],
      );
    }

    if (!session) {
      return false;
    }

    // Если конверсия уже была отправлена, пропускаем
    if (session.status === "first_message_received" || session.status === "channel_subscribed") {
      return true;
    }

    // Переводим сессию в first_message_received
    await query(
      `UPDATE analytics_sessions
       SET status = 'first_message_received',
           first_message_at = now(),
           messenger_user_id = COALESCE(messenger_user_id, $2),
           messenger_username = COALESCE(messenger_username, $3),
           messenger_chat_id = COALESCE(messenger_chat_id, $4)
       WHERE id = $1`,
      [session.id, messengerUserId, extraMeta?.username || null, extraMeta?.chatId || null],
    );

    // Ставим задачу отправки серверных конверсий
    await this.dispatchConversionForSession(session);
    return true;
  }

  /**
   * Отправка серверных конверсий в рекламные системы по сессии.
   */
  private async dispatchConversionForSession(session: AnalyticsSessionRow): Promise<void> {
    const tenantId = session.tenant_id;

    // 1. Яндекс.Метрика: ищем подходящий счётчик
    const yandexIntegrations = await query<{ id: string; counter_id: string; config: Record<string, unknown> }>(
      `SELECT id, counter_id, config FROM analytics_integrations
       WHERE tenant_id = $1 AND provider = 'yandex' AND is_active = true
       ORDER BY is_default DESC`,
      [tenantId],
    );

    if (yandexIntegrations.length > 0) {
      const yandex = yandexIntegrations[0];
      if (yandex) {
        const counterId = yandex.counter_id || String(yandex.config?.counterId || "");
        const token = String(yandex.config?.oauthToken || "");

        if (counterId && token) {
          const initialDateTime = Math.floor(Date.now() / 1000);
          await yandexChatUploadService.uploadChat({
            tenantId,
            counterId,
            oauthToken: token,
            chatPlatform: session.messenger_type === "whatsapp" ? "whatsapp" : "telegram",
            chatUserId: session.messenger_user_id,
            chatUsername: session.messenger_username,
            clientId: session.ym_client_id,
            yclid: session.yclid,
            chatAnswered: 0,
            tag: session.utm_campaign || "getvoxly_chat",
            sourceUrl: session.page_url,
            initialDateTime,
          });

          await query(
            `UPDATE analytics_sessions SET yandex_conversion_sent = true WHERE id = $1`,
            [session.id],
          );
        }
      }
    }

    // 2. Отправка в GA4 / Meta / VK через conversionDispatcher
    await conversionDispatcher.enqueueEvent({
      tenantId,
      dealTitle: `Чат из ${session.messenger_type}`,
      stageName: "Первое сообщение",
      budget: 0,
      currency: "RUB",
      clientId: session.ga_client_id,
      ymUid: session.ym_client_id,
      yandexuid: session.yandexuid,
      gaId: session.ga_client_id,
      fbId: session.fbclid,
      eventName: "chat_message_sent",
      sourceUrl: session.page_url,
    });
  }

  /**
   * Проверка подписки на целевой канал (Telegram Bot API getChatMember).
   */
  async checkChannelSubscription(
    botToken: string,
    channelId: string,
    userId: string | number,
  ): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: channelId, user_id: userId }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return false;
      const json = (await res.json()) as { ok?: boolean; result?: { status?: string } };
      if (!json.ok || !json.result?.status) return false;

      const validStatuses = ["creator", "administrator", "member"];
      return validStatuses.includes(json.result.status);
    } catch {
      return false;
    }
  }
}

export const attributionEngineService = new AttributionEngineService();
