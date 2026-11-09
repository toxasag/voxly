import { describe, expect, it } from "vitest";
import {
  BITRIX24_SOURCE_ID,
  normalizeBitrixWebhookUrl,
} from "../modules/integrations/bitrix24/bitrix24.service.js";

describe("Bitrix24 Lead Connector", () => {
  it("enforces SOURCE_ID to strictly equal 'UC_VWN1ZK'", () => {
    expect(BITRIX24_SOURCE_ID).toBe("UC_VWN1ZK");
  });

  describe("normalizeBitrixWebhookUrl", () => {
    it("normalizes base webhook url ending with slash", () => {
      const input = "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/";
      const result = normalizeBitrixWebhookUrl(input);
      expect(result).toBe("https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json");
    });

    it("normalizes base webhook url without trailing slash", () => {
      const input = "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39";
      const result = normalizeBitrixWebhookUrl(input);
      expect(result).toBe("https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json");
    });

    it("handles already provided method correctly without duplication", () => {
      const input = "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json";
      const result = normalizeBitrixWebhookUrl(input);
      expect(result).toBe("https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json");
    });

    it("handles crm.lead.add without .json suffix", () => {
      const input = "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add";
      const result = normalizeBitrixWebhookUrl(input);
      expect(result).toBe("https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json");
    });

    it("rejects non-https urls", () => {
      expect(() =>
        normalizeBitrixWebhookUrl("http://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/"),
      ).toThrow("HTTPS");
    });

    it("rejects internal and localhost urls (SSRF guard)", () => {
      expect(() =>
        normalizeBitrixWebhookUrl("https://localhost/rest/1/abc/"),
      ).toThrow("SSRF_FORBIDDEN");
      expect(() =>
        normalizeBitrixWebhookUrl("https://127.0.0.1/rest/1/abc/"),
      ).toThrow("SSRF_FORBIDDEN");
      expect(() =>
        normalizeBitrixWebhookUrl("https://192.168.1.50/rest/1/abc/"),
      ).toThrow("SSRF_FORBIDDEN");
      expect(() =>
        normalizeBitrixWebhookUrl("https://10.0.0.1/rest/1/abc/"),
      ).toThrow("SSRF_FORBIDDEN");
    });

    it("rejects empty string", () => {
      expect(() => normalizeBitrixWebhookUrl("   ")).toThrow("не может быть пустым");
    });
  });
});
