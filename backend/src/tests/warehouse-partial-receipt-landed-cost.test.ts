import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLandedCost, type LandedCostLineAllocation } from "../modules/warehouse/landed-cost.utils.js";
import { WarehouseService } from "../modules/warehouse/warehouse.service.js";
import { FinanceService } from "../modules/finance/finance.service.js";
import { ValidationError } from "../plugins/errorHandler.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockQueryOneOrThrow = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  queryOneOrThrow: (...args: unknown[]) => mockQueryOneOrThrow(...args),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
      queryOneOrThrow: (...args: unknown[]) => mockTxQueryOneOrThrow(...args),
    }),
}));

function byId(items: LandedCostLineAllocation[]): Map<string, LandedCostLineAllocation> {
  return new Map(items.map((item) => [item.id, item]));
}

describe("allocateLandedCost — распределение доп. расходов на себестоимость партий", () => {
  it("by_value распределяет пропорционально стоимости и относит остаток копеек на последнюю строку", () => {
    const res = byId(
      allocateLandedCost(
        [
          { id: "a", quantity: 1, baseUnitPrice: 100 },
          { id: "b", quantity: 1, baseUnitPrice: 100 },
          { id: "c", quantity: 1, baseUnitPrice: 100 },
        ],
        100,
        "by_value",
      ),
    );

    expect(res.get("a")?.allocatedExtraCost).toBe(33.33);
    expect(res.get("b")?.allocatedExtraCost).toBe(33.33);
    expect(res.get("c")?.allocatedExtraCost).toBe(33.34);

    const total =
      (res.get("a")?.allocatedExtraCost ?? 0) +
      (res.get("b")?.allocatedExtraCost ?? 0) +
      (res.get("c")?.allocatedExtraCost ?? 0);
    expect(Math.round(total * 100) / 100).toBe(100);
    expect(res.get("c")?.effectiveUnitPrice).toBe(133.34);
  });

  it("by_value распределяет неравные строки пропорционально сумме (qty * price)", () => {
    const res = byId(
      allocateLandedCost(
        [
          { id: "cheap", quantity: 2, baseUnitPrice: 100 },
          { id: "expensive", quantity: 2, baseUnitPrice: 400 },
        ],
        500,
        "by_value",
      ),
    );

    expect(res.get("cheap")?.allocatedExtraCost).toBe(100);
    expect(res.get("cheap")?.unitLandedCost).toBe(50);
    expect(res.get("cheap")?.effectiveUnitPrice).toBe(150);

    expect(res.get("expensive")?.allocatedExtraCost).toBe(400);
    expect(res.get("expensive")?.unitLandedCost).toBe(200);
    expect(res.get("expensive")?.effectiveUnitPrice).toBe(600);
  });

  it("by_quantity распределяет пропорционально числу единиц", () => {
    const res = byId(
      allocateLandedCost(
        [
          { id: "l1", quantity: 4, baseUnitPrice: 47 },
          { id: "l2", quantity: 6, baseUnitPrice: 1000 },
        ],
        200,
        "by_quantity",
      ),
    );

    expect(res.get("l1")?.allocatedExtraCost).toBe(80);
    expect(res.get("l1")?.unitLandedCost).toBe(20);
    expect(res.get("l1")?.effectiveUnitPrice).toBe(67);
    expect(res.get("l2")?.allocatedExtraCost).toBe(120);
    expect(res.get("l2")?.effectiveUnitPrice).toBe(1020);
  });

  it("by_value при нулевых ценах автоматически переключается на by_quantity", () => {
    const res = byId(
      allocateLandedCost(
        [
          { id: "z1", quantity: 1, baseUnitPrice: 0 },
          { id: "z2", quantity: 3, baseUnitPrice: 0 },
        ],
        400,
        "by_value",
      ),
    );

    expect(res.get("z1")?.allocatedExtraCost).toBe(100);
    expect(res.get("z2")?.allocatedExtraCost).toBe(300);
  });

  it("manual принимает точное распределение и отклоняет расхождение > 1 копейки", () => {
    const ok = byId(
      allocateLandedCost(
        [
          { id: "m1", quantity: 2, baseUnitPrice: 50, manualExtraCost: 150 },
          { id: "m2", quantity: 1, baseUnitPrice: 100, manualExtraCost: 50 },
        ],
        200,
        "manual",
      ),
    );
    expect(ok.get("m1")?.effectiveUnitPrice).toBe(125);
    expect(ok.get("m2")?.effectiveUnitPrice).toBe(150);

    expect(() =>
      allocateLandedCost(
        [
          { id: "m1", quantity: 2, baseUnitPrice: 50, manualExtraCost: 100 },
          { id: "m2", quantity: 1, baseUnitPrice: 100, manualExtraCost: 50 },
        ],
        200,
        "manual",
      ),
    ).toThrow(ValidationError);
  });
});

describe("Частичное оприходование и Landed Cost в WarehouseService / FinanceService", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";
  const orderId = "33333333-3333-3333-3333-333333333333";
  const orderItemId = "33333333-3333-3333-3333-333333333334";
  const itemId = "44444444-4444-4444-4444-444444444444";
  const receiptId = "55555555-5555-5555-5555-555555555555";
  const batchId = "66666666-6666-6666-6666-666666666666";
  const accountId = "77777777-7777-7777-7777-777777777777";
  const categoryId = "88888888-8888-8888-8888-888888888888";
  const extraTxId = "99999999-9999-9999-9999-999999999999";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("частичная приёмка 4 из 10 шт + Курьер 200 ₽: статус partially_received, партия по 97 ₽ и расход с is_capitalized_cost = true", async () => {
    const warehouse = new WarehouseService();
    vi.spyOn(warehouse, "getSupplierOrder").mockResolvedValue({
      id: orderId,
      orderNumber: "ЗП-2026-0001",
      supplierName: "Ozon",
      supplierCompanyId: null,
      status: "partially_received",
      totalAmount: 470,
      cashAccountId: accountId,
      financeTransactionId: null,
      notes: "",
      paidAt: "2026-11-24T17:46:00.000Z",
      receivedAt: null,
      createdBy: userId,
      createdByName: "remtoua",
      items: [],
      orderedQuantityTotal: 10,
      receivedQuantityTotal: 4,
      extraCostsTotal: 200,
      receipts: [],
      createdAt: "2026-11-24T17:46:00.000Z",
      updatedAt: "2026-11-24T18:00:00.000Z",
    });

    const recordedSql: { sql: string; params?: unknown[] }[] = [];

    mockTxQueryOneOrThrow.mockImplementation((sql: string, params?: unknown[]) => {
      recordedSql.push({ sql, params });
      if (sql.includes("FROM supplier_orders") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({
          id: orderId,
          tenant_id: tenantId,
          order_number: "ЗП-2026-0001",
          supplier_name: "Ozon",
          supplier_company_id: null,
          status: "paid",
          total_amount: "470",
          cash_account_id: accountId,
          finance_transaction_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          notes: "",
          paid_at: "2026-11-24T17:46:00.000Z",
          received_at: null,
          created_by: userId,
          created_at: "2026-11-24T17:46:00.000Z",
          updated_at: "2026-11-24T17:46:00.000Z",
        });
      }
      if (sql.includes("INSERT INTO supplier_order_receipts")) {
        return Promise.resolve({
          id: receiptId,
          tenant_id: tenantId,
          supplier_order_id: orderId,
          receipt_number: "ЗП-2026-0001-П1",
          allocation_method: "by_value",
          extra_costs_total: "200",
          notes: "Часть 1",
          created_by: userId,
          created_at: "2026-11-24T18:00:00.000Z",
        });
      }
      if (sql.includes("INSERT INTO transactions")) {
        return Promise.resolve({ id: extraTxId });
      }
      if (sql.includes("INSERT INTO warehouse_batches")) {
        return Promise.resolve({ id: batchId });
      }
      return Promise.resolve({});
    });

    mockTxQueryOne.mockImplementation((sql: string, params?: unknown[]) => {
      recordedSql.push({ sql, params });
      if (sql.includes("COUNT(*)::text AS cnt FROM supplier_order_receipts")) {
        return Promise.resolve({ cnt: "0" });
      }
      if (sql.includes("FROM finance_categories") && sql.includes("id = $2")) {
        return Promise.resolve({ id: categoryId, name: "Доставка и логистика" });
      }
      if (sql.includes("SELECT id FROM warehouse_items WHERE tenant_id = $1 AND id = $2")) {
        return Promise.resolve({ id: itemId });
      }
      return Promise.resolve(null);
    });

    mockTxQuery.mockImplementation((sql: string, params?: unknown[]) => {
      recordedSql.push({ sql, params });
      if (sql.includes("FROM supplier_order_items") && sql.includes("FOR UPDATE")) {
        return Promise.resolve([
          {
            id: orderItemId,
            tenant_id: tenantId,
            supplier_order_id: orderId,
            purchase_request_id: null,
            item_id: itemId,
            item_name: "Резистор 10к",
            sku: "R-10K",
            requested_quantity: "0",
            extra_quantity: "10",
            quantity: "10",
            received_quantity: "0",
            unit: "шт",
            price: "47",
            total_price: "470",
            repair_orders: "",
            created_at: "2026-11-24T17:46:00.000Z",
          },
        ]);
      }
      if (sql.includes("AS remaining") && sql.includes("FROM supplier_order_items")) {
        return Promise.resolve([{ remaining: "6" }]);
      }
      return Promise.resolve([]);
    });

    const result = await warehouse.createReceiptFromSupplierOrder(
      tenantId,
      orderId,
      userId,
      {
        mark_paid: false,
        items: [{ supplier_order_item_id: orderItemId, quantity: 4 }],
        allocation_method: "by_value",
        extra_costs: [
          {
            description: "Курьер",
            amount: 200,
            category_id: categoryId,
            cash_account_id: accountId,
          },
        ],
        comment: "Часть 1",
      },
    );

    expect(result.batchesCreated).toBe(1);
    expect(result.order.status).toBe("partially_received");

    // 1. Проверяем создание партии с effectiveUnitPrice = 47 + 50 = 97
    const batchInsert = recordedSql.find((q) => q.sql.includes("INSERT INTO warehouse_batches"));
    expect(batchInsert).toBeDefined();
    expect(batchInsert?.params).toEqual(
      expect.arrayContaining([97, 47, 50, 200, 4]),
    );

    // 2. Проверяем создание отдельной транзакции доп. расхода с is_capitalized_cost = true и created_by = userId
    const txInsert = recordedSql.find((q) => q.sql.includes("INSERT INTO transactions"));
    expect(txInsert).toBeDefined();
    expect(txInsert?.sql).toContain("is_capitalized_cost");
    expect(txInsert?.sql).toContain("supplier_order_receipt_id");
    expect(txInsert?.params).toEqual(
      expect.arrayContaining([tenantId, accountId, categoryId, userId, orderId, receiptId, 200]),
    );

    // 3. Проверяем обновление статуса заказа на partially_received без смешанного типа параметра $1
    const statusUpdate = recordedSql.find(
      (q) =>
        q.sql.includes("UPDATE supplier_orders") &&
        q.sql.includes("SET status = 'partially_received'"),
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate?.sql).not.toContain("CASE WHEN $1");
    expect(statusUpdate?.params).toEqual([tenantId, orderId]);
  });

  it("отклоняет переприёмку (quantity > remaining) с ValidationError", async () => {
    const warehouse = new WarehouseService();

    mockTxQueryOneOrThrow.mockImplementation((sql: string) => {
      if (sql.includes("FROM supplier_orders") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({
          id: orderId,
          tenant_id: tenantId,
          order_number: "ЗП-2026-0001",
          supplier_name: "Ozon",
          supplier_company_id: null,
          status: "partially_received",
          total_amount: "470",
          cash_account_id: accountId,
          finance_transaction_id: null,
          notes: "",
          paid_at: "2026-11-24T17:46:00.000Z",
          received_at: null,
          created_by: userId,
          created_at: "2026-11-24T17:46:00.000Z",
          updated_at: "2026-11-24T18:00:00.000Z",
        });
      }
      return Promise.resolve({});
    });

    mockTxQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM supplier_order_items") && sql.includes("FOR UPDATE")) {
        return Promise.resolve([
          {
            id: orderItemId,
            tenant_id: tenantId,
            supplier_order_id: orderId,
            purchase_request_id: null,
            item_id: itemId,
            item_name: "Резистор 10к",
            sku: "R-10K",
            requested_quantity: "0",
            extra_quantity: "10",
            quantity: "10",
            received_quantity: "4",
            unit: "шт",
            price: "47",
            total_price: "470",
            repair_orders: "",
            created_at: "2026-11-24T17:46:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await expect(
      warehouse.createReceiptFromSupplierOrder(
        tenantId,
        orderId,
        userId,
        {
          mark_paid: false,
          allocation_method: "by_value",
          extra_costs: [],
          items: [{ supplier_order_item_id: orderItemId, quantity: 7 }],
        },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("доприходование оставшихся 6 шт переводит заказ в статус received", async () => {
    const warehouse = new WarehouseService();
    vi.spyOn(warehouse, "getSupplierOrder").mockResolvedValue({
      id: orderId,
      orderNumber: "ЗП-2026-0001",
      supplierName: "Ozon",
      supplierCompanyId: null,
      status: "received",
      totalAmount: 470,
      cashAccountId: accountId,
      financeTransactionId: null,
      notes: "",
      paidAt: "2026-11-24T17:46:00.000Z",
      receivedAt: "2026-11-24T18:10:00.000Z",
      createdBy: userId,
      createdByName: "remtoua",
      items: [],
      orderedQuantityTotal: 10,
      receivedQuantityTotal: 10,
      extraCostsTotal: 200,
      receipts: [],
      createdAt: "2026-11-24T17:46:00.000Z",
      updatedAt: "2026-11-24T18:10:00.000Z",
    });

    const recordedSql: { sql: string; params?: unknown[] }[] = [];

    mockTxQueryOneOrThrow.mockImplementation((sql: string, params?: unknown[]) => {
      recordedSql.push({ sql, params });
      if (sql.includes("FROM supplier_orders") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({
          id: orderId,
          tenant_id: tenantId,
          order_number: "ЗП-2026-0001",
          supplier_name: "Ozon",
          supplier_company_id: null,
          status: "partially_received",
          total_amount: "470",
          cash_account_id: accountId,
          finance_transaction_id: null,
          notes: "",
          paid_at: "2026-11-24T17:46:00.000Z",
          received_at: null,
          created_by: userId,
          created_at: "2026-11-24T17:46:00.000Z",
          updated_at: "2026-11-24T18:00:00.000Z",
        });
      }
      if (sql.includes("INSERT INTO supplier_order_receipts")) {
        return Promise.resolve({
          id: receiptId,
          tenant_id: tenantId,
          supplier_order_id: orderId,
          receipt_number: "ЗП-2026-0001-П2",
          allocation_method: "by_value",
          extra_costs_total: "0",
          notes: "",
          created_by: userId,
          created_at: "2026-11-24T18:10:00.000Z",
        });
      }
      if (sql.includes("INSERT INTO warehouse_batches")) {
        return Promise.resolve({ id: batchId });
      }
      return Promise.resolve({});
    });

    mockTxQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)::text AS cnt FROM supplier_order_receipts")) {
        return Promise.resolve({ cnt: "1" });
      }
      if (sql.includes("SELECT id FROM warehouse_items WHERE tenant_id = $1 AND id = $2")) {
        return Promise.resolve({ id: itemId });
      }
      return Promise.resolve(null);
    });

    mockTxQuery.mockImplementation((sql: string, params?: unknown[]) => {
      recordedSql.push({ sql, params });
      if (sql.includes("FROM supplier_order_items") && sql.includes("FOR UPDATE")) {
        return Promise.resolve([
          {
            id: orderItemId,
            tenant_id: tenantId,
            supplier_order_id: orderId,
            purchase_request_id: null,
            item_id: itemId,
            item_name: "Резистор 10к",
            sku: "R-10K",
            requested_quantity: "0",
            extra_quantity: "10",
            quantity: "10",
            received_quantity: "4",
            unit: "шт",
            price: "47",
            total_price: "470",
            repair_orders: "",
            created_at: "2026-11-24T17:46:00.000Z",
          },
        ]);
      }
      if (sql.includes("AS remaining") && sql.includes("FROM supplier_order_items")) {
        return Promise.resolve([{ remaining: "0" }]);
      }
      return Promise.resolve([]);
    });

    const result = await warehouse.createReceiptFromSupplierOrder(
      tenantId,
      orderId,
      userId,
      {
        mark_paid: false,
        allocation_method: "by_value",
        extra_costs: [],
        items: [{ supplier_order_item_id: orderItemId, quantity: 6 }],
      },
    );

    expect(result.batchesCreated).toBe(1);
    const statusUpdate = recordedSql.find(
      (q) =>
        q.sql.includes("UPDATE supplier_orders") &&
        q.sql.includes("SET status = 'received'"),
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate?.sql).not.toContain("CASE WHEN $1");
    expect(statusUpdate?.params).toEqual([tenantId, orderId]);
  });

  it("FinanceService.pnl исключает is_capitalized_cost = true из операционных расходов и отдаёт в capitalizedCosts", async () => {
    const finance = new FinanceService();

    mockTxQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM transactions t") && sql.includes("is_capitalized_cost")) {
        return Promise.resolve([
          { direction: "income", category_name: "Оплата нарядов", is_capitalized_cost: false, amount: "1000" },
          { direction: "expense", category_name: "Аренда", is_capitalized_cost: false, amount: "300" },
          { direction: "expense", category_name: "Доставка и логистика", is_capitalized_cost: true, amount: "200" },
        ]);
      }
      return Promise.resolve([]);
    });

    mockTxQueryOne.mockResolvedValue({
      parts_cogs: "97",
      write_offs_count: "1",
      parts_revenue: "0",
      works_revenue: "0",
      stock_valuation: "388",
    });

    const pnl = await finance.pnl(tenantId, "2026-11-01", "2026-11-30");
    expect(pnl.income).toBe(1000);
    expect(pnl.expenses).toBe(300);
    expect(pnl.netProfit).toBe(700);
    expect(pnl.capitalizedCosts).toBe(200);
    expect(pnl.expensesByCategory).toEqual([
      { categoryName: "Аренда", amount: 300, percentage: 100 },
    ]);
  });
});
