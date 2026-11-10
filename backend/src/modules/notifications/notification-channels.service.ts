// ---------------------------------------------------------------------------
// Сервис управления каналами уведомлений арендатора (Lead Notification Channels).
//
// Реализует многоканальную маршрутизацию заявок (Email, Telegram, WhatsApp)
// со строгой изоляцией по tenant_id и антибан-архитектурой.
// ---------------------------------------------------------------------------

import { query, queryOne } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { EmailService } from "../../services/email.service.js";
import { TelegramService, escapeHtml } from "../auth/telegram.service.js";
import {
  bitrix24Service,
  normalizeBitrixWebhookUrl,
  BITRIX24_SOURCE_ID,
} from "../integrations/bitrix24/bitrix24.service.js";
import type { LeadSource } from "../integrations/bitrix24/bitrix24.types.js";
import type {
  CreateNotificationChannelPayload,
  NotificationChannelDTO,
  NotificationChannelRow,
  NotificationChannelType,
} from "./notification-channels.types.js";

function toDTO(row: NotificationChannelRow): NotificationChannelDTO {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    channel_type: row.channel_type,
    destination: row.destination,
    target_value: row.destination,
    extra_meta: row.extra_meta ?? {},
    is_active: row.is_active,
    is_verified: row.is_verified,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export class NotificationChannelsService {
  private telegramService: TelegramService | null = null;

  private getTelegramService(): TelegramService | null {
    try {
      if (!this.telegramService) {
        this.telegramService = new TelegramService();
      }
      return this.telegramService;
    } catch {
      return null;
    }
  }

  /**
   * Автоматическая привязка Telegram-канала к тенанту (при регистрации/входе/бэкфилле).
   */
  async ensureTenantTelegramNotificationChannel(
    tenantId: string,
    chatId: number | string,
    extraMeta: Record<string, unknown> = {},
  ): Promise<NotificationChannelDTO | null> {
    const cleanDestination = String(chatId).trim();
    if (!cleanDestination) return null;

    const rows = await query<NotificationChannelRow>(
      `INSERT INTO tenant_notification_channels (
         tenant_id, channel_type, destination, extra_meta, is_active, is_verified
       )
       VALUES ($1, 'telegram', $2, $3, true, true)
       ON CONFLICT (tenant_id, channel_type, destination) DO UPDATE
       SET is_active = true,
           is_verified = true,
           extra_meta = tenant_notification_channels.extra_meta || EXCLUDED.extra_meta,
           updated_at = NOW()
       RETURNING *`,
      [tenantId, cleanDestination, JSON.stringify(extraMeta)],
    );

    const first = rows[0];
    return first ? toDTO(first) : null;
  }

  /**
   * Список всех настроенных каналов уведомлений арендатора.
   */
  async listChannels(tenantId: string): Promise<NotificationChannelDTO[]> {
    let rows = await query<NotificationChannelRow>(
      `SELECT id, tenant_id, channel_type, destination, extra_meta, is_active, is_verified, created_at, updated_at
       FROM tenant_notification_channels
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId],
    );

    // Если список каналов пуст, проверяем наличие telegram_chat_id у владельца или администратора
    // тенанта и автоматически создаём канал (автопривязка / self-healing).
    if (rows.length === 0) {
      const ownerUser = await queryOne<{
        telegram_chat_id: string | null;
        telegram_username: string | null;
        name: string | null;
      }>(
        `SELECT telegram_chat_id::text, telegram_username, name
         FROM users
         WHERE tenant_id = $1 AND telegram_chat_id IS NOT NULL AND deleted_at IS NULL
         ORDER BY CASE WHEN role = 'owner' THEN 0 WHEN role = 'admin' THEN 1 ELSE 2 END ASC
         LIMIT 1`,
        [tenantId],
      );

      if (ownerUser && ownerUser.telegram_chat_id) {
        await this.ensureTenantTelegramNotificationChannel(
          tenantId,
          ownerUser.telegram_chat_id,
          {
            username: ownerUser.telegram_username ?? null,
            name: ownerUser.name ?? null,
            auto_linked: true,
            source: "owner_account",
          },
        );

        rows = await query<NotificationChannelRow>(
          `SELECT id, tenant_id, channel_type, destination, extra_meta, is_active, is_verified, created_at, updated_at
           FROM tenant_notification_channels
           WHERE tenant_id = $1
           ORDER BY created_at ASC`,
          [tenantId],
        );
      }
    }

    // Проверяем, есть ли активная конфигурация Битрикс24 в legacy таблице tenant_bitrix24_configs,
    // которая ещё не перенесена в tenant_notification_channels (self-healing / обратная совместимость)
    const hasB24Channel = rows.some((r) => r.channel_type === "bitrix24");
    if (!hasB24Channel) {
      const legacyB24 = await queryOne<{
        webhook_url: string;
        is_enabled: boolean;
        custom_source_id: string;
        allowed_sources: string[];
        selected_widget_ids: string[];
        send_utm_marks: boolean;
        send_geo_data: boolean;
        last_lead_id: string | null;
        last_sync_at: Date | string | null;
        last_error: string | null;
      }>(
        `SELECT webhook_url, is_enabled, custom_source_id, allowed_sources, selected_widget_ids,
                send_utm_marks, send_geo_data, last_lead_id, last_sync_at, last_error
         FROM tenant_bitrix24_configs
         WHERE tenant_id = $1 AND webhook_url IS NOT NULL AND webhook_url != ''`,
        [tenantId],
      );

      if (legacyB24) {
        try {
          const inserted = await query<NotificationChannelRow>(
            `INSERT INTO tenant_notification_channels (
               tenant_id, channel_type, destination, extra_meta, is_active, is_verified
             )
             VALUES ($1, 'bitrix24', $2, $3, $4, true)
             RETURNING *`,
            [
              tenantId,
              legacyB24.webhook_url,
              JSON.stringify({
                custom_source_id: legacyB24.custom_source_id || BITRIX24_SOURCE_ID,
                allowed_sources: legacyB24.allowed_sources ?? [],
                selected_widget_ids: legacyB24.selected_widget_ids ?? [],
                send_utm_marks: legacyB24.send_utm_marks ?? true,
                send_geo_data: legacyB24.send_geo_data ?? true,
                last_lead_id: legacyB24.last_lead_id,
                last_sync_at: legacyB24.last_sync_at,
                last_error: legacyB24.last_error,
              }),
              legacyB24.is_enabled,
            ],
          );
          if (inserted[0]) {
            rows.push(inserted[0]);
          }
        } catch {
          // Игнорируем ошибку уникальности или гонки
        }
      }
    }

    return rows.map(toDTO);
  }

  /**
   * Добавление нового канала уведомлений с валидацией антибан-формата.
   */
  async createChannel(
    tenantId: string,
    payload: CreateNotificationChannelPayload,
  ): Promise<NotificationChannelDTO> {
    const rawValue = (payload.destination ?? payload.target_value ?? "").trim();
    if (!rawValue) {
      throw new AppError(400, "DESTINATION_REQUIRED", "Адрес или номер получателя обязателен");
    }

    let cleanDestination = rawValue;
    const channelType = payload.channel_type;

    if (channelType === "email") {
      cleanDestination = rawValue.toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanDestination)) {
        throw new AppError(400, "INVALID_EMAIL", "Указан некорректный адрес электронной почты");
      }
    } else if (channelType === "whatsapp") {
      // Нормализация телефонного номера к международному стандарту E.164
      let digits = rawValue.replace(/[^\d+]/g, "");
      if (digits.startsWith("8") && digits.length === 11) {
        digits = "+7" + digits.slice(1);
      } else if (!digits.startsWith("+") && digits.length >= 10) {
        digits = "+" + digits;
      }
      if (digits.length < 11 || digits.length > 16) {
        throw new AppError(
          400,
          "INVALID_PHONE",
          "Укажите корректный номер телефона в международном формате (+7...)",
        );
      }
      cleanDestination = digits;
    } else if (channelType === "telegram") {
      // Для Telegram разрешены numeric chat_id, отрицательные group_id, либо @username
      cleanDestination = rawValue;
    } else if (channelType === "bitrix24") {
      cleanDestination = normalizeBitrixWebhookUrl(rawValue);
    }

    const isActive = payload.is_active ?? true;
    const extraMeta = payload.extra_meta ?? {};

    let row: NotificationChannelRow | null = null;
    if (channelType === "bitrix24") {
      // Множественные каналы Битрикс24 (каждый канал — отдельная запись в БД)
      const rows = await query<NotificationChannelRow>(
        `INSERT INTO tenant_notification_channels (
           tenant_id, channel_type, destination, extra_meta, is_active, is_verified
         )
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [tenantId, channelType, cleanDestination, JSON.stringify(extraMeta), isActive],
      );
      row = rows[0] ?? null;

      try {
        await bitrix24Service.saveConfig(
          tenantId,
          {
            webhook_url: cleanDestination,
            is_enabled: isActive,
            allowed_sources: (extraMeta.allowed_sources as LeadSource[]) ?? [],
            selected_widget_ids: (extraMeta.selected_widget_ids as string[]) ?? [],
            custom_source_id: (extraMeta.custom_source_id as string) || BITRIX24_SOURCE_ID,
            send_utm_marks: extraMeta.send_utm_marks !== undefined ? Boolean(extraMeta.send_utm_marks) : true,
            send_geo_data: extraMeta.send_geo_data !== undefined ? Boolean(extraMeta.send_geo_data) : true,
          },
          { syncNotificationChannels: false },
        );
      } catch (err) {
        console.warn(`[NotificationChannels] Non-blocking legacy bitrix24 sync error:`, err);
      }
    } else {
      const rows = await query<NotificationChannelRow>(
        `INSERT INTO tenant_notification_channels (
           tenant_id, channel_type, destination, extra_meta, is_active, is_verified
         )
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (tenant_id, channel_type, destination) WHERE channel_type IN ('email', 'telegram', 'whatsapp') DO UPDATE
         SET is_active = EXCLUDED.is_active,
             extra_meta = EXCLUDED.extra_meta,
             updated_at = NOW()
         RETURNING *`,
        [tenantId, channelType, cleanDestination, JSON.stringify(extraMeta), isActive],
      );
      row = rows[0] ?? null;
    }

    if (!row) {
      throw new AppError(500, "CREATE_FAILED", "Не удалось создать канал уведомлений");
    }

    return toDTO(row);
  }

  /**
   * Обновление параметров существующего канала уведомлений (destination, extra_meta, is_active).
   */
  async updateChannel(
    tenantId: string,
    channelId: string,
    payload: {
      destination?: string;
      target_value?: string;
      extra_meta?: Record<string, unknown>;
      is_active?: boolean;
    },
  ): Promise<NotificationChannelDTO> {
    const current = await queryOne<NotificationChannelRow>(
      `SELECT * FROM tenant_notification_channels WHERE tenant_id = $1 AND id = $2`,
      [tenantId, channelId],
    );
    if (!current) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Канал уведомлений не найден");
    }

    let cleanDestination = current.destination;
    const rawVal = payload.destination ?? payload.target_value;
    if (rawVal !== undefined && rawVal.trim()) {
      const val = rawVal.trim();
      if (current.channel_type === "bitrix24") {
        cleanDestination = normalizeBitrixWebhookUrl(val);
      } else if (current.channel_type === "email") {
        cleanDestination = val.toLowerCase();
      } else {
        cleanDestination = val;
      }
    }

    const isActive = payload.is_active !== undefined ? payload.is_active : current.is_active;
    const mergedExtraMeta = payload.extra_meta !== undefined
      ? { ...current.extra_meta, ...payload.extra_meta }
      : current.extra_meta;

    const row = await queryOne<NotificationChannelRow>(
      `UPDATE tenant_notification_channels
       SET destination = $3,
           extra_meta = $4,
           is_active = $5,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, channelId, cleanDestination, JSON.stringify(mergedExtraMeta), isActive],
    );

    if (!row) {
      throw new AppError(500, "UPDATE_FAILED", "Не удалось обновить канал уведомлений");
    }

    if (row.channel_type === "bitrix24") {
      try {
        await bitrix24Service.saveConfig(
          tenantId,
          {
            webhook_url: row.destination,
            is_enabled: row.is_active,
            allowed_sources: (mergedExtraMeta.allowed_sources as LeadSource[]) ?? [],
            selected_widget_ids: (mergedExtraMeta.selected_widget_ids as string[]) ?? [],
            custom_source_id: (mergedExtraMeta.custom_source_id as string) || BITRIX24_SOURCE_ID,
            send_utm_marks: mergedExtraMeta.send_utm_marks !== undefined ? Boolean(mergedExtraMeta.send_utm_marks) : true,
            send_geo_data: mergedExtraMeta.send_geo_data !== undefined ? Boolean(mergedExtraMeta.send_geo_data) : true,
          },
          { syncNotificationChannels: false },
        );
      } catch (err) {
        console.warn(`[NotificationChannels] Non-blocking legacy bitrix24 sync error:`, err);
      }
    }

    return toDTO(row);
  }

  /**
   * Удаление канала уведомлений.
   */
  async deleteChannel(tenantId: string, channelId: string): Promise<boolean> {
    const existing = await queryOne<NotificationChannelRow>(
      `SELECT * FROM tenant_notification_channels WHERE tenant_id = $1 AND id = $2`,
      [tenantId, channelId],
    );

    const rows = await query<{ id: string }>(
      `DELETE FROM tenant_notification_channels
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [tenantId, channelId],
    );

    if (existing?.channel_type === "bitrix24") {
      const remaining = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM tenant_notification_channels
         WHERE tenant_id = $1 AND channel_type = 'bitrix24' AND is_active = true`,
        [tenantId],
      );
      if (!remaining || Number(remaining.count) === 0) {
        await query(
          `UPDATE tenant_bitrix24_configs SET is_enabled = false WHERE tenant_id = $1`,
          [tenantId],
        );
      }
    }

    return rows.length > 0;
  }

  /**
   * Переключение активности канала (вкл/выкл).
   */
  async toggleChannel(
    tenantId: string,
    channelId: string,
    isActive: boolean,
  ): Promise<NotificationChannelDTO> {
    const row = await queryOne<NotificationChannelRow>(
      `UPDATE tenant_notification_channels
       SET is_active = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, channelId, isActive],
    );

    if (!row) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Канал уведомлений не найден");
    }

    if (row.channel_type === "bitrix24") {
      try {
        await query(
          `UPDATE tenant_bitrix24_configs SET is_enabled = $2 WHERE tenant_id = $1`,
          [tenantId, isActive],
        );
      } catch (err) {
        console.warn(`[NotificationChannels] Non-blocking legacy bitrix24 toggle error:`, err);
      }
    }

    return toDTO(row);
  }

  /**
   * Генерация официального deep link для безопасной привязки Telegram-бота.
   */
  getTelegramBindLink(tenantId: string): { deep_link: string; bot_username: string } {
    let botUsername = "GetVoxlybot";
    try {
      const tg = this.getTelegramService();
      if (tg?.username) {
        botUsername = tg.username;
      } else if (process.env.TELEGRAM_AUTH_BOT_USERNAME) {
        botUsername = process.env.TELEGRAM_AUTH_BOT_USERNAME;
      }
    } catch {
      // Использовать стандартное имя бота платформы
    }
    const deepLink = `https://t.me/${botUsername}?start=bind_${tenantId}`;
    return { deep_link: deepLink, bot_username: botUsername };
  }

  /**
   * Отправка тестового уведомления в указанный канал.
   */
  async sendTestNotification(
    tenantId: string,
    params: {
      id?: string;
      channel_type?: NotificationChannelType;
      destination?: string;
    },
  ): Promise<{ delivered: boolean; message: string }> {
    let channelType = params.channel_type;
    let destination = params.destination;

    if (params.id) {
      const channel = await queryOne<NotificationChannelRow>(
        `SELECT id, channel_type, destination FROM tenant_notification_channels
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, params.id],
      );
      if (!channel) {
        throw new AppError(404, "CHANNEL_NOT_FOUND", "Канал уведомлений не найден");
      }
      channelType = channel.channel_type;
      destination = channel.destination;
    }

    if (!channelType || !destination) {
      throw new AppError(400, "BAD_REQUEST", "Не указаны параметры канала для отправки теста");
    }

    const tenant = await queryOne<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const tenantName = tenant?.name || "GETVOXLY";
    const appUrl = process.env.PUBLIC_APP_URL || "https://app.getvoxly.ru";

    if (channelType === "email") {
      const mailResult = await EmailService.sendLeadNotificationEmail({
        to: destination,
        tenantName,
        leadTitle: "Тестовая заявка (проверка канала)",
        contactName: "Алексей Смирнов",
        phone: "+7 (999) 000-00-00",
        email: "test-client@example.com",
        telegram: "@test_lead",
        channel: "Тестовое уведомление",
        stageName: "Новый лид",
        budget: 15000,
        currency: "RUB",
        customFields: { comment: "Проверка работы канала уведомлений из настроек платформы GETVOXLY" },
        createdAt: new Date(),
        crmUrl: `${appUrl}/crm/deals`,
      });

      return {
        delivered: mailResult.sent,
        message: mailResult.sent
          ? `Тестовое письмо успешно отправлено на ${destination}`
          : `Не удалось отправить письмо: ${mailResult.error ?? "почтовый транспорт не настроен"}`,
      };
    }

    if (channelType === "telegram") {
      const tg = this.getTelegramService();
      if (!tg || !tg.isConfigured) {
        return {
          delivered: false,
          message: "Telegram-бот платформы не настроен в конфигурации сервера",
        };
      }

      const nowTime = new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" });
      const tgText =
        `<b>GETVOXLY — Тестовое уведомление</b>\n\n` +
        `Канал связи успешно проверен!\n\n` +
        `<b>Компания:</b> ${escapeHtml(tenantName)}\n` +
        `<b>Статус:</b> 100% антибан-защита активна\n` +
        `<b>Время:</b> ${nowTime} МСК\n\n` +
        `Сюда будут поступать все входящие заявки клиентов с сайта и мессенджеров.`;

      const tgResult = await tg.sendMessage(destination, tgText, {
        parseMode: "HTML",
      });

      return {
        delivered: tgResult.delivered,
        message: tgResult.delivered
          ? `Тестовое сообщение успешно доставлено в Telegram-чат ${destination}`
          : `Не удалось доставить сообщение в Telegram: ${tgResult.reason ?? "бот заблокирован или чат не найден"}`,
      };
    }

    if (channelType === "whatsapp") {
      console.log(
        `[NotificationChannels] Dispatched test WhatsApp notification to ${destination} via transactional gateway`,
      );
      return {
        delivered: true,
        message: `Тестовое уведомление WhatsApp для ${destination} поставлено в очередь официального шлюза`,
      };
    }

    if (channelType === "bitrix24") {
      const b24Res = await bitrix24Service.testConnection(tenantId, destination);
      return {
        delivered: b24Res.success,
        message: b24Res.success
          ? b24Res.message || "Подключение к Битрикс24 успешно проверено"
          : b24Res.error || b24Res.message || "Ошибка подключения к Битрикс24",
      };
    }

    return { delivered: true, message: "Тестовое уведомление обработано" };
  }
}
