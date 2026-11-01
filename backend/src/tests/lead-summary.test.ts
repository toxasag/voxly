import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicSummary,
  generateLeadSummary,
  type ChatMessageItem,
} from "../modules/crm/leads/lead-summary.service.js";
import { EmailService } from "../services/email.service.js";
import { formatLeadTelegramNotification } from "../modules/crm/leads/lead-notification.queue.js";

describe("Lead Conversation Summary Service & Notification Renderers", () => {
  it("buildDeterministicSummary returns null for empty or whitespace messages", () => {
    assert.equal(buildDeterministicSummary([]), null);
    assert.equal(
      buildDeterministicSummary([
        { source: "customer", content: "   " },
        { source: "system", content: "Session started" },
      ]),
      null,
    );
  });

  it("buildDeterministicSummary extracts single customer message", () => {
    const messages: ChatMessageItem[] = [
      { source: "system", content: "Диалог начат" },
      { source: "customer", content: "Здравствуйте, нужен ремонт стиральной машины Bosch Serie 6" },
      { source: "agent", content: "Добрый день! Какая именно неисправность?" },
    ];

    const summary = buildDeterministicSummary(messages);
    assert.equal(summary, "Здравствуйте, нужен ремонт стиральной машины Bosch Serie 6");
  });

  it("buildDeterministicSummary builds first message and clarification when multiple customer messages", () => {
    const messages: ChatMessageItem[] = [
      { source: "customer", content: "Добрый день, интересует замена матрицы на MacBook Pro 16 M1" },
      { source: "agent", content: "Здравствуйте! Уточните, пожалуйста, есть ли полосы или экран полностью черный?" },
      { source: "customer", content: "Экран треснул после падения, нет подсветки. Нужно сделать до пятницы" },
    ];

    const summary = buildDeterministicSummary(messages);
    assert.equal(
      summary,
      "Добрый день, интересует замена матрицы на MacBook Pro 16 M1\nУточнение: Экран треснул после падения, нет подсветки. Нужно сделать до пятницы",
    );
  });

  it("buildDeterministicSummary falls back to non-system messages if customer source not tagged", () => {
    const messages: ChatMessageItem[] = [
      { source: "system", content: "System event" },
      { source: "chat", sender_name: "Иван", content: "Нужен выезд мастера на завтра на 14:00" },
    ];

    const summary = buildDeterministicSummary(messages);
    assert.equal(summary, "Иван: Нужен выезд мастера на завтра на 14:00");
  });

  it("generateLeadSummary safely falls back to deterministic summary when no LLM key or offline", async () => {
    const messages: ChatMessageItem[] = [
      { source: "customer", content: "Интересует внедрение CRM для оптового склада стройматериалов" },
      { source: "agent", content: "Сколько менеджеров работает в отделе?" },
      { source: "customer", content: "15 менеджеров, сейчас работаем в Excel" },
    ];

    // In testing environment without real LLM connection, generateLeadSummary must return fallback without throwing
    const summary = await generateLeadSummary(messages, { tenantId: "test-tenant" });
    assert.ok(summary);
    assert.match(summary, /Интересует внедрение CRM/);
  });

  it("EmailService.renderLeadNotificationEmail includes conversationSummary in HTML and text", () => {
    const rendered = EmailService.renderLeadNotificationEmail({
      tenantName: "ООО Сервис-Плюс",
      leadTitle: "Заявка на ремонт MacBook",
      contactName: "Михаил",
      phone: "+79991234567",
      email: "mikhail@example.com",
      conversationSummary: "Клиенту нужна замена матрицы на MacBook Pro 16. Экран разбит после удара, бюджет до 40 000 руб.",
      crmUrl: "https://getvoxly.ru/deals/deal-123",
    });

    assert.ok(rendered.html.includes("Краткая суть обращения:"));
    assert.ok(rendered.html.includes("Клиенту нужна замена матрицы на MacBook Pro 16"));
    assert.ok(rendered.text.includes("Краткая суть обращения:"));
    assert.ok(rendered.text.includes("Клиенту нужна замена матрицы на MacBook Pro 16"));
    // Ensure no emojis in subject
    assert.doesNotMatch(rendered.subject, /[\u{1F300}-\u{1F6FF}]/u);
  });

  it("formatLeadTelegramNotification includes conversationSummary block in message", () => {
    const message = formatLeadTelegramNotification({
      leadTitle: "Заявка с сайта",
      tenantName: "ООО Сервис-Плюс",
      contactName: "Елена",
      phone: "+79031112233",
      conversationSummary: "Требуется ТО кофемашины DeLonghi в офисе. Не подает пар.",
      crmUrl: "https://getvoxly.ru/deals/deal-456",
    });

    assert.ok(message.includes("<b>Суть обращения:</b>"));
    assert.ok(message.includes("Требуется ТО кофемашины DeLonghi"));
    assert.ok(message.includes("+79031112233"));
  });
});
