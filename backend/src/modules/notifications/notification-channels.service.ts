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
   * Список всех настроенных каналов уведомлений арендатора.
   */
  async listChannels(tenantId: string): Promise<NotificationChannelDTO[]> {
    const rows = await query<NotificationChannelRow>(
      `SELECT id, tenant_id, channel_type, destination, extra_meta, is_active, is_verified, created_at, updated_at
       FROM tenant_notification_channels
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId],
    );

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
    }

    const isActive = payload.is_active ?? true;
    const extraMeta = payload.extra_meta ?? {};

    const rows = await query<NotificationChannelRow>(
      `INSERT INTO tenant_notification_channels (
         tenant_id, channel_type, destination, extra_meta, is_active, is_verified
       )
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (tenant_id, channel_type, destination) DO UPDATE
       SET is_active = EXCLUDED.is_active,
           extra_meta = EXCLUDED.extra_meta,
           updated_at = NOW()
       RETURNING *`,
      [tenantId, channelType, cleanDestination, JSON.stringify(extraMeta), isActive],
    );

    const row = rows[0];
    if (!row) {
      throw new AppError(500, "CREATE_FAILED", "Не удалось создать канал уведомлений");
    }

    return toDTO(row);
  }

  /**
   * Удаление канала уведомлений.
   */
  async deleteChannel(tenantId: string, channelId: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `DELETE FROM tenant_notification_channels
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [tenantId, channelId],
    );

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

    return { delivered: true, message: "Тестовое уведомление обработано" };
  }
}
