import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrmPipelineService } from "../modules/crm/crm-pipeline.service.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  transaction: async (fn: (tx: { query: typeof mockQuery; queryOne: typeof mockQueryOne }) => Promise<unknown>) =>
    fn({ query: mockQuery, queryOne: mockQueryOne }),
}));

describe("Chat fromMe Mirroring and AI Handoff (Block 5.3)", () => {
  let service: CrmPipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CrmPipelineService();
  });

  it("mirrors native operator outbound message and pauses AI bot for 30 minutes", async () => {
    // 1. mock findContact
    mockQueryOne.mockResolvedValueOnce({
      id: "contact-1",
      first_name: "Иван",
      last_name: "Иванов",
    });

    // 2. mock findActiveDeal
    mockQueryOne.mockResolvedValueOnce({
      id: "deal-1",
      title: "Сделка 1",
    });

    // 3. mock update deals ai_paused_until
    const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    mockQueryOne.mockResolvedValueOnce({
      paused_until: futureDate,
    });

    // 4. mock insert deal_messages
    mockQueryOne.mockResolvedValueOnce({
      id: "msg-out-1",
    });

    const result = await service.processNativeOutbound({
      tenantId: "tenant-1",
      channel: "telegram",
      channelAccountId: "acc-tg-1",
      chatId: "12345678",
      text: "Здравствуйте! Я подключился к диалогу, сейчас решим ваш вопрос.",
      senderName: "Менеджер Алексей",
      pauseMinutes: 30,
    });

    expect(result.dealId).toBe("deal-1");
    expect(result.messageId).toBe("msg-out-1");
    expect(result.pausedUntil).toBe(futureDate);

    // Проверяем вызовы
    expect(mockQueryOne).toHaveBeenCalledTimes(4);

    // Проверяем параметры вставки сообщения
    const insertArgs = mockQueryOne.mock.calls[3];
    expect(insertArgs?.[0]).toContain("INSERT INTO deal_messages");
    const insertParams = insertArgs?.[1] as unknown[];
    expect(insertParams[0]).toBe("tenant-1");
    expect(insertParams[1]).toBe("deal-1");
    expect(insertParams[3]).toBe("Менеджер Алексей");
    expect(insertParams[4]).toContain("Здравствуйте! Я подключился");
    expect(insertParams[5]).toBe("telegram");
  });
});
