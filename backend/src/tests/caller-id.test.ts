import { describe, expect, it, vi } from "vitest";
import { ContactsService } from "../modules/crm/contacts/contacts.service.js";
import * as dbClient from "../db/client.js";

describe("Caller ID Lookup — Phone Normalization & Contact Matching", () => {
  it("возвращает found: false для слишком короткого или пустого номера", async () => {
    const service = new ContactsService();
    const res = await service.lookupByPhone("test-tenant", "12");

    expect(res.found).toBe(false);
    expect(res.contact).toBeNull();
  });

  it("корректно нормализует российский номер и запрашивает последние 10 цифр", async () => {
    const service = new ContactsService();

    let capturedParams: readonly dbClient.SqlParam[] = [];

    vi.spyOn(dbClient, "queryOne").mockImplementation(async (_sql, params) => {
      capturedParams = params || [];
      return {
        id: "c1111111-1111-1111-1111-111111111111",
        first_name: "Иван",
        last_name: "Иванов",
        middle_name: "Сергеевич",
        phone: "+7 (999) 123-45-67",
        job_title: "Генеральный директор",
        company_name: "ООО Вектор",
        company_id: null,
        company_title: null,
        active_deal_id: "d1111111-1111-1111-1111-111111111111",
        active_deal_title: "Поставка оборудования",
        active_deal_budget: "150000",
        active_deal_currency: "RUB",
        active_deal_stage_name: "Согласование договора",
      };
    });

    const res = await service.lookupByPhone("tenant-123", "+7 (999) 123-45-67");

    expect(res.found).toBe(true);
    expect(res.normalizedPhone).toBe("+79991234567");
    expect(capturedParams[0]).toBe("tenant-123");
    expect(capturedParams[1]).toBe("9991234567"); // последние 10 цифр для быстрого поиска

    expect(res.contact).not.toBeNull();
    expect(res.contact?.fullName).toBe("Иванов Иван Сергеевич");
    expect(res.contact?.companyName).toBe("ООО Вектор");
    expect(res.contact?.activeDeal?.title).toBe("Поставка оборудования");
    expect(res.contact?.activeDeal?.budget).toBe(150000);
    expect(res.contact?.activeDeal?.stageName).toBe("Согласование договора");
    expect(res.contact?.crmUrl).toContain("/crm/contacts/c1111111-1111-1111-1111-111111111111");

    vi.restoreAllMocks();
  });
});
