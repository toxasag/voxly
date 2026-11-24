import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinanceService } from "../modules/finance/finance.service.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

vi.mock("../../../db/client.js", () => ({
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

vi.mock("../../../plugins/errorHandler.js", () => ({
  NotFoundError: class extends Error {},
  ValidationError: class extends Error {},
  UnprocessableEntityError: class extends Error {},
}));

describe("FinanceService - Negative balance & overdraft expense creation", () => {
  let service: FinanceService;
  const tenantId = "b9ea05c5-a1af-4ecd-86a6-ad75db68fe58";
  const accountId = "0c43c521-0314-482e-b7f5-9afb8cc2ad38";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FinanceService();
  });

  it("allows expense transaction when account balance is zero (overdraft in minus)", async () => {
    // 1. Account row with 0 balance
    mockTxQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM cash_accounts")) {
        return Promise.resolve({
          id: accountId,
          name: "Основная касса (Наличные)",
          account_type: "cash",
          currency: "RUB",
          balance: 0,
          is_default: true,
        });
      }
      if (sql.includes("UPDATE cash_accounts")) {
        return Promise.resolve({ balance: "-500" });
      }
      return Promise.resolve(null);
    });

    mockTxQueryOneOrThrow.mockResolvedValue({
      id: "tx-123",
      direction: "expense",
      amount: "500",
      currency: "RUB",
      category_id: null,
      category_name: "Аренда",
      description: "Оплата аренды",
      counterparty_name: "Арендодатель",
      counterparty_inn: "7700000000",
      cash_account_id: accountId,
      account_name: "Основная касса (Наличные)",
      deal_id: null,
      repair_order_id: null,
      invoice_id: null,
      occurred_at: "2026-11-24T16:14:00.000Z",
      created_by_id: null,
      created_by_name: null,
    });

    const result = await service.createTransaction(tenantId, {
      account_id: accountId,
      type: "expense",
      amount: 500,
      currency: "RUB",
      category_id: "rent-slug-not-uuid", // fallback slug
      category_name: "Аренда",
      description: "Оплата аренды",
      counterparty_name: "Арендодатель",
      counterparty_inn: "7700000000",
      occurred_at: "2026-11-24T16:14", // datetime-local format
    });

    expect(result).toBeDefined();
    expect(result.amount).toBe(500);
    expect(result.type).toBe("expense");

    // Check that INSERT was called with safeUuid (null for slug) and ISO date
    const insertCall = mockTxQueryOneOrThrow.mock.calls[0]!;
    const insertParams = insertCall[1] as unknown[];
    expect(insertParams[1]).toBe(accountId);
    expect(insertParams[2]).toBeNull(); // safeUuid mapped slug to null
    expect(insertParams[6]).toBe("expense");
    expect(insertParams[13]).toBe("2026-11-24T13:14:00.000Z"); // safeDate converted to ISO
  });

  it("allows transfer from account with insufficient balance", async () => {
    const toAccountId = "a1236230-3c83-4268-b1f3-b68c01b13c24";

    mockTxQueryOne.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("FROM cash_accounts")) {
        const id = (params as string[])[1];
        if (id === accountId) {
          return Promise.resolve({
            id: accountId,
            name: "Основная касса",
            account_type: "cash",
            currency: "RUB",
            balance: 0,
            is_default: true,
          });
        }
        return Promise.resolve({
          id: toAccountId,
          name: "Расчётный счёт",
          account_type: "bank",
          currency: "RUB",
          balance: 2000,
          is_default: false,
        });
      }
      if (sql.includes("UPDATE cash_accounts")) {
        const id = (params as string[])[1];
        return Promise.resolve({ balance: id === accountId ? "-1000" : "3000" });
      }
      return Promise.resolve(null);
    });

    mockTxQuery.mockResolvedValue([]);

    const result = await service.transfer(tenantId, {
      from_account_id: accountId,
      to_account_id: toAccountId,
      amount: 1000,
      description: "Пополнение р/с из кассы",
    });

    expect(result.from.balance).toBe(-1000);
    expect(result.to.balance).toBe(3000);
  });
});
