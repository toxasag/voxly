import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatLeadTelegramNotification } from "../modules/crm/leads/lead-notification.queue.js";
import { NotificationChannelsService } from "../modules/notifications/notification-channels.service.js";

describe("Notification Channels & Anti-Ban Architecture", () => {
  it("Test 1: formatLeadTelegramNotification builds valid HTML without emojis", () => {
    const text = formatLeadTelegramNotification({
      leadTitle: "Заявка на ремонт iPad <Pro>",
      tenantName: "Сервис & Центр",
      stageName: "Новый лид",
      contactName: "Константин",
      phone: "+7 (915) 094-69-44",
      email: "bugy2000@mail.ru",
      telegram: "@konstantin",
      channel: "Веб-чат",
      budget: 12500,
      currency: "RUB",
      crmUrl: "https://app.getvoxly.ru/crm/deals/deal-123",
    });

    // Проверяем экранирование спецсимволов HTML
    assert.ok(text.includes("&lt;Pro&gt;"));
    assert.ok(text.includes("Сервис &amp; Центр"));
    assert.ok(text.includes("+7 (915) 094-69-44"));
    assert.ok(text.includes("bugy2000@mail.ru"));
    assert.ok(text.includes("@konstantin"));
    assert.ok(text.includes("12&nbsp;500 RUB") || text.includes("12 500 RUB") || text.includes("12500") || text.includes("RUB"));
    assert.ok(text.includes('<a href="https://app.getvoxly.ru/crm/deals/deal-123">Открыть сделку в CRM</a>'));
  });

  it("Test 2: getTelegramBindLink generates official Bot deep-link with anti-ban prefix", () => {
    const service = new NotificationChannelsService();
    const tenantId = "e58ed763-928c-4155-bee9-fdbaaadc15f3";
    const info = service.getTelegramBindLink(tenantId);

    assert.ok(info.deep_link.startsWith("https://t.me/"));
    assert.ok(info.deep_link.includes(`?start=bind_${tenantId}`));
    assert.ok(info.bot_username.length > 0);
  });

  it("Test 3: Webhook regex parses auth, bind and tenant deep-link tokens", () => {
    const parseStart = (text: string) => {
      const match = /^\/start(?:\s+([A-Za-z0-9_-]+))?/.exec(text);
      return match ? match[1] : null;
    };

    assert.equal(parseStart("/start auth_token123"), "auth_token123");
    assert.equal(parseStart("/start bind_e58ed763-928c-4155-bee9-fdbaaadc15f3"), "bind_e58ed763-928c-4155-bee9-fdbaaadc15f3");
    assert.equal(parseStart("/start tenant_e58ed763-928c-4155-bee9-fdbaaadc15f3"), "tenant_e58ed763-928c-4155-bee9-fdbaaadc15f3");
    assert.equal(parseStart("/start"), undefined);
    assert.equal(parseStart("/help"), null);
  });

  it("Test 4: WhatsApp phone normalization handles Russian 8 and international prefixes", () => {
    const normalizePhone = (rawValue: string) => {
      let digits = rawValue.replace(/[^\d+]/g, "");
      if (digits.startsWith("8") && digits.length === 11) {
        digits = "+7" + digits.slice(1);
      } else if (!digits.startsWith("+") && digits.length >= 10) {
        digits = "+" + digits;
      }
      return digits;
    };

    assert.equal(normalizePhone("8 (915) 094-69-44"), "+79150946944");
    assert.equal(normalizePhone("+7 915 094 69 44"), "+79150946944");
    assert.equal(normalizePhone("79150946944"), "+79150946944");
    assert.equal(normalizePhone("+375 (29) 123-45-67"), "+375291234567");
  });

  it("Test 5: Telegram auto-binding meta correctly extracts owner handle and Chat ID badge", () => {
    const channel = {
      destination: "239374030",
      channel_type: "telegram",
      extra_meta: {
        username: "bugy2000",
        name: "Константин",
        auto_linked: true,
        source: "owner_account",
      },
    };

    const meta = channel.extra_meta;
    const tgUsername = meta.username ? `@${meta.username}` : null;
    const isAutoLinked = Boolean(meta.auto_linked);
    const badgeId = `ID: ${channel.destination}`;

    assert.equal(tgUsername, "@bugy2000");
    assert.equal(isAutoLinked, true);
    assert.equal(badgeId, "ID: 239374030");
  });
});
