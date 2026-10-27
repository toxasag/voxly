import { describe, expect, it, vi } from "vitest";
import {
  isNewUrl,
  normalizeUrl,
  KnowledgeBaseQueueService,
  KB_QUEUE_NAME,
} from "../modules/ai/knowledge-base.queue.js";

describe("Knowledge Base Queue & Crawler Automation", () => {
  describe("URL Normalization and Comparison", () => {
    it("should normalize URLs correctly removing trailing slashes and casing", () => {
      expect(normalizeUrl("https://Example.COM/")).toBe("https://example.com");
      expect(normalizeUrl("https://example.com/about/")).toBe("https://example.com/about");
      expect(normalizeUrl("  https://my-site.ru/catalog/item/   ")).toBe("https://my-site.ru/catalog/item");
      expect(normalizeUrl("")).toBe("");
      expect(normalizeUrl(null)).toBe("");
    });

    it("should detect when a new URL is provided vs existing URL", () => {
      expect(isNewUrl(null, "https://example.com")).toBe(true);
      expect(isNewUrl("", "https://example.com")).toBe(true);
      expect(isNewUrl("https://example.com", "https://example.com/")).toBe(false);
      expect(isNewUrl("https://example.com", "https://different.com")).toBe(true);
      expect(isNewUrl("https://example.com", "")).toBe(false);
      expect(isNewUrl("https://example.com", null)).toBe(false);
    });
  });

  describe("Queue Configuration and Job Scheduling", () => {
    it("should use queue name 'kb'", () => {
      expect(KB_QUEUE_NAME).toBe("kb");
    });

    it("should format and emit the required BullMQ log pattern on add()", async () => {
      const queueService = KnowledgeBaseQueueService.getInstance();
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const testBotId = "11111111-2222-3333-4444-555555555555";
      const testTenantId = "tenant-001";
      const testUrl = "https://example.com";

      const result = await queueService.add("crawl-website", {
        tenantId: testTenantId,
        botId: testBotId,
        url: testUrl,
        source: "agent_settings_auto",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();

      // Acceptance criterion: [BullMQ] Job crawl-website added for bot <id>
      const expectedLog = `[BullMQ] Job crawl-website added for bot ${testBotId}`;
      expect(consoleLogSpy).toHaveBeenCalledWith(expectedLog);

      consoleLogSpy.mockRestore();
    });
  });
});
