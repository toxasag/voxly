import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET = "channel-links-test-jwt-secret-123456789";

import { ChannelLinksService } from "../modules/channels/channel-links.service.js";

describe("ChannelLinksService", () => {
  const service = new ChannelLinksService();

  it("resolves Telegram Bot links with /start support", () => {
    const links = service.resolveAccountLinks({
      id: "11111111-1111-1111-1111-111111111111",
      channel: "telegram_bot",
      external_id: "@voxly_sales_bot",
      label: "Sales Bot",
    });

    assert.equal(links.accountType, "bot");
    assert.equal(links.cleanIdentifier, "voxly_sales_bot");
    assert.equal(links.directUrl, "https://t.me/voxly_sales_bot");
    assert.ok(links.trackingUrl.includes("/to/11111111-1111-1111-1111-111111111111"));

    const customLinks = service.resolveAccountLinks(
      {
        id: "11111111-1111-1111-1111-111111111111",
        channel: "telegram_bot",
        external_id: "@voxly_sales_bot",
        label: "Sales Bot",
      },
      { startTag: "promo2026" },
    );
    assert.equal(customLinks.directUrl, "https://t.me/voxly_sales_bot?start=promo2026");
  });

  it("resolves Telegram MTProto user account with greeting text", () => {
    const links = service.resolveAccountLinks(
      {
        id: "22222222-2222-2222-2222-222222222222",
        channel: "telegram",
        external_id: "@artem_manager",
        label: "Artem",
        has_session: true,
      },
      { text: "Здравствуйте! Хочу консультацию" },
    );

    assert.equal(links.accountType, "user_api");
    assert.equal(links.cleanIdentifier, "artem_manager");
    assert.ok(links.directUrl.includes("https://t.me/artem_manager?text="));
    assert.ok(decodeURIComponent(links.directUrl).includes("Здравствуйте! Хочу консультацию"));
  });

  it("normalizes WhatsApp Russian 8-prefix phone numbers and formats direct link", () => {
    const links = service.resolveAccountLinks(
      {
        id: "33333333-3333-3333-3333-333333333333",
        channel: "whatsapp",
        external_id: "8 (926) 123-45-67",
        label: "WhatsApp Support",
      },
      { text: "Привет!" },
    );

    assert.equal(links.accountType, "whatsapp");
    assert.equal(links.cleanIdentifier, "79261234567");
    assert.equal(links.directUrl, `https://wa.me/79261234567?text=${encodeURIComponent("Привет!")}`);
  });

  it("resolves MAX messenger direct link", () => {
    const links = service.resolveAccountLinks({
      id: "44444444-4444-4444-4444-444444444444",
      channel: "max",
      external_id: "company_max_id",
      label: "MAX Official",
    });

    assert.equal(links.accountType, "max");
    assert.equal(links.cleanIdentifier, "company_max_id");
    assert.equal(links.directUrl, "https://max.ru/company_max_id");
  });

  it("builds destination deep links with tracking tokens and lead codes", () => {
    // 1. Bot receives /start with sessionToken
    const botDeep = service.buildDestinationDeepLink(
      {
        channel: "telegram_bot",
        external_id: "sales_bot",
        credentials: { botToken: "xyz" },
      },
      {
        sessionToken: "ref_123456abcdef",
        prechatLeadCode: "vx-7a9f",
      },
    );
    assert.equal(botDeep, "https://t.me/sales_bot?start=ref_123456abcdef");

    // 2. WhatsApp receives pre-filled message with lead code
    const waDeep = service.buildDestinationDeepLink(
      {
        channel: "whatsapp",
        external_id: "79990001122",
      },
      {
        sessionToken: "ref_123456abcdef",
        prechatLeadCode: "vx-7a9f",
        text: "Добрый день!",
      },
    );
    assert.ok(waDeep.includes("https://wa.me/79990001122?text="));
    assert.ok(decodeURIComponent(waDeep).includes("Добрый день! (код: vx-7a9f)"));
  });

  it("handles HTTP 302 fallback redirect on nonexistent or invalid account ID", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    await app.ready();

    try {
      const resRoot = await app.inject({
        method: "GET",
        url: "/to/00000000-0000-0000-0000-000000000000",
      });
      assert.equal(resRoot.statusCode, 302);
      assert.equal(resRoot.headers.location, "https://getvoxly.ru");

      const resApi = await app.inject({
        method: "GET",
        url: "/api/v1/public/track/m/00000000-0000-0000-0000-000000000000",
      });
      assert.equal(resApi.statusCode, 302);
      assert.equal(resApi.headers.location, "https://getvoxly.ru");

      const resInvalid = await app.inject({
        method: "GET",
        url: "/to/not-a-valid-uuid",
      });
      assert.equal(resInvalid.statusCode, 302);
      assert.equal(resInvalid.headers.location, "https://getvoxly.ru");
    } finally {
      await app.close();
    }
  });
});
