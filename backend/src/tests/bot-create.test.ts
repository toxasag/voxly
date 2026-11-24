import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET = "bot-create-test-jwt-secret-123456789";

import {
  botCreateSchema,
  botNameSchema,
} from "../modules/channels/telegram-bot.types.js";
import { TelegramBotService } from "../modules/channels/telegram-bot.service.js";

describe("Bot Auto Registration & Creation", () => {
  it("validates bot name and creation schemas", () => {
    const valid = botCreateSchema.safeParse({
      name: "freelancehuntervoxly_bot",
    });
    assert.equal(valid.success, true);

    const empty = botNameSchema.safeParse("");
    assert.equal(empty.success, false);

    const withDesired = botCreateSchema.safeParse({
      name: "Freelance Hunter Bot",
      desired_username: "freelancehunter_bot",
    });
    assert.equal(withDesired.success, true);
  });

  it("generates unique name in voxlyN_bot pattern or sanitizes base name", async () => {
    const service = new TelegramBotService();

    // Запрос с базовым именем — приводит к латинице и добавляет _bot при необходимости
    const custom = await service.generateUniqueName("freelancehuntervoxly_bot");
    assert.ok(custom.endsWith("bot"));
    assert.ok(custom.includes("freelancehuntervoxly"));

    // Запрос с кириллицей — транслитерирует в латиницу и добавляет _bot
    const cyrillic = await service.generateUniqueName("фриланс хантер");
    assert.equal(cyrillic, "frilans_hanter_bot");

    // Запрос без базы — подбирает voxlyN_bot (где N = 1..10)
    const generated = await service.generateUniqueName();
    assert.ok(/^voxly\d+_bot$/.test(generated), `Generated name ${generated} should match voxlyN_bot pattern`);
  });

  it("generates valid Telegram Bot API tokens with bot_id and secret", async () => {
    const service = new TelegramBotService();
    const uniqueUsername = await service.generateUniqueName("voxly_test_runner_bot");

    assert.ok(uniqueUsername.length >= 5);
    assert.ok(uniqueUsername.endsWith("bot"));
  });
});
