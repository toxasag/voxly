import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrmEnrichmentService } from "../modules/crm/enrichment.service.js";

const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();

vi.mock("../db/client.js", () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn(),
  transaction: async (fn: (tx: { query: typeof mockTxQuery }) => Promise<unknown>) =>
    fn({ query: mockTxQuery }),
}));

describe("CrmEnrichmentService (Block 4.2 Cross-Channel Enrichment)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never invents synthetic links when provider reports exists = false", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "contact-1",
      first_name: "Иван",
      last_name: "Иванов",
      phone: "+79991234567",
      telegram_username: null,
      telegram_chat_id: null,
      whatsapp: null,
      socials: [],
    });

    const mockTelegram = vi.fn().mockResolvedValue({ exists: false });
    const mockMax = vi.fn().mockResolvedValue({ exists: false });
    const mockWhatsApp = vi.fn().mockResolvedValue({ exists: false });

    const service = new CrmEnrichmentService({
      checkTelegram: mockTelegram,
      checkMax: mockMax,
      checkWhatsApp: mockWhatsApp,
    });

    const res = await service.enrichContact("tenant-1", "contact-1");

    expect(res.ok).toBe(true);
    expect(res.enrichedFields).toHaveLength(0);
    expect(mockTxQuery).not.toHaveBeenCalled();
  });

  it("enriches contact with confirmed Telegram and WhatsApp profiles and updates placeholder name", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "contact-1",
      first_name: "Клиент",
      last_name: null,
      phone: "+79997654321",
      telegram_username: null,
      telegram_chat_id: null,
      whatsapp: null,
      socials: [],
    });

    const mockTelegram = vi.fn().mockResolvedValue({
      exists: true,
      userId: "12345678",
      username: "alex_dev",
      firstName: "Алексей",
      lastName: "Смирнов",
    });
    const mockMax = vi.fn().mockResolvedValue({
      exists: true,
      link: "https://max.ru/u/alex",
    });
    const mockWhatsApp = vi.fn().mockResolvedValue({
      exists: true,
      jid: "79997654321@s.whatsapp.net",
    });

    const service = new CrmEnrichmentService({
      checkTelegram: mockTelegram,
      checkMax: mockMax,
      checkWhatsApp: mockWhatsApp,
    });

    const res = await service.enrichContact("tenant-1", "contact-1");

    expect(res.ok).toBe(true);
    expect(res.enrichedFields).toContain("telegram_username");
    expect(res.enrichedFields).toContain("telegram_chat_id");
    expect(res.enrichedFields).toContain("socials:telegram");
    expect(res.enrichedFields).toContain("socials:max");
    expect(res.enrichedFields).toContain("whatsapp");
    expect(res.enrichedFields).toContain("socials:whatsapp");
    expect(res.enrichedFields).toContain("name");

    expect(mockTxQuery).toHaveBeenCalledTimes(1);
    const updateParams = mockTxQuery.mock.calls[0]?.[1];
    expect(updateParams?.[0]).toBe("Алексей");
    expect(updateParams?.[1]).toBe("Смирнов");
    expect(updateParams?.[2]).toBe("alex_dev");
    expect(updateParams?.[3]).toBe("12345678");
    expect(updateParams?.[4]).toBe("+79997654321");
  });
});
