import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestEnv } from "./helpers/test-app.js";
import { isBotSender } from "../modules/crm/channel-identity.js";
import { CrmPipelineService } from "../modules/crm/crm-pipeline.service.js";
import * as dbClient from "../db/client.js";
import { leadNotificationQueue } from "../modules/crm/leads/lead-notification.queue.js";
import { notificationQueue } from "../modules/notifications/notification.queue.js";

describe("Bot Filtering & Anti-Spam Pipeline (INC-BotPrevention)", () => {
  const tenantId = "33333333-3333-3333-3333-333333333333";

  beforeAll(() => {
    applyTestEnv();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isBotSender — Unit Tests", () => {
    it("распознает кейс из инцидента: @kupmsk_bot через username профиля", () => {
      expect(
        isBotSender({
          channel: "telegram",
          chatId: "123456789",
          senderName: "Клуб Умных Покупателей",
          profile: {
            firstName: "Клуб Умных Покупателей",
            username: "kupmsk_bot",
          },
        }),
      ).toBe(true);

      // С собачкой
      expect(
        isBotSender({
          channel: "telegram",
          chatId: "123456789",
          profile: {
            username: "@kupmsk_bot",
          },
        }),
      ).toBe(true);
    });

    it("распознает нативный флаг Telegram API / MTProto entity.bot", () => {
      expect(
        isBotSender({
          channel: "telegram",
          chatId: "987654321",
          isBot: true,
        }),
      ).toBe(true);

      expect(
        isBotSender({
          channel: "telegram",
          chatId: "987654321",
          profile: {
            firstName: "Assistant",
            isBot: true,
          },
        }),
      ).toBe(true);
    });

    it("распознает флаг бота из метаданных источника (sourceMetadata / webhook)", () => {
      expect(
        isBotSender({
          channel: "max",
          chatId: "max_chat_1",
          sourceMetadata: { is_bot: true },
        }),
      ).toBe(true);

      expect(
        isBotSender({
          channel: "telegram",
          chatId: "tg_chat_1",
          sourceMetadata: { type: "bot" },
        }),
      ).toBe(true);

      expect(
        isBotSender({
          channel: "max",
          chatId: "max_chat_2",
          sourceMetadata: { sender_type: "bot" },
        }),
      ).toBe(true);
    });

    it("распознает различные форматы имен ботов (регистронезависимо и с суффиксом bot)", () => {
      expect(isBotSender({ senderTelegramUsername: "MySuperBot" })).toBe(true);
      expect(isBotSender({ senderUsername: "shop_bot" })).toBe(true);
      expect(isBotSender({ senderTelegramUsername: "orderbot" })).toBe(true);
      expect(isBotSender({ chatId: "@delivery_bot" })).toBe(true);
      expect(isBotSender({ senderName: "@service_bot" })).toBe(true);
      expect(isBotSender({ senderName: "service_bot" })).toBe(true);
    });

    it("НЕ определяет реальных пользователей как ботов (отсутствие ложных срабатываний)", () => {
      expect(
        isBotSender({
          channel: "telegram",
          chatId: "123456789",
          senderName: "Алексей Смирнов",
          profile: {
            firstName: "Алексей",
            lastName: "Смирнов",
            username: "alex_smirnov",
          },
        }),
      ).toBe(false);

      expect(
        isBotSender({
          channel: "telegram",
          chatId: "123456789",
          senderName: "Abbot",
          profile: {
            firstName: "Abbot",
            username: "abbot_smith",
          },
        }),
      ).toBe(false);

      expect(
        isBotSender({
          channel: "telegram",
          chatId: "123456789",
          profile: {
            username: "robotics_expert",
          },
        }),
      ).toBe(false);

      expect(
        isBotSender({
          channel: "max",
          chatId: "@ivanmax",
          senderName: "Иван",
          profile: {
            firstName: "Иван",
            username: "ivanmax",
          },
        }),
      ).toBe(false);
    });
  });

  describe("CrmPipelineService.processIncoming — Bot Prevention Integration", () => {
    it("блокирует автосоздание контакта и сделки при сообщении от @kupmsk_bot", async () => {
      const loggerMock = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const service = new CrmPipelineService(loggerMock);

      const triggerNotificationSpy = vi
        .spyOn(leadNotificationQueue, "checkAndTriggerNotification")
        .mockResolvedValue(undefined as never);
      const leadCreatedSpy = vi
        .spyOn(notificationQueue, "dispatchLeadCreated")
        .mockResolvedValue(undefined as never);
      const txSpy = vi.spyOn(dbClient, "transaction");

      const result = await service.processIncoming({
        tenantId,
        channel: "telegram",
        channelAccountId: "acc-tg-1",
        chatId: "123456789",
        text: "Привет! Скидки в нашем клубе!",
        senderName: "Клуб Умных Покупателей",
        senderTelegramChatId: "123456789",
        profile: {
          firstName: "Клуб Умных Покупателей",
          username: "kupmsk_bot",
          isBot: true,
        },
      });

      // 1. Результат пайплайна: контакт и сделка не созданы, признак isBot установлен
      expect(result.isBot).toBe(true);
      expect(result.contactId).toBe("");
      expect(result.dealId).toBe("");
      expect(result.isNewContact).toBe(false);
      expect(result.isNewDeal).toBe(false);

      // 2. Транзакция БД на создание сущностей не открывалась
      expect(txSpy).not.toHaveBeenCalled();

      // 3. Уведомления менеджерам о новом лиде не отправлялись
      expect(triggerNotificationSpy).not.toHaveBeenCalled();
      expect(leadCreatedSpy).not.toHaveBeenCalled();

      // 4. Залогирован пропуск
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          channel: "telegram",
          senderName: "Клуб Умных Покупателей",
        }),
        expect.stringContaining("Skipping lead/contact creation: sender is a bot (@kupmsk_bot)"),
      );
    });

    it("блокирует создание сделки, если найден ранее существовавший контакт-бот", async () => {
      const loggerMock = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const service = new CrmPipelineService(loggerMock);

      // Эмулируем транзакцию, находящую контакт с telegram_username = kupmsk_bot
      vi.spyOn(dbClient, "transaction").mockImplementation(async (callback) => {
        const mockTx = {
          queryOne: vi.fn().mockImplementation(async (sql: string) => {
            if (sql.includes("FROM contacts")) {
              return {
                id: "contact-bot-123",
                first_name: "Клуб Умных Покупателей",
                last_name: "",
                telegram_username: "kupmsk_bot",
                is_personal: false,
              };
            }
            return null;
          }),
          query: vi.fn().mockResolvedValue([]),
        };
        return callback(mockTx as unknown as never);
      });

      const result = await service.processIncoming({
        tenantId,
        channel: "telegram",
        channelAccountId: "acc-tg-1",
        chatId: "123456789",
        text: "Повторная рассылка",
        senderName: "Клуб Умных Покупателей",
        senderTelegramChatId: "123456789",
        // Допустим, профиль в этот раз не вернулся, но в базе контакт уже есть
      });

      expect(result.isBot).toBe(true);
      expect(result.dealId).toBe("");
      expect(result.contactId).toBe("contact-bot-123");
      expect(result.isNewDeal).toBe(false);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          contactId: "contact-bot-123",
          username: "kupmsk_bot",
        }),
        expect.stringContaining("Skipping lead/contact creation: sender is a bot (@kupmsk_bot)"),
      );
    });
  });
});
