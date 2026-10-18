import { describe, it, expect, vi, beforeEach } from "vitest";
import fastify from "fastify";
import { chatStreamRoutes } from "../modules/crm/chat/chat-stream.routes.js";
import { chatEventBus } from "../modules/crm/chat/chat-events.js";

const mockQuery = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn(),
}));

vi.mock("../plugins/authenticate.js", () => ({
  authenticatePlugin: async () => {},
}));

describe("Realtime Chat Stream & Polling Fallback (Block 5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent messages on delta endpoint", async () => {
    const app = fastify();
    app.decorate("authenticate", async (request: unknown) => {
      (request as { tenant_id: string }).tenant_id = "tenant-1";
    });
    app.decorate("requirePermission", () => async () => {});

    await app.register(chatStreamRoutes, { prefix: "/api/v1" });

    const mockMessages = [
      {
        id: "msg-1",
        deal_id: "deal-1",
        source: "client",
        direction: "inbound",
        sender_name: "Клиент",
        content: "Привет!",
        channel: "telegram",
        created_at: new Date().toISOString(),
      },
    ];

    mockQuery.mockResolvedValueOnce(mockMessages);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/crm/chat/delta?dealId=deal-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].content).toBe("Привет!");
    expect(body.serverTime).toBeDefined();
  });

  it("broadcasts tenant events via ChatEventBus", async () => {
    const received: unknown[] = [];
    const unsubscribe = chatEventBus.subscribeTenant("tenant-1", (evt) => {
      received.push(evt);
    });

    chatEventBus.emitChatEvent({
      type: "message_created",
      tenantId: "tenant-1",
      dealId: "deal-1",
      data: { content: "Новое сообщение" },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("message_created");

    unsubscribe();
  });
});
