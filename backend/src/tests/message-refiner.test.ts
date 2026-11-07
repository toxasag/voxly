import { describe, expect, it } from "vitest";
import {
  MessageRefinerService,
  normalizeChannelType,
  getChannelLimit,
  isCompletedText,
  type MessageCorrectionInput,
} from "../modules/ai/message-refiner.service.js";
import type { ChatCompletionResult, ChatProvider } from "../services/chat.service.js";

describe("message-refiner - normalizeChannelType & getChannelLimit", () => {
  it("нормализует типы каналов и возвращает правильные лимиты", () => {
    expect(normalizeChannelType("telegram")).toBe("telegram");
    expect(normalizeChannelType("Telegram")).toBe("telegram");
    expect(normalizeChannelType("whatsapp")).toBe("whatsapp");
    expect(normalizeChannelType("WhatsApp")).toBe("whatsapp");
    expect(normalizeChannelType("max")).toBe("max");
    expect(normalizeChannelType("MAX")).toBe("max");
    expect(normalizeChannelType("webchat")).toBe("widget");
    expect(normalizeChannelType("онлайн-чат")).toBe("widget");
    expect(normalizeChannelType(undefined)).toBe("widget");

    expect(getChannelLimit("telegram")).toBe(4096);
    expect(getChannelLimit("whatsapp")).toBe(4096);
    expect(getChannelLimit("max")).toBe(4096);
    expect(getChannelLimit("widget")).toBe(2048);
  });
});

describe("message-refiner - isCompletedText", () => {
  it("распознает завершенные и незавершенные предложения", () => {
    expect(isCompletedText("Здравствуйте! Чем могу помочь?")).toBe(true);
    expect(isCompletedText("Стоимость составляет 5000 руб.")).toBe(true);
    expect(isCompletedText("Подробности на [сайте](https://example.com).")).toBe(true);
    expect(isCompletedText("Конечно, сделаем скидку 10%")).toBe(true);

    // Незавершенные фразы
    expect(isCompletedText("Мы можем предложить вам...")).toBe(false);
    expect(isCompletedText("Мы можем предложить вам…")).toBe(false);
    expect(isCompletedText("Стоимость включает доставку,")).toBe(false);
    expect(isCompletedText("Обратите внимание:")).toBe(false);
    expect(isCompletedText("Услуга доступна -")).toBe(false);
  });
});

describe("message-refiner - MessageRefinerService", () => {
  it("мгновенно пропускает (bypass) валидное сообщение в пределах лимита с 0ms задержкой", async () => {
    let chatCalled = false;
    const mockChat: ChatProvider = {
      isConfigured: true,
      complete: async (): Promise<ChatCompletionResult> => {
        chatCalled = true;
        return {
          content: "Refined",
          tokensIn: 10,
          tokensOut: 5,
          model: "gemini-3.5-flash-lite",
          latencyMs: 100,
        };
      },
    };

    const refiner = new MessageRefinerService(mockChat);
    const text = "Добрый день! Базовое обслуживание стоит 3500 рублей. Подскажите, когда вам удобно подъехать?";

    const input: MessageCorrectionInput = {
      originalMessage: text,
      channelLimit: 4096,
      channelType: "telegram",
      tenantId: "tenant-123",
    };

    const result = await refiner.refineMessage(input);

    expect(chatCalled).toBe(false);
    expect(result.bypass).toBe(true);
    expect(result.refinedMessage).toBe(text);
    expect(result.latencyMs).toBe(0);
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });

  it("вызывает LLM-редактор при превышении лимита канала и сжимает сообщение", async () => {
    let receivedModel = "";
    let receivedPrompt = "";

    const mockChat: ChatProvider = {
      isConfigured: true,
      complete: async (callInput): Promise<ChatCompletionResult> => {
        receivedModel = callInput.model;
        receivedPrompt = callInput.messages.map((m) => m.content).join("\n");
        return {
          content: "Здравствуйте! У нас действует скидка 15% на первое ТО. Подскажите, какая у вас марка авто?",
          tokensIn: 120,
          tokensOut: 35,
          model: "gemini-3.5-flash-lite",
          latencyMs: 250,
        };
      },
    };

    const refiner = new MessageRefinerService(mockChat);
    const longText = "Очень длинный текст. ".repeat(300); // 4400 символов > 4000

    const input: MessageCorrectionInput = {
      originalMessage: longText,
      channelLimit: 4000,
      channelType: "telegram",
      tenantId: "tenant-123",
      contextBrief: "Клиент спросил про скидку",
    };

    const result = await refiner.refineMessage(input);

    expect(receivedModel).toBe("gemini-3.5-flash-lite");
    expect(receivedPrompt).toContain("ЛИМИТ СИМВОЛОВ: 4000");
    expect(receivedPrompt).toContain("КОНТЕКСТ ДИАЛОГА: Клиент спросил про скидку");
    expect(result.bypass).toBe(false);
    expect(result.refinedMessage).toBe(
      "Здравствуйте! У нас действует скидка 15% на первое ТО. Подскажите, какая у вас марка авто?",
    );
    expect(result.refinedMessage.length).toBeLessThanOrEqual(4000);
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(35);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it("вызывает LLM при незавершенном предложении (например, оборвано на многоточии)", async () => {
    let chatCalled = false;
    const mockChat: ChatProvider = {
      isConfigured: true,
      complete: async (): Promise<ChatCompletionResult> => {
        chatCalled = true;
        return {
          content: "Да, мы сможем доставить заказ завтра к 14:00.",
          tokensIn: 50,
          tokensOut: 15,
          model: "gemini-3.5-flash-lite",
          latencyMs: 180,
        };
      },
    };

    const refiner = new MessageRefinerService(mockChat);
    const cutOffText = "Да, мы сможем доставить заказ...";

    const input: MessageCorrectionInput = {
      originalMessage: cutOffText,
      channelLimit: 4096,
      channelType: "whatsapp",
      tenantId: "tenant-456",
    };

    const result = await refiner.refineMessage(input);

    expect(chatCalled).toBe(true);
    expect(result.bypass).toBe(false);
    expect(result.refinedMessage).toBe("Да, мы сможем доставить заказ завтра к 14:00.");
  });

  it("обеспечивает graceful fallback при ошибке вызова LLM без падения сервиса", async () => {
    const mockChat: ChatProvider = {
      isConfigured: true,
      complete: async (): Promise<ChatCompletionResult> => {
        throw new Error("Connection reset by peer");
      },
    };

    const refiner = new MessageRefinerService(mockChat, 500);
    const sentence = "Первое законченное предложение. Второе законченное предложение. ";
    const longText = sentence.repeat(50); // 3200 символов

    const input: MessageCorrectionInput = {
      originalMessage: longText,
      channelLimit: 1000,
      channelType: "widget",
      tenantId: "tenant-789",
    };

    const result = await refiner.refineMessage(input);

    expect(result.bypass).toBe(false);
    expect(result.refinedMessage.length).toBeLessThanOrEqual(1000);
    expect(result.refinedMessage.endsWith("предложение.")).toBe(true);
  });
});
