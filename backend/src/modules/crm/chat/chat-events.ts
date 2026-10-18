import { EventEmitter } from "node:events";

export interface ChatStreamEvent {
  type: "message_created" | "delivery_updated" | "typing" | "ai_handoff";
  tenantId: string;
  dealId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

class ChatEventBus extends EventEmitter {
  emitChatEvent(event: ChatStreamEvent): void {
    this.emit(`tenant:${event.tenantId}`, event);
    if (event.dealId) {
      this.emit(`deal:${event.tenantId}:${event.dealId}`, event);
    }
  }

  subscribeTenant(tenantId: string, listener: (event: ChatStreamEvent) => void): () => void {
    const channel = `tenant:${tenantId}`;
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }

  subscribeDeal(tenantId: string, dealId: string, listener: (event: ChatStreamEvent) => void): () => void {
    const channel = `deal:${tenantId}:${dealId}`;
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }
}

export const chatEventBus = new ChatEventBus();
