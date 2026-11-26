import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockRunWithTenantContext = vi.fn(async (_t: string, fn: () => Promise<unknown>) => fn());
const mockWithTenant = vi.fn(async (_t: string, fn: (tx: { query: typeof mockQuery; queryOne: typeof mockQueryOne }) => Promise<unknown>) =>
  fn({ query: mockQuery, queryOne: mockQueryOne }),
);
const mockTransaction = vi.fn(async (fn: (tx: { query: typeof mockQuery; queryOne: typeof mockQueryOne; queryOneOrThrow: typeof mockQueryOne }) => Promise<unknown>) =>
  fn({ query: mockQuery, queryOne: mockQueryOne, queryOneOrThrow: mockQueryOne }),
);
const mockEnqueue = vi.fn();
const mockGetPrivateDialogs = vi.fn();
const mockSyncMaxDialogHistory = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  runWithTenantContext: (t: string, fn: () => Promise<unknown>) => mockRunWithTenantContext(t, fn),
  withTenant: (t: string, fn: (tx: unknown) => Promise<unknown>) => mockWithTenant(t, fn),
  transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
}));

vi.mock("../infrastructure/queue.js", () => ({
  queueManager: {
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
  },
}));

vi.mock("../modules/channels/max-bridge.service.js", () => ({
  MaxBridgeService: class {
    getPrivateDialogs = (...args: unknown[]) => mockGetPrivateDialogs(...args);
  },
}));

vi.mock("../modules/channels/max-integration.routes.js", () => ({
  syncMaxDialogHistory: (...args: unknown[]) => mockSyncMaxDialogHistory(...args),
}));

import {
  enqueueChannelHistorySync,
  isHistorySyncSupportedChannel,
  runChannelHistorySync,
} from "../modules/channels/channel-history-sync.service.js";

describe("ChannelHistorySyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports only max, telegram, whatsapp channels", () => {
    expect(isHistorySyncSupportedChannel("max")).toBe(true);
    expect(isHistorySyncSupportedChannel("telegram")).toBe(true);
    expect(isHistorySyncSupportedChannel("whatsapp")).toBe(true);
    expect(isHistorySyncSupportedChannel("telegram_bot")).toBe(false);
    expect(isHistorySyncSupportedChannel("webchat")).toBe(false);
  });

  it("enqueues sync job when account is connected and not locked", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "acc-1",
      status: "connected",
      history_sync_status: "idle",
      history_sync_started_at: null,
    });
    mockQuery.mockResolvedValue([]);

    const queued = await enqueueChannelHistorySync({
      tenantId: "tenant-1",
      channelAccountId: "acc-1",
      channel: "max",
    });

    expect(queued).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "timeline-sync",
        tenantId: "tenant-1",
        name: "channel-history-sync",
        data: { tenantId: "tenant-1", channelAccountId: "acc-1", channel: "max" },
      }),
    );
  });

  it("syncs MAX history only for matched CRM contacts with messages and preserves contact FIO", async () => {
    mockQueryOne
      // 1. account lookup
      .mockResolvedValueOnce({ id: "acc-max", status: "connected", credentials: {} })
      // 2. findOrCreateDealForContactSync: byThread
      .mockResolvedValueOnce(null)
      // 3. findOrCreateDealForContactSync: byContact (existing deal)
      .mockResolvedValueOnce({ id: "deal-123", chat_thread_id: null });

    mockQuery
      // 1. contacts list: c-1 matches by phone, c-2 has no messages
      .mockResolvedValueOnce([
        {
          id: "c-1",
          first_name: "Иван",
          last_name: "Петров",
          phone: "+79165554433",
          telegram_chat_id: null,
          telegram_username: null,
          messenger_id: null,
          socials: [],
          custom_fields: {},
        },
        {
          id: "c-2",
          first_name: "Мария",
          last_name: "Сидорова",
          phone: "+79031112233",
          telegram_chat_id: null,
          telegram_username: null,
          messenger_id: null,
          socials: [],
          custom_fields: {},
        },
      ])
      .mockResolvedValue([]);

    mockGetPrivateDialogs.mockResolvedValueOnce({
      ok: true,
      selfPhone: "+79990001122",
      dialogs: [
        {
          chatId: "max-chat-99",
          userId: "user-99",
          phone: "+79165554433",
          messages: [{ id: "m1", out: false, text: "Здравствуйте", date: 1732500000 }],
        },
      ],
    });

    mockSyncMaxDialogHistory.mockResolvedValueOnce(1);

    const res = await runChannelHistorySync({
      tenantId: "tenant-1",
      channelAccountId: "acc-max",
      channel: "max",
    });

    expect(res.processedContacts).toBe(2);
    expect(res.syncedMessages).toBe(1);
    expect(mockSyncMaxDialogHistory).toHaveBeenCalledTimes(1);
    expect(mockSyncMaxDialogHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        dealId: "deal-123",
        peerId: "max-chat-99",
        senderName: "Иван Петров",
      }),
    );

    // Проверяем, что UPDATE contacts НЕ трогает first_name / last_name / phone
    const contactUpdateCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE contacts"),
    );
    expect(contactUpdateCall).toBeDefined();
    expect(contactUpdateCall?.[0]).not.toContain("first_name");
    expect(contactUpdateCall?.[0]).not.toContain("last_name");
  });
});
