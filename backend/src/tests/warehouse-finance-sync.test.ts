import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceService } from "../modules/finance/finance.service.js";
import { WarehouseService } from "../modules/warehouse/warehouse.service.js";

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

describe("Связка Warehouse (Заказы поставщикам) ↔ Finance (Транзакции, категория и автор)", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";
  const orderId = "33333333-3333-3333-3333-333333333333";
  const accountId = "44444444-4444-4444-4444-444444444444";
  const categoryId = "55555555-5555-5555-5555-555555555555";
  const repairId = "66666666-6666-6666-6666-666666666666";
  const txId = "77777777-7777-7777-7777-777777777777";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paySupplierOrder автоматически подставляет категорию «Закупка запчастей», created_by и supplier_order_id", async () => {
    const warehouse = new WarehouseService();
    vi.spyOn(warehouse, "getSupplierOrder").mockResolvedValue({
      id: orderId,
      orderNumber: "ЗП-2026-0001",
      supplierName: "Ozon",
      supplierCompanyId: null,
      status: "paid",
      totalAmount: 470,
      cashAccountId: accountId,
      financeTransactionId: txId,
      notes: "",
      paidAt: "2026-11-24T17:46:00.000Z",
      receivedAt: null,
      createdBy: userId,
      createdByName: "remtoua",
      items: [],
      createdAt: "2026-11-24T17:46:00.000Z",
      updatedAt: "2026-11-24T17:46:00.000Z",
    });

    mockTxQueryOneOrThrow.mockImplementation((sql: string) => {
      if (sql.includes("FROM supplier_orders")) {
        return Promise.resolve({
          id: orderId,
          tenant_id: tenantId,
          order_number: "ЗП-2026-0001",
          supplier_name: "Ozon",
          supplier_company_id: null,
          status: "pending_payment",
          total_amount: "470",
          cash_account_id: accountId,
          finance_transaction_id: null,
          notes: "",
          paid_at: null,
          received_at: null,
          created_by: userId,
          created_at: "2026-11-24T17:46:00.000Z",
          updated_at: "2026-11-24T17:46:00.000Z",
        });
      }
      if (sql.includes("INSERT INTO finance_categories")) {
        return Promise.resolve({ id: categoryId, name: "Закупка запчастей" });
      }
      if (sql.includes("INSERT INTO transactions")) {
        return Promise.resolve({ id: txId });
      }
      return Promise.resolve({});
    });

    mockTxQueryOne.mockResolvedValue(null);
    mockTxQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT DISTINCT repair_order_id")) {
        return Promise.resolve([{ repair_order_id: repairId }]);
      }
      return Promise.resolve([]);
    });

    const res = await warehouse.paySupplierOrder(tenantId, orderId, userId, {
      cash_account_id: accountId,
    });

    expect(res.transactionId).toBe(txId);
    expect(res.status).toBe("PAID");

    const catInsert = mockTxQueryOneOrThrow.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO finance_categories"),
    );
    expect(catInsert?.[1]).toEqual([tenantId, "Закупка запчастей"]);

    const txInsert = mockTxQueryOneOrThrow.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO transactions"),
    );
    expect(txInsert).toBeDefined();
    expect(String(txInsert?.[0])).toContain("category_name");
    expect(String(txInsert?.[0])).toContain("supplier_order_id");
    expect(String(txInsert?.[0])).toContain("created_by");
    expect(txInsert?.[1]).toEqual([
      tenantId,
      accountId,
      categoryId,
      "Закупка запчастей",
      470,
      "Оплата заказа поставщику ЗП-2026-0001 (Ozon)",
      "Ozon",
      orderId,
      repairId,
      userId,
    ]);
  });

  it("paySupplierOrder блокирует повторную оплату уже оплаченного заказа", async () => {
    const warehouse = new WarehouseService();

    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: orderId,
      tenant_id: tenantId,
      order_number: "ЗП-2026-0001",
      supplier_name: "Ozon",
      supplier_company_id: null,
      status: "paid",
      total_amount: "470",
      cash_account_id: accountId,
      finance_transaction_id: txId,
      notes: "",
      paid_at: "2026-11-24T17:46:00.000Z",
      received_at: null,
      created_by: userId,
      created_at: "2026-11-24T17:46:00.000Z",
      updated_at: "2026-11-24T17:46:00.000Z",
    });
    mockTxQueryOne.mockResolvedValueOnce({ id: txId });

    await expect(
      warehouse.paySupplierOrder(tenantId, orderId, userId, { cash_account_id: accountId }),
    ).rejects.toThrow("Заказ поставщику уже оплачен");
  });

  it("updateTransaction сохраняет/восстанавливает created_by и возвращает createdByName", async () => {
    const finance = new FinanceService();

    mockTxQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM transactions t")) {
        return Promise.resolve({
          id: txId,
          direction: "expense",
          amount: "470",
          currency: "RUB",
          category_id: categoryId,
          category_name: "",
          description: "Оплата заказа поставщику ЗП-2026-0001",
          counterparty_name: "Ozon",
          counterparty_inn: "",
          cash_account_id: accountId,
          account_name: "Основная касса (Наличные)",
          deal_id: null,
          repair_order_id: null,
          invoice_id: null,
          supplier_order_id: orderId,
          occurred_at: "2026-11-24T17:46:00.000Z",
          created_by_id: null,
        });
      }
      if (sql.includes("UPDATE cash_accounts")) {
        return Promise.resolve({ balance: "-470" });
      }
      return Promise.resolve(null);
    });

    mockTxQueryOneOrThrow.mockResolvedValue({
      id: txId,
      direction: "expense",
      amount: "470",
      currency: "RUB",
      category_id: categoryId,
      category_name: "Закупка запчастей",
      description: "Оплата заказа поставщику ЗП-2026-0001",
      counterparty_name: "Ozon",
      counterparty_inn: "",
      cash_account_id: accountId,
      account_name: "Основная касса (Наличные)",
      deal_id: null,
      repair_order_id: null,
      invoice_id: null,
      supplier_order_id: orderId,
      occurred_at: "2026-11-24T17:46:00.000Z",
      created_by_id: userId,
      created_by_name: "remtoua",
    });

    const updated = await finance.updateTransaction(
      tenantId,
      txId,
      { category_id: categoryId, category_name: "Закупка запчастей" },
      userId,
    );

    expect(updated.createdById).toBe(userId);
    expect(updated.createdByName).toBe("remtoua");
    expect(updated.categoryName).toBe("Закупка запчастей");
    expect(updated.supplierOrderId).toBe(orderId);

    const updateCall = mockTxQueryOneOrThrow.mock.calls[0]!;
    expect(String(updateCall[0])).toContain("created_by = COALESCE(created_by, $23)");
    expect(String(updateCall[0])).toContain("created_by_name");
    expect((updateCall[1] as unknown[])[22]).toBe(userId);
  });

  it("bulkDeleteTransactions откатывает статус связанного заказа поставщику в pending_payment", async () => {
    const finance = new FinanceService();

    mockTxQuery.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE transactions")) {
        return Promise.resolve([
          {
            id: txId,
            cash_account_id: accountId,
            direction: "expense",
            amount: "470",
            invoice_id: null,
            repair_order_id: null,
            supplier_order_id: orderId,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockTxQueryOne.mockResolvedValue({ balance: "0" });

    const res = await finance.bulkDeleteTransactions(tenantId, [txId]);
    expect(res.count).toBe(1);

    const supplierOrderRevert = mockTxQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE supplier_orders"),
    );
    expect(supplierOrderRevert).toBeDefined();
    expect(String(supplierOrderRevert?.[0])).toContain("pending_payment");
    expect(supplierOrderRevert?.[1]).toEqual([tenantId, [txId], [orderId]]);
  });
});
