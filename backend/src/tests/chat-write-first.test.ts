import { describe, it, expect, vi, beforeEach } from "vitest";
import { DealMessagingService } from "../modules/crm/deals/deal-messaging.service.js";
import { DealsService } from "../modules/crm/deals/deals.service.js";
import * as outboundRegistry from "../modules/channels/outbound-registry.js";

const mockQuery = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn(),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

describe("Write-First Chat and Send-From Options", () => {
  let dealsService: DealsService;
  let messagingService: DealMessagingService;

  beforeEach(() => {
    vi.clearAllMocks();
    dealsService = new DealsService();
    messagingService = new DealMessagingService(dealsService);
  });

  describe("getSendFromOptions", () => {
    it("returns available channels with reasons based on contact information", async () => {
      // 1. mock contact row
      mockQuery.mockResolvedValueOnce([
        {
          telegram_chat_id: "987654321",
          telegram_username: "client_tg",
          whatsapp: null,
          phone: "", // у контакта нет телефона для WhatsApp/MAX, но есть Telegram
        },
      ]);

      // 2. mock channel accounts
      mockQuery.mockResolvedValueOnce([
        { id: "acc-tg-1", channel: "telegram", name: "Основной бот Telegram" },
        { id: "acc-wa-1", channel: "whatsapp", name: "WhatsApp Бизнес" },
        { id: "acc-max-1", channel: "max", name: "MAX Канал" },
      ]);

      // 3. mock last message account row (empty - write-first)
      mockQuery.mockResolvedValueOnce([]);

      const options = await messagingService.getSendFromOptions("tenant-1", "deal-1");

      expect(options).toHaveLength(3);

      const tgOption = options.find((o) => o.channelAccountId === "acc-tg-1");
      expect(tgOption?.available).toBe(true);
      expect(tgOption?.isDefault).toBe(true); // первый аккаунт по умолчанию

      const waOption = options.find((o) => o.channelAccountId === "acc-wa-1");
      expect(waOption?.available).toBe(false);
      expect(waOption?.unavailableReason).toContain("не указан телефон для WhatsApp");

      const maxOption = options.find((o) => o.channelAccountId === "acc-max-1");
      expect(maxOption?.available).toBe(false);
      expect(maxOption?.unavailableReason).toContain("не указан телефон для MAX");
    });
  });

  describe("Write-first outbound message delivery", () => {
    it("automatically falls back to connected channel account when deal has no message history", async () => {
      const mockSender = vi.fn().mockResolvedValue({ ok: true, recipient: "987654321" });
      vi.spyOn(outboundRegistry, "resolveOutboundSender").mockReturnValue(mockSender);

      // 1. mock createMessage
      const createdMessage = {
        id: "msg-1",
        dealId: "deal-1",
        channelAccountId: null,
        source: "manager" as const,
        direction: "outbound" as const,
        senderName: "Менеджер",
        content: "Здравствуйте! Чем могу помочь?",
        channel: "telegram" as const,
        deliveryStatus: "pending" as const,
        deliveryError: null,
        attachment: null,
        attachmentType: null,
        createdAt: new Date().toISOString(),
      };
      vi.spyOn(dealsService, "createMessage").mockResolvedValue(createdMessage);

      // 2. mock AI handoff query
      mockQuery.mockResolvedValueOnce([]);

      // 3. mock resolveRoute: row without prior channel_account_id
      mockQuery.mockResolvedValueOnce([
        {
          channel_account_id: null,
          telegram_chat_id: "987654321",
          telegram_username: "client_tg",
          whatsapp: null,
          phone: "+79991112233",
        },
      ]);

      // 4. mock fallback query for channel_accounts
      mockQuery.mockResolvedValueOnce([{ id: "acc-tg-fallback" }]);

      // 4. mock markMessageDelivery
      vi.spyOn(dealsService, "markMessageDelivery").mockResolvedValue({
        ...createdMessage,
        deliveryStatus: "sent",
      });

      const result = await messagingService.sendManagerMessage({
        tenantId: "tenant-1",
        dealId: "deal-1",
        senderName: "Менеджер",
        payload: {
          content: "Здравствуйте! Чем могу помочь?",
          channel: "telegram",
          direction: "outbound",
          source: "manager",
        },
      });

      expect(result.deliveryStatus).toBe("sent");
      expect(mockSender).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: "tenant-1",
        channelAccountId: "acc-tg-fallback",
        recipient: "987654321",
        text: "Здравствуйте! Чем могу помочь?",
      }));
    });
  });
});
