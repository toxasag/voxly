import { describe, expect, it } from "vitest";

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

    expect(links.accountType).toBe("bot");
    expect(links.cleanIdentifier).toBe("voxly_sales_bot");
    expect(links.directUrl).toBe("https://t.me/voxly_sales_bot?start=site_lead");
    expect(links.trackingUrl).toContain("/to/11111111-1111-1111-1111-111111111111");
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

    expect(links.accountType).toBe("user_api");
    expect(links.cleanIdentifier).toBe("artem_manager");
    expect(links.directUrl).toContain("https://t.me/artem_manager?text=");
    expect(decodeURIComponent(links.directUrl)).toContain("Здравствуйте! Хочу консультацию");
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

    expect(links.accountType).toBe("whatsapp");
    expect(links.cleanIdentifier).toBe("79261234567");
    expect(links.directUrl).toBe(`https://wa.me/79261234567?text=${encodeURIComponent("Привет!")}`);
  });

  it("resolves MAX messenger direct link", () => {
    const links = service.resolveAccountLinks({
      id: "44444444-4444-4444-4444-444444444444",
      channel: "max",
      external_id: "company_max_id",
      label: "MAX Official",
    });

    expect(links.accountType).toBe("max");
    expect(links.cleanIdentifier).toBe("company_max_id");
    expect(links.directUrl).toBe("https://max.ru/company_max_id");
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
    expect(botDeep).toBe("https://t.me/sales_bot?start=ref_123456abcdef");

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
    expect(waDeep).toContain("https://wa.me/79990001122?text=");
    expect(decodeURIComponent(waDeep)).toContain("Добрый день! (код: vx-7a9f)");
  });
});
