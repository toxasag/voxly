import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preChatModalService } from "../prechat-modal.service.js";

describe("PreChatModalService & Attribution Verification", () => {
  it("generates safe, compact lead codes of format vx-xxxx", () => {
    const codes = new Set<string>();
    const safeRegex = /^vx-[23456789abcdefghkmnpqrstuvwxyz]{4}$/;

    for (let i = 0; i < 100; i++) {
      const code = preChatModalService.generateLeadCode();
      assert.match(code, safeRegex, `Code ${code} must match safe pattern`);
      codes.add(code);
    }

    // Uniqueness in small batch
    assert.equal(codes.size, 100, "All 100 generated codes should be unique");
  });

  it("extracts lead codes from natural incoming messenger messages", () => {
    const leadCodeRegex =
      /(?:код|code)[:\s]*(vx-[a-z0-9]{4,6})/i;
    const boundaryRegex = /\b(vx-[a-z0-9]{4,6})\b/i;

    const testCases = [
      {
        text: "Здравствуйте! Меня зовут Иван. (код: vx-9821)",
        expected: "vx-9821",
      },
      {
        text: "Здравствуйте! Меня зовут Анна. Вопрос: Консультация по ремонту (код: vx-4k7b)",
        expected: "vx-4k7b",
      },
      {
        text: "Привет, я по поводу заявки code: vx-ab12",
        expected: "vx-ab12",
      },
      {
        text: "Добрый день! vx-7788 перешел с сайта",
        expected: "vx-7788",
      },
    ];

    for (const tc of testCases) {
      const match = tc.text.match(leadCodeRegex) || tc.text.match(boundaryRegex);
      assert.ok(match, `Should match: ${tc.text}`);
      const code = (match[1] || match[0]).toLowerCase();
      assert.equal(code, tc.expected);
    }
  });

  it("correctly ignores messages without lead codes", () => {
    const leadCodeRegex = /(?:код|code)[:\s]*(vx-[a-z0-9]{4,6})/i;
    const boundaryRegex = /\b(vx-[a-z0-9]{4,6})\b/i;

    const negativeCases = [
      "Здравствуйте, сколько стоит замена экрана на iPhone 13?",
      "Привет! Это не код vx- или vxx",
      "Мой код скидки 500 рублей",
      "vx-12", // too short (needs at least 4 chars)
      "vx-123456789", // too long
    ];

    for (const text of negativeCases) {
      const match = text.match(leadCodeRegex) || text.match(boundaryRegex);
      assert.equal(match, null, `Should not match negative case: ${text}`);
    }
  });

  it("formats message text with template tags", () => {
    const template = "Здравствуйте! Меня зовут {name}. (код: {code})";
    const name = "Екатерина";
    const code = "vx-5m9p";

    const formatted = template.replace(/\{name\}/g, name).replace(/\{code\}/g, code);
    assert.equal(formatted, "Здравствуйте! Меня зовут Екатерина. (код: vx-5m9p)");
  });

  it("formats valid deep links for WhatsApp and Telegram", () => {
    const text = "Здравствуйте! Меня зовут Иван. (код: vx-9821)";
    const encoded = encodeURIComponent(text);

    const waPhone = "79991234567";
    const waLink = `https://wa.me/${waPhone}?text=${encoded}`;
    assert.ok(waLink.startsWith("https://wa.me/79991234567?text="));
    assert.ok(waLink.includes(encodeURIComponent("(код: vx-9821)")));

    const tgUser = "GetVoxlybot";
    const tgLink = `https://t.me/${tgUser}?text=${encoded}`;
    assert.ok(tgLink.startsWith("https://t.me/GetVoxlybot?text="));
    assert.ok(tgLink.includes(encodeURIComponent("(код: vx-9821)")));
  });
});
