import { describe, expect, it, vi, beforeEach } from "vitest";
import { bitrix24Service } from "../modules/integrations/bitrix24/bitrix24.service.js";
import * as dbClient from "../db/client.js";

describe("Bitrix24 Sync Logs and Retry Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getSyncLogs", () => {
    it("returns formatted DTO list and total count for tenant", async () => {
      vi.spyOn(dbClient, "queryOne").mockResolvedValueOnce({ count: "2" });
      vi.spyOn(dbClient, "query").mockResolvedValueOnce([
        {
          id: "log-1",
          deal_id: "deal-1",
          deal_title: "Заявка с сайта",
          contact_name: "Иван Иванов",
          contact_phone: "+79001112233",
          status: "success",
          bitrix_lead_id: "1002443",
          response_status: 200,
          error_message: null,
          lead_source: "site_widget",
          widget_name: "МФЦ Виджет",
          request_payload: { fields: { TITLE: "Заявка" } },
          response_body: { result: 1002443 },
          created_at: new Date("2026-11-10T09:57:09.571Z"),
        },
        {
          id: "log-2",
          deal_id: "deal-2",
          deal_title: "Входящий звонок",
          contact_name: "Петр",
          contact_phone: "+79112223344",
          status: "error",
          bitrix_lead_id: null,
          response_status: 400,
          error_message: "INVALID_URL",
          lead_source: "manual",
          widget_name: null,
          request_payload: null,
          response_body: { error: "INVALID_URL" },
          created_at: new Date("2026-11-10T10:00:00.000Z"),
        },
      ]);

      const result = await bitrix24Service.getSyncLogs("test-tenant", 20, 0);

      expect(result.total).toBe(2);
      expect(result.logs).toHaveLength(2);
      const [first, second] = result.logs;
      expect(first?.id).toBe("log-1");
      expect(first?.status).toBe("success");
      expect(first?.bitrix_lead_id).toBe("1002443");
      expect(first?.created_at).toBe("2026-11-10T09:57:09.571Z");
      expect(second?.id).toBe("log-2");
      expect(second?.status).toBe("error");
      expect(second?.error_message).toBe("INVALID_URL");
    });

    it("enforces safe boundary limits for pagination", async () => {
      vi.spyOn(dbClient, "queryOne").mockResolvedValueOnce({ count: "0" });
      const querySpy = vi.spyOn(dbClient, "query").mockResolvedValueOnce([]);

      await bitrix24Service.getSyncLogs("test-tenant", 500, -10);

      // limit clamped to 100, offset clamped to 0
      expect(querySpy).toHaveBeenCalledWith(expect.any(String), [
        "test-tenant",
        100,
        0,
      ]);
    });
  });

  describe("retryLeadSync", () => {
    it("finds deal by log id, extracts contacts and triggers sendLead", async () => {
      vi.spyOn(dbClient, "queryOne")
        .mockResolvedValueOnce({ deal_id: "deal-uuid-1" }) // log lookup
        .mockResolvedValueOnce({
          id: "deal-uuid-1",
          tenant_id: "tenant-1",
          title: "Заявка с сайта",
          description: "Суть обращения",
          budget: 50000,
          currency: "RUB",
          custom_fields: { ym_uid: "12345678" },
          source_metadata: { geo: { city: "Москва" } },
          source_widget_id: "widget-uuid-1",
          contact_id: "contact-uuid-1",
          contact_first_name: "Алексей",
          contact_last_name: "Смирнов",
          contact_phone: "+79998887766",
          contact_email: "alex@mail.ru",
          contact_channel: "webchat",
          tenant_name: "Банкротство",
          tenant_slug: "bankrotstvo",
        }); // deal lookup

      const sendLeadSpy = vi
        .spyOn(bitrix24Service, "sendLead")
        .mockResolvedValueOnce({ success: true, leadId: 1002445 });

      const res = await bitrix24Service.retryLeadSync("tenant-1", "log-uuid-1");

      expect(res.success).toBe(true);
      expect(res.leadId).toBe(1002445);
      expect(sendLeadSpy).toHaveBeenCalledWith("tenant-1", expect.objectContaining({
        leadId: "deal-uuid-1",
        title: "Заявка с сайта",
        contactName: "Алексей Смирнов",
        phone: "+79998887766",
        email: "alex@mail.ru",
        yaClientId: "12345678",
      }));
    });

    it("throws 404 AppError if deal is not found", async () => {
      vi.spyOn(dbClient, "queryOne")
        .mockResolvedValueOnce({ deal_id: "non-existent-deal" })
        .mockResolvedValueOnce(null);

      await expect(
        bitrix24Service.retryLeadSync("tenant-1", "log-uuid-1"),
      ).rejects.toThrow("Сделка не найдена для повторной отправки в Битрикс24");
    });
  });
});
