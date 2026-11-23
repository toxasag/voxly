import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET = "telegram-bot-test-jwt-secret-123456789";

import { AppError } from "../plugins/errorHandler.js";
import {
  telegramBotTokenSchema,
  telegramBotConnectSchema,
  telegramBotCreateManagedSchema,
} from "../modules/channels/telegram-bot.types.js";
import { TelegramBotService } from "../modules/channels/telegram-bot.service.js";

describe("Telegram Bot Integration & Schemas", () => {
  it("validates correct Telegram bot token format", () => {
    const validToken = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567";
    const parsed = telegramBotTokenSchema.safeParse(validToken);
    assert.equal(parsed.success, true);
  });

  it("rejects invalid Telegram bot token formats", () => {
    assert.equal(telegramBotTokenSchema.safeParse("invalid_token").success, false);
    assert.equal(telegramBotTokenSchema.safeParse("abc:123").success, false);
    assert.equal(telegramBotTokenSchema.safeParse("").success, false);
    assert.equal(telegramBotTokenSchema.safeParse("12345:").success, false);
  });

  it("validates connect schema", () => {
    const valid = telegramBotConnectSchema.safeParse({
      label: "Основной бот поддержки",
      token: "987654321:AAFlkmzX928_KLasd9283-klasd09",
    });
    assert.equal(valid.success, true);
  });

  it("validates managed bot creation schema with username rules", () => {
    const valid = telegramBotCreateManagedSchema.safeParse({
      name: "Voxly Assistant",
      username: "voxly_support_bot",
    });
    assert.equal(valid.success, true);

    // Должен заканчиваться на bot
    const noBotSuffix = telegramBotCreateManagedSchema.safeParse({
      name: "Voxly Assistant",
      username: "voxly_support",
    });
    assert.equal(noBotSuffix.success, false);

    // Слишком короткий (меньше 5 символов)
    const tooShort = telegramBotCreateManagedSchema.safeParse({
      name: "Voxly Assistant",
      username: "bot",
    });
    assert.equal(tooShort.success, false);

    // Недопустимые символы
    const invalidChars = telegramBotCreateManagedSchema.safeParse({
      name: "Voxly Assistant",
      username: "voxly-bot!",
    });
    assert.equal(invalidChars.success, false);
  });

  it("returns manager info with deep link template", () => {
    const service = new TelegramBotService();
    const info = service.getManagerInfo();

    assert.equal(info.configured, true);
    assert.ok(info.managerUsername.length > 0);
    assert.ok(info.deepLinkTemplate.includes("https://t.me/newbot/"));
    assert.equal(info.features.managedBots, true);
  });

  it("handles getMe with simulated valid Telegram API response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 999888777,
              is_bot: true,
              first_name: "Mock Company Bot",
              username: "mock_company_bot",
              can_join_groups: true,
              can_read_all_group_messages: false,
              supports_inline_queries: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    try {
      const service = new TelegramBotService();
      const botInfo = await service.getMe("123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567");

      assert.equal(botInfo.id, 999888777);
      assert.equal(botInfo.isBot, true);
      assert.equal(botInfo.username, "mock_company_bot");
      assert.equal(botInfo.firstName, "Mock Company Bot");
      assert.equal(botInfo.canJoinGroups, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles getMe with simulated 401 Unauthorized from Telegram API", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 401,
          description: "Unauthorized",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const service = new TelegramBotService();
      await assert.rejects(
        async () => {
          await service.getMe("123456789:invalid_token_here");
        },
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, "INVALID_BOT_TOKEN");
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
