import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepairsService } from "../modules/repairs/repairs.service.js";
import type { CreateRepairPayload } from "../modules/repairs/repairs.types.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
      queryOneOrThrow: (...args: unknown[]) => mockTxQueryOneOrThrow(...args),
    }),
}));

vi.mock("../tenant/tenant-defaults.js", () => ({
  ensureTenantDefaults: vi.fn().mockResolvedValue({}),
}));

describe("RepairsService Client & Deal Integration", () => {
  let service: RepairsService;
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const author = { id: "22222222-2222-2222-2222-222222222222", name: "Master Alex" };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RepairsService();
  });

  it("links repair to existing active deal when deal_id is provided (Mode 1)", async () => {
    const dealId = "33333333-3333-3333-3333-333333333333";
    const contactId = "44444444-4444-4444-4444-444444444444";
    const repairOrderId = "55555555-5555-5555-5555-555555555555";

    // 1. allocateTicketNumber: queryOneOrThrow -> counter row
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ last_number: 1 });
    // 2. find existing deal: queryOne -> deal row
    mockTxQueryOne.mockResolvedValueOnce({
      id: dealId,
      contact_id: contactId,
      company_id: "66666666-6666-6666-6666-666666666666",
    });
    // 3. insert repair_order: queryOneOrThrow -> row
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: repairOrderId,
      tenant_id: tenantId,
      ticket_number: "ЗН-2026-0001",
      deal_id: dealId,
      customer_id: contactId,
      customer_name: "Иван Петров",
      customer_phone: "+79991234567",
      equipment_type: "phone",
      equipment_brand: "Apple",
      equipment_model: "iPhone 15",
      equipment_serial: "SERIAL123",
      package_contents: "Кабель",
      appearance: "Отличное",
      defect_description: "Разбит экран",
      defect_photos: [],
      status: "intake",
      priority: "normal",
      master_id: author.id,
      master_name: author.name,
      estimated_cost: "5000",
      final_cost: null,
      notes: "",
      diagnostics: null,
      received_at: new Date(),
      completed_at: null,
      delivered_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const payload: CreateRepairPayload = {
      deal_id: dealId,
      customer_name: "Иван Петров",
      customer_phone: "+79991234567",
      equipment_type: "phone",
      equipment_brand: "Apple",
      equipment_model: "iPhone 15",
      defect_description: "Разбит экран при падении",
      master_id: author.id,
      master_name: author.name,
      priority: "normal",
      estimated_cost: 5000,
    };

    const res = await service.create(tenantId, author, payload);

    expect(res.id).toBe(repairOrderId);
    expect(res.dealId).toBe(dealId);
    expect(res.customerId).toBe(contactId);
  });

  it("deduplicates contact by phone and creates CRM deal if not selected (Mode 2)", async () => {
    const existingContactId = "44444444-4444-4444-4444-444444444444";
    const pipelineId = "77777777-7777-7777-7777-777777777777";
    const stageId = "88888888-8888-8888-8888-888888888888";
    const newDealId = "99999999-9999-9999-9999-999999999999";
    const repairOrderId = "55555555-5555-5555-5555-555555555555";

    // 1. allocateTicketNumber: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ last_number: 2 });
    // 2. find existing contact by phone: queryOne
    mockTxQueryOne.mockResolvedValueOnce({
      id: existingContactId,
      company_id: null,
    });
    // 3. find default pipeline: queryOne
    mockTxQueryOne.mockResolvedValueOnce({ id: pipelineId });
    // 4. find stage: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: stageId });
    // 5. insert deal: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: newDealId });
    // 6. insert repair_order: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: repairOrderId,
      tenant_id: tenantId,
      ticket_number: "ЗН-2026-0002",
      deal_id: newDealId,
      customer_id: existingContactId,
      customer_name: "Сергей Смирнов",
      customer_phone: "+79998887766",
      equipment_type: "laptop",
      equipment_brand: "Lenovo",
      equipment_model: "ThinkPad X1",
      equipment_serial: "",
      package_contents: "",
      appearance: "",
      defect_description: "Не включается",
      defect_photos: [],
      status: "intake",
      priority: "urgent",
      master_id: author.id,
      master_name: author.name,
      estimated_cost: "12000",
      final_cost: null,
      notes: "",
      diagnostics: null,
      received_at: new Date(),
      completed_at: null,
      delivered_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const payload: CreateRepairPayload = {
      customer_name: "Сергей Смирнов",
      customer_phone: "+7 (999) 888-77-66",
      equipment_type: "laptop",
      equipment_brand: "Lenovo",
      equipment_model: "ThinkPad X1",
      defect_description: "Не включается после залития",
      master_id: author.id,
      master_name: author.name,
      priority: "urgent",
      estimated_cost: 12000,
    };

    const res = await service.create(tenantId, author, payload);

    expect(res.id).toBe(repairOrderId);
    expect(res.dealId).toBe(newDealId);
    expect(res.customerId).toBe(existingContactId);
  });

  it("handles company requisites and deduplication by INN (Mode 4)", async () => {
    const existingCompanyId = "66666666-6666-6666-6666-666666666666";
    const newContactId = "77777777-7777-7777-7777-777777777777";
    const pipelineId = "88888888-8888-8888-8888-888888888888";
    const stageId = "99999999-9999-9999-9999-999999999999";
    const newDealId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const repairOrderId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // 1. allocateTicketNumber: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ last_number: 3 });
    // 2. find existing company by INN: queryOne
    mockTxQueryOne.mockResolvedValueOnce({ id: existingCompanyId });
    // 3. find existing contact by phone: queryOne (null)
    mockTxQueryOne.mockResolvedValueOnce(null);
    // 4. insert contact: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: newContactId });
    // 5. find default pipeline: queryOne
    mockTxQueryOne.mockResolvedValueOnce({ id: pipelineId });
    // 6. find stage: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: stageId });
    // 7. insert deal: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: newDealId });
    // 8. insert repair_order: queryOneOrThrow
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: repairOrderId,
      tenant_id: tenantId,
      ticket_number: "ЗН-2026-0003",
      deal_id: newDealId,
      customer_id: newContactId,
      customer_name: "Ольга Морозова",
      customer_phone: "+79991112233",
      equipment_type: "printer",
      equipment_brand: "HP",
      equipment_model: "LaserJet Pro",
      equipment_serial: "",
      package_contents: "",
      appearance: "",
      defect_description: "Замятие бумаги",
      defect_photos: [],
      status: "intake",
      priority: "normal",
      master_id: author.id,
      master_name: author.name,
      estimated_cost: "4500",
      final_cost: null,
      notes: "",
      diagnostics: null,
      received_at: new Date(),
      completed_at: null,
      delivered_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const payload: CreateRepairPayload = {
      customer_name: "Ольга Морозова",
      customer_phone: "+79991112233",
      company_name: "ООО Альфа",
      company_inn: "7701234567",
      company_legal_address: "г. Москва, ул. Ленина, д. 1",
      equipment_type: "printer",
      equipment_brand: "HP",
      equipment_model: "LaserJet Pro",
      defect_description: "Постоянное замятие бумаги в лотке 2",
      master_id: author.id,
      master_name: author.name,
      priority: "normal",
      estimated_cost: 4500,
    };

    const res = await service.create(tenantId, author, payload);

    expect(res.id).toBe(repairOrderId);
    expect(res.dealId).toBe(newDealId);
    expect(res.customerId).toBe(newContactId);
  });

  it("clientLookup performs reactive lookup and returns client, company, and active deals", async () => {
    const contactId = "44444444-4444-4444-4444-444444444444";
    const companyId = "66666666-6666-6666-6666-666666666666";

    // 1. queryOne for contact
    mockQueryOne.mockResolvedValueOnce({
      id: contactId,
      first_name: "Иван",
      last_name: "Петров",
      middle_name: "Сергеевич",
      phone: "+79991234567",
      email: "ivan@test.ru",
      company_id: companyId,
      company_name: "ООО Вектор",
    });

    // 2. queryOne for company requisites
    mockQueryOne.mockResolvedValueOnce({
      id: companyId,
      name: "ООО Вектор",
      inn: "7701234567",
      ogrn: "1027700132195",
      bik: "044525225",
      account_number: "40702810000000000000",
      legal_address: "г. Москва",
    });

    // 3. query for active deals
    mockQuery.mockResolvedValueOnce([
      {
        id: "deal-1",
        title: "Ремонт MacBook",
        description: "Замена батареи",
        budget: 12000,
        currency: "RUB",
        stage_id: "s-1",
        stage_name: "В диагностике",
        stage_color: "#4a38f5",
        pipeline_id: "p-1",
        pipeline_name: "Ремонты",
        created_at: new Date("2026-11-01T12:00:00Z"),
        owner_name: "Алексей Мастер",
      },
    ]);

    const result = await service.clientLookup(tenantId, { phone: "+7 (999) 123-45-67" });

    expect(result.found).toBe(true);
    expect(result.client?.id).toBe(contactId);
    expect(result.client?.firstName).toBe("Иван");
    expect(result.company?.inn).toBe("7701234567");
    expect(result.activeDeals.length).toBe(1);
    expect(result.activeDeals[0]?.title).toBe("Ремонт MacBook");
    expect(result.activeDeals[0]?.stageName).toBe("В диагностике");
  });

  it("clientLookup returns not found for empty or unknown params", async () => {
    const emptyResult = await service.clientLookup(tenantId, {});
    expect(emptyResult.found).toBe(false);
    expect(emptyResult.activeDeals).toEqual([]);

    mockQueryOne.mockResolvedValueOnce(null);
    const unknownResult = await service.clientLookup(tenantId, { phone: "+79990000000" });
    expect(unknownResult.found).toBe(false);
    expect(unknownResult.client).toBeNull();
  });

  it("getDictionaries retrieves dictionaries for tenant", async () => {
    mockTxQuery
      .mockResolvedValueOnce([{ name: "Смартфон" }, { name: "Ноутбук" }])
      .mockResolvedValueOnce([{ name: "Apple" }, { name: "Samsung" }])
      .mockResolvedValueOnce([{ name: "iPhone 15" }])
      .mockResolvedValueOnce([{ name: "Обойма" }, { name: "2 АКБ" }])
      .mockResolvedValueOnce([{ name: "Не включается" }]);

    const dicts = await service.getDictionaries(tenantId);
    expect(dicts.types).toEqual(["Смартфон", "Ноутбук"]);
    expect(dicts.brands).toEqual(["Apple", "Samsung"]);
    expect(dicts.models).toEqual(["iPhone 15"]);
    expect(dicts.accessories).toEqual(["Обойма", "2 АКБ"]);
    expect(dicts.malfunctions).toEqual(["Не включается"]);
  });

  it("addDictionaryItem inserts new item into correct table", async () => {
    mockTxQueryOne.mockResolvedValueOnce({
      id: "type-1",
      name: "Планшет",
    });

    const item = await service.addDictionaryItem(tenantId, "type", "Планшет");
    expect(item.name).toBe("Планшет");
    expect(mockTxQueryOne).toHaveBeenCalled();
  });

  it("searchEquipmentBySerial returns equipment and previous repair history", async () => {
    const serial = "R58N90L2AX";

    // 1. query for last order
    mockTxQuery.mockResolvedValueOnce([
      {
        id: "rep-1",
        ticket_number: "ЗН-2026-0010",
        equipment_type: "Смартфон",
        equipment_brand: "Samsung",
        equipment_model: "Galaxy S24",
        equipment_serial: serial,
        package_contents_items: ["Оригинальная коробка"],
        customer_id: "c-1",
        customer_name: "Сергей Васильев",
        customer_phone: "+79998887766",
      },
    ]);

    // 2. query for history
    mockTxQuery.mockResolvedValueOnce([
      {
        id: "rep-1",
        ticket_number: "ЗН-2026-0010",
        received_at: new Date("2026-10-15T10:00:00Z"),
        completed_at: new Date("2026-10-16T12:00:00Z"),
        delivered_at: new Date("2026-10-17T14:00:00Z"),
        status: "delivered",
        defect_description: "Замена батареи",
        malfunctions: ["Быстро разряжается"],
        estimated_cost: "4500",
        final_cost: "4500",
        master_name: "Мастер Иван",
      },
    ]);

    const res = await service.searchEquipmentBySerial(tenantId, serial);
    expect(res.found).toBe(true);
    expect(res.equipment?.serial).toBe(serial);
    expect(res.equipment?.brand).toBe("Samsung");
    expect(res.customer?.name).toBe("Сергей Васильев");
    expect(res.historyCount).toBe(1);
    expect(res.history[0]?.ticketNumber).toBe("ЗН-2026-0010");
  });
});
