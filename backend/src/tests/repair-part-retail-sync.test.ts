import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepairsService } from "../modules/repairs/repairs.service.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

const mockGetSettings = vi.fn();
const mockEstimateFifoUnitCost = vi.fn();
const mockCreatePurchaseRequest = vi.fn();

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

vi.mock("../modules/warehouse/warehouse.service.js", () => ({
  warehouseService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    estimateFifoUnitCost: (...args: unknown[]) => mockEstimateFifoUnitCost(...args),
    createPurchaseRequest: (...args: unknown[]) => mockCreatePurchaseRequest(...args),
  },
}));

vi.mock("../modules/tenant/tenant-defaults.js", () => ({
  ensureTenantDefaults: vi.fn().mockResolvedValue({}),
}));

vi.mock("../modules/crm/enrichment.service.js", () => ({
  CrmEnrichmentService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../modules/crm/deals/deals.service.js", () => ({
  dealsService: {},
}));

describe("RepairsService — sync retail_price to warehouse_items", () => {
  let service: RepairsService;
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const orderId = "22222222-2222-4222-8222-222222222222";
  const warehouseItemId = "33333333-3333-4333-8333-333333333333";
  const partId = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RepairsService();
    mockGetSettings.mockResolvedValue({ allowNegativeStock: true });
    mockEstimateFifoUnitCost.mockResolvedValue({ hasBatches: false, avgUnitCost: 448 });
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue({ status: "intake", total: "1200", deal_id: null });
    mockTxQuery.mockResolvedValue([]);
  });

  it("addPart syncs positive retail_price into warehouse_items for linked item", async () => {
    // assertEditable
    mockQueryOne.mockResolvedValueOnce({ status: "intake" });
    // recentDuplicate check -> null
    mockTxQueryOne.mockResolvedValueOnce(null);
    // INSERT INTO repair_parts
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: partId,
      repair_order_id: orderId,
      warehouse_item_id: warehouseItemId,
      status: "reserved",
      name: "DCCN40 поз.30 Держатель ствола",
      article: "Б/А",
      quantity: 1,
      retail_price: "1200",
      cost_price: "448",
      consumed_at: null,
      cost_source: "manual",
      created_at: new Date().toISOString(),
    });

    const result = await service.addPart(tenantId, orderId, {
      warehouse_item_id: warehouseItemId,
      name: "DCCN40 поз.30 Держатель ствола",
      article: "Б/А",
      quantity: 1,
      retail_price: 1200,
      cost_price: 448,
      status: "reserved",
      add_to_purchase_request: false,
      save_to_catalog: false,
      idempotency_key: undefined,
    });

    expect(result.retailPrice).toBe(1200);

    const updateWhCall = mockTxQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE warehouse_items"),
    );
    expect(updateWhCall).toBeDefined();
    expect(updateWhCall?.[1]).toEqual([1200, tenantId, warehouseItemId]);
  });

  it("addPart does NOT overwrite warehouse_items.retail_price when retail_price is 0", async () => {
    mockQueryOne.mockResolvedValueOnce({ status: "intake" });
    mockTxQueryOne.mockResolvedValueOnce(null);
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: partId,
      repair_order_id: orderId,
      warehouse_item_id: warehouseItemId,
      status: "reserved",
      name: "Гарантийная деталь",
      article: "Б/А",
      quantity: 1,
      retail_price: "0",
      cost_price: "300",
      consumed_at: null,
      cost_source: "manual",
      created_at: new Date().toISOString(),
    });

    await service.addPart(tenantId, orderId, {
      warehouse_item_id: warehouseItemId,
      name: "Гарантийная деталь",
      article: "Б/А",
      quantity: 1,
      retail_price: 0,
      cost_price: 300,
      status: "reserved",
      add_to_purchase_request: false,
      save_to_catalog: false,
      idempotency_key: undefined,
    });

    const updateWhCall = mockTxQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE warehouse_items"),
    );
    expect(updateWhCall).toBeUndefined();
  });

  it("addPart matches warehouse item by exact name when SKU is Б/А and syncs retail_price", async () => {
    mockQueryOne.mockResolvedValueOnce({ status: "intake" });
    // recentDuplicate -> null
    mockTxQueryOne.mockResolvedValueOnce(null);
    // exact name lookup -> matched warehouse item
    mockTxQueryOne.mockResolvedValueOnce({ id: warehouseItemId });
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: partId,
      repair_order_id: orderId,
      warehouse_item_id: warehouseItemId,
      status: "reserved",
      name: "DCCN40 поз.27 Скоба",
      article: "Б/А",
      quantity: 1,
      retail_price: "250",
      cost_price: "35",
      consumed_at: null,
      cost_source: "manual",
      created_at: new Date().toISOString(),
    });

    await service.addPart(tenantId, orderId, {
      warehouse_item_id: undefined,
      name: "DCCN40 поз.27 Скоба",
      article: "Б/А",
      quantity: 1,
      retail_price: 250,
      cost_price: 35,
      status: "reserved",
      add_to_purchase_request: false,
      save_to_catalog: false,
      idempotency_key: undefined,
    });

    const updateWhCall = mockTxQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE warehouse_items"),
    );
    expect(updateWhCall).toBeDefined();
    expect(updateWhCall?.[1]).toEqual([250, tenantId, warehouseItemId]);
  });

  it("updatePart syncs positive retail_price into warehouse_items", async () => {
    mockQueryOne.mockResolvedValueOnce({ status: "intake" });
    mockTxQueryOne.mockResolvedValueOnce({
      id: partId,
      repair_order_id: orderId,
      warehouse_item_id: warehouseItemId,
      status: "reserved",
      name: "DCCN40 поз.61 Левая часть корпуса",
      article: "Б/А",
      quantity: 1,
      retail_price: "1500",
      cost_price: "672",
      consumed_at: null,
      cost_source: "manual",
      created_at: new Date().toISOString(),
    });

    const updated = await service.updatePart(tenantId, orderId, partId, {
      retail_price: 1500,
    });

    expect(updated?.retailPrice).toBe(1500);
    const updateWhCall = mockTxQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE warehouse_items"),
    );
    expect(updateWhCall).toBeDefined();
    expect(updateWhCall?.[1]).toEqual([1500, tenantId, warehouseItemId]);
  });

  it("updatePart skips warehouse sync when retail_price is 0", async () => {
    mockQueryOne.mockResolvedValueOnce({ status: "intake" });
    mockTxQueryOne.mockResolvedValueOnce({
      id: partId,
      repair_order_id: orderId,
      warehouse_item_id: warehouseItemId,
      status: "reserved",
      name: "DCCN40 поз.61 Левая часть корпуса",
      article: "Б/А",
      quantity: 1,
      retail_price: "0",
      cost_price: "672",
      consumed_at: null,
      cost_source: "manual",
      created_at: new Date().toISOString(),
    });

    await service.updatePart(tenantId, orderId, partId, {
      retail_price: 0,
    });

    const updateWhCall = mockTxQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("UPDATE warehouse_items"),
    );
    expect(updateWhCall).toBeUndefined();
  });
});
