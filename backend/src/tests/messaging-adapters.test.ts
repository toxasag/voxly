import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MaxBridgeAdapter } from "../modules/messaging/adapters/max/MaxBridgeAdapter.js";
import { MaxTsAdapter } from "../modules/messaging/adapters/max/MaxTsAdapter.js";
import { MaxGreenApiAdapter } from "../modules/messaging/adapters/max/MaxGreenApiAdapter.js";
import { MessagingRegistry } from "../modules/messaging/messaging-registry.js";
import type { IncomingEvent } from "../modules/messaging/adapters/IMessagingAdapter.js";

describe("Messaging Adapters Technical Suite", () => {
  describe("MaxBridgeAdapter", () => {
    it("should instantiate with correct channel and provider metadata", () => {
      const adapter = new MaxBridgeAdapter();
      assert.equal(adapter.channel, "max");
      assert.equal(adapter.providerName, "max-bridge");
    });

    it("should handle incoming events and notify subscribers", () => {
      const adapter = new MaxBridgeAdapter();
      const received: IncomingEvent[] = [];
      const unsub = adapter.subscribeToEvents((ev) => received.push(ev));

      adapter.dispatchIncomingEvent({
        tenantId: "00000000-0000-0000-0000-000000000001",
        channelAccountId: "acc-123",
        channel: "max",
        eventType: "message",
        chatId: "chat-999",
        timestamp: Date.now(),
        message: {
          id: "msg-1",
          chatId: "chat-999",
          senderId: "client-1",
          text: "Привет от клиента",
          direction: "inbound",
          fromMe: false,
          timestamp: Date.now(),
        },
      });

      assert.equal(received.length, 1);
      assert.equal(received[0]?.message?.text, "Привет от клиента");

      unsub();
      adapter.dispatchIncomingEvent({
        tenantId: "00000000-0000-0000-0000-000000000001",
        channelAccountId: "acc-123",
        channel: "max",
        eventType: "message",
        chatId: "chat-999",
        timestamp: Date.now(),
      });
      assert.equal(received.length, 1); // No new events after unsubscribe
    });
  });

  describe("MaxGreenApiAdapter", () => {
    it("should instantiate with correct channel and provider metadata", () => {
      const adapter = new MaxGreenApiAdapter();
      assert.equal(adapter.channel, "max");
      assert.equal(adapter.providerName, "max-green-api");
    });

    it("should dispatch webhook events to subscribers", () => {
      const adapter = new MaxGreenApiAdapter();
      const events: IncomingEvent[] = [];
      adapter.subscribeToEvents((ev) => events.push(ev));

      adapter.dispatchWebhookEvent({
        tenantId: "t-1",
        channelAccountId: "ca-1",
        channel: "max",
        eventType: "message",
        chatId: "chat-100",
        timestamp: 1700000000,
        message: {
          id: "m-100",
          chatId: "chat-100",
          senderId: "u-100",
          text: "Звонок через GreenApi",
          direction: "inbound",
          fromMe: false,
          timestamp: 1700000000,
        },
      });

      assert.equal(events.length, 1);
      assert.equal(events[0]?.message?.text, "Звонок через GreenApi");
    });
  });

  describe("MaxTsAdapter", () => {
    it("should instantiate with correct channel and provider metadata", () => {
      const adapter = new MaxTsAdapter();
      assert.equal(adapter.channel, "max");
      assert.equal(adapter.providerName, "max-native-ts");
    });

    it("should resolve contact phone digits cleanly", async () => {
      const adapter = new MaxTsAdapter();
      const contact = await adapter.resolveContact("t-1", "ca-1", "+79991234567");
      assert.ok(contact);
      assert.equal(contact.phone, "+79991234567");
      assert.equal(contact.isRegistered, true);
    });
  });

  describe("MessagingRegistry", () => {
    it("should register default adapters (max-bridge, max-native-ts, max-green-api)", () => {
      const registry = new MessagingRegistry();
      assert.ok(registry.getAdapter("max", "max-bridge"));
      assert.ok(registry.getAdapter("max", "max-native-ts"));
      assert.ok(registry.getAdapter("max", "max-green-api"));
    });

    it("should create OutboundSender for max channel", () => {
      const registry = new MessagingRegistry();
      const sender = registry.createMaxOutboundSender();
      assert.equal(typeof sender, "function");
    });
  });
});
