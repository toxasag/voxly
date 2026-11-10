import { describe, expect, it, vi } from "vitest";
import {
  BITRIX24_SOURCE_ID,
  normalizeBitrixWebhookUrl,
  normalizeLeadSource,
  resolveLeadSource,
  bitrix24Service,
} from "../modules/integrations/bitrix24/bitrix24.service.js";
import { LEAD_SOURCES } from "../modules/integrations/bitrix24/bitrix24.types.js";

describe("Bitrix24 Lead Connector", () => {
  it("enforces SOURCE_ID to strictly equal 'UC_VWN1ZK'", () => {
    expect(BITRIX24_SOURCE_ID).toBe("UC_VWN1ZK");
  });

  it("exports canonical 6 lead sources catalog", () => {
    expect(LEAD_SOURCES).toEqual([
      "whatsapp",
      "max",
      "telegram_personal",
      "telegram_bot",
      "site_widget",
      "manual",
    ]);
  });

  describe("normalizeLeadSource", () => {
    it("maps standard and synonym values to canonical lead sources", () => {
      expect(normalizeLeadSource("whatsapp")).toBe("whatsapp");
      expect(normalizeLeadSource("WA")).toBe("whatsapp");
      expect(normalizeLeadSource("max")).toBe("max");
      expect(normalizeLeadSource("rumax")).toBe("max");
      expect(normalizeLeadSource("telegram_bot")).toBe("telegram_bot");
      expect(normalizeLeadSource("tg_bot")).toBe("telegram_bot");
      expect(normalizeLeadSource("bot")).toBe("telegram_bot");
      expect(normalizeLeadSource("telegram_personal")).toBe("telegram_personal");
      expect(normalizeLeadSource("telegram")).toBe("telegram_personal");
      expect(normalizeLeadSource("site_widget")).toBe("site_widget");
      expect(normalizeLeadSource("webchat")).toBe("site_widget");
      expect(normalizeLeadSource("widget")).toBe("site_widget");
      expect(normalizeLeadSource("manual")).toBe("manual");
      expect(normalizeLeadSource("manager")).toBe("manual");
      expect(normalizeLeadSource("crm")).toBe("manual");
      expect(normalizeLeadSource("unknown_garbage")).toBeNull();
      expect(normalizeLeadSource("")).toBeNull();
      expect(normalizeLeadSource(null)).toBeNull();
    });
  });

  describe("resolveLeadSource", () => {
    it("resolves from explicit source string", () => {
      expect(resolveLeadSource({ source: "whatsapp" })).toBe("whatsapp");
      expect(resolveLeadSource({ source: "telegram_bot" })).toBe("telegram_bot");
      expect(resolveLeadSource({ source: "manual" })).toBe("manual");
    });

    it("resolves from site widget id or site metadata", () => {
      expect(resolveLeadSource({ sourceWidgetId: "123e4567-e89b-12d3-a456-426614174000" })).toBe("site_widget");
      expect(resolveLeadSource({ sourceMetadata: { site_url: "https://example.com" } })).toBe("site_widget");
      expect(resolveLeadSource({ contactChannel: "webchat" })).toBe("site_widget");
    });

    it("resolves bot vs personal telegram accurately", () => {
      expect(resolveLeadSource({ sourceMetadata: { channel: "telegram", is_bot: true } })).toBe("telegram_bot");
      expect(resolveLeadSource({ contactChannel: "telegram", sourceMetadata: { type: "bot" } })).toBe("telegram_bot");
      expect(resolveLeadSource({ contactChannel: "telegram" })).toBe("telegram_personal");
    });

    it("falls back to manual when no messenger or widget is attached", () => {
      expect(resolveLeadSource({})).toBe("manual");
    });
  });

  describe("allowed_sources filtering in sendLead", () => {
    it("skips lead when source is not in allowed_sources and returns reason", async () => {
      vi.spyOn(bitrix24Service, "getConfig").mockResolvedValueOnce({
        webhook_url: "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json",
        is_enabled: true,
        allowed_sources: ["whatsapp", "site_widget"],
        selected_widget_ids: [],
        custom_source_id: "UC_VWN1ZK",
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      });

      const result = await bitrix24Service.sendLead("test-tenant-id", {
        leadId: "lead-manual-1",
        title: "Заявка вручную",
        source: "manual",
      });

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("SOURCE_NOT_ALLOWED: manual");
    });

    it("allows lead when source matches allowed_sources", async () => {
      vi.spyOn(bitrix24Service, "getConfig").mockResolvedValueOnce({
        webhook_url: "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json",
        is_enabled: true,
        allowed_sources: ["whatsapp", "manual"],
        selected_widget_ids: [],
        custom_source_id: "UC_VWN1ZK",
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      });

      // Mock global fetch to avoid real network call
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 999123 }),
      } as unknown as Response);

      try {
        const result = await bitrix24Service.sendLead("test-tenant-id", {
          leadId: "lead-allowed-1",
          title: "Заявка WhatsApp",
          source: "whatsapp",
          phone: "+79991112233",
        });

        expect(result.success).toBe(true);
        expect(result.leadId).toBe(999123);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("allows all sources when allowed_sources is empty (backwards compatibility)", async () => {
      vi.spyOn(bitrix24Service, "getConfig").mockResolvedValueOnce({
        webhook_url: "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json",
        is_enabled: true,
        allowed_sources: [],
        selected_widget_ids: [],
        custom_source_id: "UC_VWN1ZK",
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 777123 }),
      } as unknown as Response);

      try {
        const result = await bitrix24Service.sendLead("test-tenant-id", {
          leadId: "lead-any-1",
          title: "Заявка из Макс",
          source: "max",
        });

        expect(result.success).toBe(true);
        expect(result.leadId).toBe(777123);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("skips widget lead when widgetId is not in selected_widget_ids", async () => {
      vi.spyOn(bitrix24Service, "getConfig").mockResolvedValueOnce({
        webhook_url: "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json",
        is_enabled: true,
        allowed_sources: ["site_widget"],
        selected_widget_ids: ["widget-allowed-uuid"],
        custom_source_id: "CUSTOM_SRC",
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      });

      const result = await bitrix24Service.sendLead("test-tenant-id", {
        leadId: "lead-widget-skipped",
        title: "Заявка с другого виджета",
        source: "site_widget",
        sourceWidgetId: "widget-other-uuid",
      });

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("WIDGET_NOT_ALLOWED");
    });

    it("uses custom_source_id, maps UTM tags and builds enriched comments", async () => {
      vi.spyOn(bitrix24Service, "getConfig").mockResolvedValueOnce({
        webhook_url: "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.add.json",
        is_enabled: true,
        allowed_sources: [],
        selected_widget_ids: [],
        custom_source_id: "MY_CUSTOM_SOURCE",
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      });

      let capturedPayload: unknown = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementationOnce(async (_url, init) => {
        capturedPayload = JSON.parse(init.body as string);
        return {
          ok: true,
          json: async () => ({ result: 888123 }),
        } as unknown as Response;
      });

      try {
        const result = await bitrix24Service.sendLead("test-tenant-id", {
          leadId: "lead-enriched-1",
          title: "Заявка на консультацию",
          contactName: "Алексей Иванов",
          phone: "+79991234567",
          email: "alex@example.com",
          yaClientId: "1234567890",
          comments: "Хочу списать долги",
          utmTags: {
            utm_source: "yandex",
            utm_medium: "cpc",
            utm_campaign: "brand_campaign",
            utm_content: "banner_1",
            utm_term: "банкротство",
          },
          sourceMetadata: {
            page: { url: "https://site.ru/page" },
            referrer: "https://yandex.ru/search",
            network: { ip: "185.12.34.56", city: "Омск", country: "Россия" },
            device: { browser: "Chrome", os: "Windows", deviceType: "desktop" },
            visitCount: 3,
          },
        });

        expect(result.success).toBe(true);
        expect(capturedPayload).toBeDefined();

        const p = capturedPayload as { fields: Record<string, unknown> };
        expect(p.fields.SOURCE_ID).toBe("MY_CUSTOM_SOURCE");
        expect(p.fields.UTM_SOURCE).toBe("yandex");
        expect(p.fields.UTM_MEDIUM).toBe("cpc");
        expect(p.fields.UTM_CAMPAIGN).toBe("brand_campaign");
        expect(p.fields.UF_CRM_YA_CID).toBe("1234567890");
        expect(String(p.fields.COMMENTS)).toContain("Хочу списать долги");
        expect(String(p.fields.COMMENTS)).toContain("Геолокация: Омск, Россия");
        expect(String(p.fields.COMMENTS)).toContain("IP-адрес: 185.12.34.56");
        expect(String(p.fields.COMMENTS)).toContain("Устройство: desktop / Chrome / Windows");
        expect(String(p.fields.COMMENTS)).toContain("Визитов на сайте: 3");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
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

    it("rejects urls without /rest/ path", () => {
      expect(() =>
        normalizeBitrixWebhookUrl("https://bankirromsk.ru/webhook/261/token/"),
      ).toThrow("INVALID_REST_PATH");
    });

    it("rejects incomplete rest path missing user id or token (e.g. /rest/token)", () => {
      expect(() =>
        normalizeBitrixWebhookUrl("https://bankirromsk.ru/rest/x8ci14yw7f8xzi3"),
      ).toThrow("INVALID_REST_PATH");
    });

    it("supports custom method such as crm.lead.fields.json", () => {
      const input = "https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/";
      const result = normalizeBitrixWebhookUrl(input, "crm.lead.fields.json");
      expect(result).toBe("https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/crm.lead.fields.json");
    });
  });
});
