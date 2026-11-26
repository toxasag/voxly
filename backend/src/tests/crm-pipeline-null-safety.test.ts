import { beforeEach, describe, expect, it, vi } from "vitest";
import { maskApiKey, maskEmail, maskPhone, maskToken } from "../lib/mask.utils.js";

const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  runWithTenantContext: (_tenantId: string, fn: () => Promise<unknown>) => fn(),
  transaction: (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
      queryOneOrThrow: (...args: unknown[]) => mockTxQueryOneOrThrow(...args),
    }),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
      queryOneOrThrow: (...args: unknown[]) => mockTxQueryOneOrThrow(...args),
    }),
}));

vi.mock("../modules/crm/chat/chat-events.js", () => ({
  chatEventBus: {
    emitChatEvent: vi.fn(),
  },
}));

vi.mock("../modules/crm/deals/stage-rules.service.js", () => ({
  StageRulesService: vi.fn().mockImplementation(() => ({
    evaluateForDeal: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../modules/crm/leads/lead-notification.service.js", () => ({
  enqueueLeadNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../modules/crm/leads/lead-summary.service.js", () => ({
  getDealConversationSummary: vi.fn().mockResolvedValue(null),
  scheduleLeadSummaryGeneration: vi.fn(),
}));

vi.mock("../modules/analytics/attribution-engine.service.js", () => ({
  attributionEngineService: {
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../modules/analytics/conversion-dispatcher.service.js", () => ({
  conversionDispatcherService: {
    dispatchForDeal: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CrmPipelineService } from "../modules/crm/crm-pipeline.service.js";

describe("CrmPipelineService null-safety regression (WhatsApp webhook last_name: null)", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const channelAccountId = "22222222-2222-2222-2222-222222222222";
  const contactId = "33333333-3333-3333-3333-333333333333";
  const dealId = "44444444-4444-4444-4444-444444444444";

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue(null);
    mockTxQuery.mockResolvedValue([]);
  });

  it("handles incoming WhatsApp message when existing contact has last_name: null without throwing TypeError", async () => {
    const contactRow = {
      id: contactId,
      first_name: "Иван",
      last_name: null,
      phone: "+79150946944",
      email: null,
      telegram_chat_id: null,
      telegram_username: null,
      whatsapp: "79150946944",
      socials: [],
      is_personal: false,
      custom_fields: {},
      messenger_id: null,
      messenger_name: null,
    };

    mockTxQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM contacts")) return contactRow;
      if (sql.includes("FROM deals")) {
        return {
          id: dealId,
          title: "Заявка от Иван (WhatsApp)",
          stage_id: "stage-1",
          pipeline_id: "pipe-1",
          is_won: false,
          is_lost: false,
        };
      }
      if (sql.includes("FROM stages")) {
        return { id: "stage-1", name: "Новый лид", pipeline_id: "pipe-1" };
      }
      return null;
    });

    mockTxQueryOneOrThrow.mockResolvedValue({
      id: "msg-1",
      created_at: new Date().toISOString(),
    });

    const service = new CrmPipelineService();
    const result = await service.processIncoming({
      tenantId,
      channel: "whatsapp",
      channelAccountId,
      chatId: "79150946944@s.whatsapp.net",
      senderPhone: "+79150946944",
      senderName: "Иван",
      text: "Добрый день, хочу узнать статус заказа",
    });

    expect(result.contactId).toBe(contactId);
    expect(result.dealId).toBe(dealId);
    expect(result.isNewContact).toBe(false);

    // Убеждаемся, что имя контакта никогда не сериализуется в "Иван null"
    const allSqlArgs = mockTxQuery.mock.calls.flatMap((c) => (Array.isArray(c[1]) ? c[1] : []));
    expect(allSqlArgs.some((arg) => typeof arg === "string" && arg.includes("null"))).toBe(false);
  });

  it("replaces placeholder first_name when last_name is null without crashing", async () => {
    const placeholderContact = {
      id: contactId,
      first_name: "Посетитель",
      last_name: null,
      phone: null,
      email: null,
      telegram_chat_id: null,
      telegram_username: null,
      whatsapp: "79150946944",
      socials: [],
      is_personal: false,
      custom_fields: {},
      messenger_id: null,
      messenger_name: null,
    };

    mockTxQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM contacts")) return placeholderContact;
      if (sql.includes("FROM deals")) {
        return {
          id: dealId,
          title: "Заявка от Посетитель (WhatsApp)",
          stage_id: "stage-1",
          pipeline_id: "pipe-1",
          is_won: false,
          is_lost: false,
        };
      }
      if (sql.includes("FROM stages")) {
        return { id: "stage-1", name: "Новый лид", pipeline_id: "pipe-1" };
      }
      return null;
    });

    mockTxQueryOneOrThrow.mockResolvedValue({
      id: "msg-2",
      created_at: new Date().toISOString(),
    });

    const service = new CrmPipelineService();
    const result = await service.processIncoming({
      tenantId,
      channel: "whatsapp",
      channelAccountId,
      chatId: "79150946944@s.whatsapp.net",
      senderPhone: "+79150946944",
      senderName: "Посетитель",
      text: "Привет",
    });

    expect(result.contactId).toBe(contactId);
    expect(result.dealId).toBe(dealId);
  });

  it("never saves third-party phone from MAX message body onto the client contact", async () => {
    const maxContact = {
      id: contactId,
      first_name: "Михаил",
      last_name: "",
      phone: "",
      email: null,
      telegram_chat_id: null,
      telegram_username: null,
      whatsapp: null,
      socials: [{ kind: "max", value: "196946784" }],
      is_personal: false,
      custom_fields: { max_chat_id: "196946784", max_user_id: "77056581" },
      messenger_id: "196946784",
      messenger_name: "Макс",
    };

    const queriedPhones: string[] = [];
    mockTxQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM contacts")) {
        if (sql.includes("phone IN") && Array.isArray(params)) {
          queriedPhones.push(String(params[1] ?? ""));
        }
        return sql.includes("max_chat_id") ? maxContact : null;
      }
      if (sql.includes("FROM deals")) {
        return {
          id: dealId,
          title: "Заявка от Михаил (MAX)",
          stage_id: "stage-1",
          pipeline_id: "pipe-1",
          is_won: false,
          is_lost: false,
        };
      }
      if (sql.includes("FROM stages")) {
        return { id: "stage-1", name: "Новый лид", pipeline_id: "pipe-1" };
      }
      return null;
    });

    mockTxQueryOneOrThrow.mockResolvedValue({
      id: "msg-max-1",
      created_at: new Date().toISOString(),
    });

    const service = new CrmPipelineService();
    await service.processIncoming({
      tenantId,
      channel: "max",
      channelAccountId,
      chatId: "196946784",
      peerUserId: "77056581",
      senderName: "Михаил",
      text: "контакт монтажника который передаст их с объекта +7 932 128 38 77 Тимофей",
    });

    const phoneUpdateCalls = mockTxQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("SET phone = $1"),
    );
    expect(phoneUpdateCalls).toHaveLength(0);
    expect(queriedPhones).not.toContain("+79321283877");
  });
});

describe("mask.utils", () => {
  it("masks phones, emails, tokens and API keys safely", () => {
    expect(maskPhone("+7 999 123 45 67")).toBe("+79***67");
    expect(maskPhone("12345")).toBe("***");
    expect(maskEmail("ivan@example.com")).toBe("i***n@example.com");
    expect(maskEmail("ab@example.com")).toBe("a***@example.com");
    expect(maskEmail("invalid")).toBe("***");
    expect(maskToken("abcdef123456")).toBe("abcd...456");
    expect(maskToken("short")).toBe("***");
    expect(maskApiKey("AIzaSyABCDEF1234")).toBe("AIza••••1234");
    expect(maskApiKey("AIzaSyABCDEF1234", 7)).toBe("AIzaSyA••••1234");
    expect(maskApiKey("short")).toBe("••••••••");
    expect(maskApiKey("")).toBe("");
  });
});
