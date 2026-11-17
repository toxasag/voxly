import { describe, it, expect } from "vitest";
import {
  stripTechnicalMessageMetadata,
  MessageTranslationService,
} from "../modules/crm/translation/message-translation.service.js";

describe("MessageTranslationService", () => {
  describe("stripTechnicalMessageMetadata", () => {
    it("should strip device and page analytics prefixes", () => {
      const input = "[Устройство: iPhone][Страница: https://example.com/en] Hello! Do you fix pools?";
      const cleaned = stripTechnicalMessageMetadata(input);
      expect(cleaned).toBe("Hello! Do you fix pools?");
    });

    it("should strip UTM and referrer prefixes", () => {
      const input = "[UTM: utm_source=google][Черновик] How much is the consultation?";
      const cleaned = stripTechnicalMessageMetadata(input);
      expect(cleaned).toBe("How much is the consultation?");
    });

    it("should leave plain messages intact", () => {
      const input = "Could you also please tell me if you work on weekends?";
      expect(stripTechnicalMessageMetadata(input)).toBe(input);
    });

    it("should handle empty or whitespace string", () => {
      expect(stripTechnicalMessageMetadata("")).toBe("");
      expect(stripTechnicalMessageMetadata("   ")).toBe("");
    });
  });

  describe("autoTranslateIfForeign heuristic", () => {
    it("should identify foreign messages and skip Cyrillic messages", () => {
      const service = new MessageTranslationService();

      // Russian message should not trigger auto-translation
      const ruCall = service.autoTranslateIfForeign({
        tenantId: "t1",
        messageId: "m1",
        content: "Здравствуйте! Подскажите стоимость ремонта крыши.",
      });
      expect(ruCall).toBeUndefined();

      // Empty should not trigger
      const emptyCall = service.autoTranslateIfForeign({
        tenantId: "t1",
        messageId: "m2",
        content: "",
      });
      expect(emptyCall).toBeUndefined();
    });
  });
});
