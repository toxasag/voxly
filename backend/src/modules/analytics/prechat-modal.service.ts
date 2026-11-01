import { randomBytes } from "node:crypto";
import { query, queryOne } from "../../db/client.js";
import type {
  PreChatABMode,
  PreChatABStatsDTO,
  PreChatABVariant,
  PreChatLeadPayload,
  PreChatLeadResult,
  PreChatModalConfigDTO,
  PreChatTelemetryEventType,
} from "./analytics.types.js";

const SAFE_ALPHABET = "23456789abcdefghkmnpqrstuvwxyz";

export class PreChatModalService {
  /**
   * Генерация компактного, запоминающегося и однозначного кода лида.
   * Формат: vx-xxxx (например, vx-9821, vx-4k7b).
   * Исключены визуально схожие символы (0, O, 1, l, i).
   */
  generateLeadCode(): string {
    const bytes = randomBytes(4);
    let code = "vx-";
    for (let i = 0; i < 4; i++) {
      const idx = (bytes[i] ?? 0) % SAFE_ALPHABET.length;
      code += SAFE_ALPHABET[idx];
    }
    return code;
  }

  /**
   * Получение настроек двухшагового пре-чат модала для арендатора.
   */
  async getConfig(tenantId: string): Promise<PreChatModalConfigDTO> {
    const row = await queryOne<{
      id: string;
      is_enabled: boolean;
      ab_mode: PreChatABMode;
      greeting_template: string;
      whatsapp_enabled: boolean;
      telegram_enabled: boolean;
      whatsapp_number: string | null;
      telegram_username: string | null;
    }>(
      `SELECT id, is_enabled, ab_mode, greeting_template, whatsapp_enabled, telegram_enabled,
              whatsapp_number, telegram_username
       FROM prechat_modal_configs
       WHERE tenant_id = $1`,
      [tenantId],
    );

    if (row) {
      return {
        id: row.id,
        isEnabled: row.is_enabled,
        abMode: row.ab_mode,
        greetingTemplate: row.greeting_template,
        whatsappEnabled: row.whatsapp_enabled,
        telegramEnabled: row.telegram_enabled,
        whatsappNumber: row.whatsapp_number,
        telegramUsername: row.telegram_username,
      };
    }

    // Если запись ещё не создана, возвращаем значения по умолчанию и инспектируем каналы
    const channels = await query<{ channel: string; credentials: Record<string, unknown> }>(
      `SELECT channel, credentials FROM channel_accounts WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [tenantId],
    );

    let defaultTgUser: string | null = null;
    let defaultWaPhone: string | null = null;

    for (const ch of channels) {
      if (ch.channel === "telegram" && ch.credentials) {
        if (typeof ch.credentials.telegramBot === "string") {
          defaultTgUser = ch.credentials.telegramBot.replace(/^@/, "");
        } else if (typeof ch.credentials.username === "string") {
          defaultTgUser = ch.credentials.username.replace(/^@/, "");
        }
      } else if (ch.channel === "whatsapp" && ch.credentials) {
        if (typeof ch.credentials.whatsappNumber === "string") {
          defaultWaPhone = ch.credentials.whatsappNumber.replace(/\D/g, "");
        }
      }
    }

    return {
      isEnabled: true,
      abMode: "split_50_50",
      greetingTemplate: "Здравствуйте! Меня зовут {name}. (код: {code})",
      whatsappEnabled: true,
      telegramEnabled: true,
      whatsappNumber: defaultWaPhone,
      telegramUsername: defaultTgUser,
    };
  }

  /**
   * Сохранение настроек двухшагового пре-чат модала.
   */
  async updateConfig(
    tenantId: string,
    payload: Partial<PreChatModalConfigDTO>,
  ): Promise<PreChatModalConfigDTO> {
    const existing = await this.getConfig(tenantId);

    const isEnabled = payload.isEnabled !== undefined ? payload.isEnabled : existing.isEnabled;
    const abMode = payload.abMode ?? existing.abMode;
    const greetingTemplate = payload.greetingTemplate ?? existing.greetingTemplate;
    const whatsappEnabled =
      payload.whatsappEnabled !== undefined ? payload.whatsappEnabled : existing.whatsappEnabled;
    const telegramEnabled =
      payload.telegramEnabled !== undefined ? payload.telegramEnabled : existing.telegramEnabled;
    const whatsappNumber =
      payload.whatsappNumber !== undefined ? payload.whatsappNumber : existing.whatsappNumber;
    const telegramUsername =
      payload.telegramUsername !== undefined
        ? payload.telegramUsername?.replace(/^@/, "") || null
        : existing.telegramUsername;

    await query(
      `INSERT INTO prechat_modal_configs (
         tenant_id, is_enabled, ab_mode, greeting_template, whatsapp_enabled,
         telegram_enabled, whatsapp_number, telegram_username, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (tenant_id) DO UPDATE
       SET is_enabled = EXCLUDED.is_enabled,
           ab_mode = EXCLUDED.ab_mode,
           greeting_template = EXCLUDED.greeting_template,
           whatsapp_enabled = EXCLUDED.whatsapp_enabled,
           telegram_enabled = EXCLUDED.telegram_enabled,
           whatsapp_number = EXCLUDED.whatsapp_number,
           telegram_username = EXCLUDED.telegram_username,
           updated_at = now()`,
      [
        tenantId,
        isEnabled,
        abMode,
        greetingTemplate,
        whatsappEnabled,
        telegramEnabled,
        whatsappNumber,
        telegramUsername,
      ],
    );

    return this.getConfig(tenantId);
  }

  /**
   * Регистрация лида из пре-чат формы модала или прямого клика A/B теста.
   * Создает сессию в analytics_sessions с привязкой кода, ClientID и UTM-меток.
   */
  async registerPreChatLead(
    tenantId: string,
    payload: PreChatLeadPayload,
  ): Promise<PreChatLeadResult> {
    const config = await this.getConfig(tenantId);

    const leadCode = this.generateLeadCode();
    const rawToken = randomBytes(8).toString("hex");
    const sessionToken = payload.sessionId?.startsWith("ref_")
      ? payload.sessionId
      : `ref_${rawToken}`;

    const rawName = (payload.name || "").trim();
    const visitorName = rawName || "Посетитель";

    // Формируем текст первого сообщения по шаблону
    let template = config.greetingTemplate || "Здравствуйте! Меня зовут {name}. (код: {code})";
    let messageText = template.replace(/\{name\}/g, visitorName).replace(/\{code\}/g, leadCode);

    if (payload.customNote && payload.customNote.trim()) {
      messageText += ` Вопрос: ${payload.customNote.trim()}`;
    }

    // Разрешаем юзернейм Telegram или телефон WhatsApp
    let tgUsername = config.telegramUsername || "GetVoxlybot";
    let waPhone = config.whatsappNumber ? config.whatsappNumber.replace(/\D/g, "") : "79991234567";

    if (payload.channelAccountId) {
      const channel = await queryOne<{ credentials: Record<string, unknown> }>(
        `SELECT credentials FROM channel_accounts WHERE id = $1 AND tenant_id = $2`,
        [payload.channelAccountId, tenantId],
      );
      if (channel?.credentials) {
        if (typeof channel.credentials.telegramBot === "string") {
          tgUsername = channel.credentials.telegramBot.replace(/^@/, "");
        } else if (typeof channel.credentials.username === "string") {
          tgUsername = channel.credentials.username.replace(/^@/, "");
        }
        if (typeof channel.credentials.whatsappNumber === "string") {
          waPhone = channel.credentials.whatsappNumber.replace(/\D/g, "");
        }
      }
    }

    let deepLink = "";
    if (payload.messenger === "whatsapp") {
      deepLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(messageText)}`;
    } else if (payload.messenger === "telegram") {
      // Telegram Web и мобильные клиенты поддерживают ?text= для предварительного заполнения текста
      deepLink = `https://t.me/${tgUsername}?text=${encodeURIComponent(messageText)}`;
    } else if (payload.messenger === "vk") {
      deepLink = `https://vk.me/${tgUsername}?ref=${sessionToken}`;
    } else if (payload.messenger === "max") {
      deepLink = `https://max.ru/${tgUsername}?start=${sessionToken}`;
    } else {
      deepLink = `https://t.me/${tgUsername}?text=${encodeURIComponent(messageText)}`;
    }

    const utm = payload.utm || {};
    const abVariant: PreChatABVariant = payload.abVariant === "direct" ? "direct" : "modal";

    // Сохраняем сессию в analytics_sessions
    await query(
      `INSERT INTO analytics_sessions (
         tenant_id, session_token, prechat_lead_code, prechat_name, prechat_message,
         ab_variant, ga_client_id, ym_client_id, yandexuid, gclid, yclid, fbclid, vkclid,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         referrer, page_url, channel_account_id, messenger_type, status
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, 'clicked'
       )
       ON CONFLICT (tenant_id, session_token) DO UPDATE
       SET prechat_lead_code = EXCLUDED.prechat_lead_code,
           prechat_name = EXCLUDED.prechat_name,
           prechat_message = EXCLUDED.prechat_message,
           ab_variant = EXCLUDED.ab_variant,
           ga_client_id = COALESCE(EXCLUDED.ga_client_id, analytics_sessions.ga_client_id),
           ym_client_id = COALESCE(EXCLUDED.ym_client_id, analytics_sessions.ym_client_id),
           yandexuid = COALESCE(EXCLUDED.yandexuid, analytics_sessions.yandexuid),
           yclid = COALESCE(EXCLUDED.yclid, analytics_sessions.yclid),
           gclid = COALESCE(EXCLUDED.gclid, analytics_sessions.gclid),
           utm_source = COALESCE(EXCLUDED.utm_source, analytics_sessions.utm_source),
           utm_medium = COALESCE(EXCLUDED.utm_medium, analytics_sessions.utm_medium),
           utm_campaign = COALESCE(EXCLUDED.utm_campaign, analytics_sessions.utm_campaign)`,
      [
        tenantId,
        sessionToken,
        leadCode,
        rawName || null,
        messageText,
        abVariant,
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
        payload.messenger,
      ],
    );

    // Фиксируем телеметрию отправки формы или прямого клика
    const eventType: PreChatTelemetryEventType =
      abVariant === "direct" ? "direct_click" : "modal_submit";

    await this.logTelemetry(tenantId, {
      sessionId: sessionToken,
      eventType,
      abVariant,
      messengerType: payload.messenger,
      metadata: {
        leadCode,
        visitorName: rawName || undefined,
      },
    });

    return {
      leadCode,
      deepLink,
      messageText,
      sessionToken,
    };
  }

  /**
   * Логирование событий воронки A/B тестирования (показы, открытия, клики).
   */
  async logTelemetry(
    tenantId: string,
    params: {
      sessionId: string;
      eventType: PreChatTelemetryEventType;
      abVariant: PreChatABVariant;
      messengerType?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO prechat_telemetry_events (
           tenant_id, session_id, event_type, ab_variant, messenger_type, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          params.sessionId,
          params.eventType,
          params.abVariant,
          params.messengerType || null,
          JSON.stringify(params.metadata || {}),
        ],
      );
    } catch {
      // Игнорируем ошибки фоновой телеметрии, чтобы не блокировать UI клиента
    }
  }

  /**
   * Расчёт показателей эффективности A/B тестирования (Direct Click vs Pre-Chat Modal).
   */
  async getStats(tenantId: string): Promise<PreChatABStatsDTO> {
    // 1. Агрегация событий из prechat_telemetry_events
    const eventCounts = await query<{ event_type: string; ab_variant: string; count: string }>(
      `SELECT event_type, ab_variant, count(*)::text as count
       FROM prechat_telemetry_events
       WHERE tenant_id = $1
       GROUP BY event_type, ab_variant`,
      [tenantId],
    );

    let directImpressions = 0;
    let directClicks = 0;
    let directChats = 0;

    let modalImpressions = 0;
    let modalOpens = 0;
    let modalSubmits = 0;
    let modalChats = 0;

    for (const r of eventCounts) {
      const c = parseInt(r.count, 10) || 0;
      if (r.ab_variant === "direct") {
        if (r.event_type === "impression") directImpressions += c;
        else if (r.event_type === "direct_click") directClicks += c;
        else if (r.event_type === "chat_started") directChats += c;
      } else {
        if (r.event_type === "impression") modalImpressions += c;
        else if (r.event_type === "modal_open") modalOpens += c;
        else if (r.event_type === "modal_submit") modalSubmits += c;
        else if (r.event_type === "chat_started") modalChats += c;
      }
    }

    // 2. Также считаем конвертированные сессии из analytics_sessions для надёжности
    const sessionStats = await query<{
      ab_variant: string;
      is_converted: boolean;
      count: string;
    }>(
      `SELECT ab_variant, is_converted_to_chat as is_converted, count(*)::text as count
       FROM analytics_sessions
       WHERE tenant_id = $1 AND ab_variant IS NOT NULL
       GROUP BY ab_variant, is_converted_to_chat`,
      [tenantId],
    );

    for (const s of sessionStats) {
      const c = parseInt(s.count, 10) || 0;
      if (s.is_converted) {
        if (s.ab_variant === "direct") {
          directChats = Math.max(directChats, c);
        } else {
          modalChats = Math.max(modalChats, c);
        }
      }
    }

    // Расчёт конверсий (%)
    const directBase = directClicks > 0 ? directClicks : directImpressions;
    const directCr = directBase > 0 ? Number(((directChats / directBase) * 100).toFixed(1)) : 0;

    const modalBase = modalSubmits > 0 ? modalSubmits : modalImpressions;
    const modalCr = modalBase > 0 ? Number(((modalChats / modalBase) * 100).toFixed(1)) : 0;

    // Определение победителя и прироста конверсии
    let winnerVariant: "modal" | "direct" | "insufficient_data" = "insufficient_data";
    let conversionLift = 0;

    const totalImpressions = directImpressions + modalImpressions;
    const totalChats = directChats + modalChats;

    if (directBase >= 5 && modalBase >= 5) {
      if (modalCr > directCr) {
        winnerVariant = "modal";
        conversionLift = directCr > 0 ? Number((((modalCr - directCr) / directCr) * 100).toFixed(1)) : 100;
      } else if (directCr > modalCr) {
        winnerVariant = "direct";
        conversionLift = modalCr > 0 ? Number((((directCr - modalCr) / modalCr) * 100).toFixed(1)) : 100;
      }
    }

    return {
      direct: {
        impressions: directImpressions,
        clicks: directClicks,
        chatsStarted: directChats,
        conversionRate: directCr,
      },
      modal: {
        impressions: modalImpressions,
        modalOpens: modalOpens,
        submits: modalSubmits,
        chatsStarted: modalChats,
        conversionRate: modalCr,
      },
      summary: {
        totalImpressions,
        totalChats,
        winnerVariant,
        conversionLift,
      },
    };
  }
}

export const preChatModalService = new PreChatModalService();
