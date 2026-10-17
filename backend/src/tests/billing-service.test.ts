import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { RobokassaClient } from "../modules/finance/billing/robokassa.client.js";
import { BillingService } from "../modules/finance/billing/billing.service.js";
import { PRODUCT_CODES, type BillingPaymentRow } from "../modules/finance/billing/billing.types.js";

// Мокируем слой БД
const mockQueryOne = vi.fn();
const mockQuery = vi.fn();
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

// Мокируем config/env.js
vi.mock("../config/env.js", () => ({
  getEnv: () => ({
    ROBOKASSA_MERCHANT_LOGIN: "voxly_test",
    ROBOKASSA_PASSWORD_1: "pass1_secret",
    ROBOKASSA_PASSWORD_2: "pass2_secret",
    ROBOKASSA_IS_TEST: true,
    ROBOKASSA_HASH_ALGO: "SHA256",
    ROBOKASSA_TAX: "none",
  }),
}));

describe("BillingService", () => {
  let robokassaClient: RobokassaClient;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();

    robokassaClient = new RobokassaClient({
      merchantLogin: "voxly_test",
      password1: "pass1_secret",
      password2: "pass2_secret",
      isTest: true,
      hashAlgorithm: "sha256",
    });

    service = new BillingService(robokassaClient);
  });

  describe("createCheckout", () => {
    it("throws 503 if gateway is not configured", async () => {
      const unconfiguredService = new BillingService(undefined);
      (unconfiguredService as any).robokassaClient = null;

      await expect(
        unconfiguredService.createCheckout({
          tenantId: "t-1",
          payload: {
            amount_rubles: 1500,
            product_code: PRODUCT_CODES.AI_TOPUP,
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "ROBOKASSA_NOT_CONFIGURED",
      });
    });

    it("generates payment URL and creates pending payment row", async () => {
      mockQueryOne.mockResolvedValueOnce({ inv_id: 100055 });
      mockTxQueryOneOrThrow.mockResolvedValueOnce({
        id: "pay-uuid-1",
        tenant_id: "t-1",
        robokassa_inv_id: 100055,
        amount: "1500.00",
        status: "pending",
        product_code: PRODUCT_CODES.AI_TOPUP,
      } as BillingPaymentRow);

      const result = await service.createCheckout({
        tenantId: "t-1",
        payload: {
          amount_rubles: 1500,
          product_code: PRODUCT_CODES.AI_TOPUP,
          customer_email: "ceo@voxly.ru",
        },
      });

      expect(result.invId).toBe(100055);
      expect(result.amountRubles).toBe(1500);
      expect(result.status).toBe("pending");
      expect(result.paymentUrl).toContain("MerchantLogin=voxly_test");
      expect(result.paymentUrl).toContain("OutSum=1500.00");
      expect(result.paymentUrl).toContain("InvId=100055");
      expect(result.paymentUrl).toContain("Shp_tenant_id=t-1");
      expect(result.paymentUrl).toContain("Email=ceo%40voxly.ru");
    });
  });

  describe("handleResultWebhook", () => {
    function computeResultSignature(
      outSum: string,
      invId: number | string,
      pass2: string,
      customData: Record<string, string>,
    ): string {
      const shpSuffix = Object.keys(customData)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => `:Shp_${k}=${customData[k]}`)
        .join("");
      return createHash("sha256")
        .update(`${outSum}:${invId}:${pass2}${shpSuffix}`)
        .digest("hex");
    }

    it("rejects webhook when mandatory params are missing", async () => {
      await expect(service.handleResultWebhook({})).rejects.toThrow(
        "Отсутствуют обязательные параметры",
      );
    });

    it("rejects webhook with invalid signature", async () => {
      await expect(
        service.handleResultWebhook({
          OutSum: "1500.00",
          InvId: "100055",
          SignatureValue: "invalid_sig",
          Shp_tenant_id: "t-1",
        }),
      ).rejects.toThrow("Некорректная цифровая подпись");
    });

    it("rejects webhook when payment is not found in database", async () => {
      const customData = { tenant_id: "t-1", product_code: "ai_topup" };
      const sig = computeResultSignature("1500.00", 100055, "pass2_secret", customData);

      mockQueryOne.mockResolvedValueOnce(null);

      await expect(
        service.handleResultWebhook({
          OutSum: "1500.00",
          InvId: "100055",
          SignatureValue: sig,
          Shp_tenant_id: "t-1",
          Shp_product_code: "ai_topup",
        }),
      ).rejects.toThrow("не найден");
    });

    it("is idempotent: returns OK immediately if payment is already paid", async () => {
      const customData = { tenant_id: "t-1" };
      const sig = computeResultSignature("1500.00", 100055, "pass2_secret", customData);

      mockQueryOne.mockResolvedValueOnce({
        id: "pay-1",
        robokassa_inv_id: 100055,
        amount: "1500.00",
        status: "paid",
        tenant_id: "t-1",
        product_code: "ai_topup",
      } as BillingPaymentRow);

      const res = await service.handleResultWebhook({
        OutSum: "1500.00",
        InvId: "100055",
        SignatureValue: sig,
        Shp_tenant_id: "t-1",
      });

      expect(res).toBe("OK100055");
      expect(mockTxQuery).not.toHaveBeenCalled();
    });

    it("rejects webhook when OutSum does not match payment amount", async () => {
      const customData = { tenant_id: "t-1" };
      const sig = computeResultSignature("100.00", 100055, "pass2_secret", customData);

      mockQueryOne.mockResolvedValueOnce({
        id: "pay-1",
        robokassa_inv_id: 100055,
        amount: "1500.00", // в базе 1500, а пришло 100
        status: "pending",
        tenant_id: "t-1",
        product_code: "ai_topup",
      } as BillingPaymentRow);

      await expect(
        service.handleResultWebhook({
          OutSum: "100.00",
          InvId: "100055",
          SignatureValue: sig,
          Shp_tenant_id: "t-1",
        }),
      ).rejects.toThrow("не совпадает с суммой платежа");
    });

    it("fulfills AI topup: updates payment, increments tenant balance and records topup", async () => {
      const customData = { tenant_id: "t-1", product_code: "ai_topup" };
      const sig = computeResultSignature("2000.00", 100060, "pass2_secret", customData);

      mockQueryOne.mockResolvedValueOnce({
        id: "pay-60",
        robokassa_inv_id: 100060,
        amount: "2000.00",
        status: "pending",
        tenant_id: "t-1",
        product_code: PRODUCT_CODES.AI_TOPUP,
      } as BillingPaymentRow);

      mockTxQueryOne.mockResolvedValueOnce({ id: "pay-60" }); // claim succeeded

      const res = await service.handleResultWebhook({
        OutSum: "2000.00",
        InvId: "100060",
        SignatureValue: sig,
        Shp_tenant_id: "t-1",
        Shp_product_code: "ai_topup",
      });

      expect(res).toBe("OK100060");

      // Проверяем, что были вызваны INSERT INTO ai_balance_topups и UPDATE tenants
      const sqlQueries = mockTxQuery.mock.calls.map((c) => c[0] as string);
      expect(sqlQueries.some((sql) => sql.includes("INSERT INTO ai_balance_topups"))).toBe(true);
      expect(sqlQueries.some((sql) => sql.includes("UPDATE tenants SET ai_balance_kopecks"))).toBe(true);

      // Проверяем сумму в копейках: 2000 руб = 200000 копеек
      const updateTenantsCall = mockTxQuery.mock.calls.find((c) =>
        (c[0] as string).includes("UPDATE tenants SET ai_balance_kopecks"),
      );
      expect(updateTenantsCall?.[1]).toEqual(["t-1", 200000]);
    });

    it("fulfills subscription: creates or extends subscription row", async () => {
      const customData = { tenant_id: "t-1", product_code: "crm_base" };
      const sig = computeResultSignature("4990.00", 100070, "pass2_secret", customData);

      mockQueryOne.mockResolvedValueOnce({
        id: "pay-70",
        robokassa_inv_id: 100070,
        amount: "4990.00",
        status: "pending",
        tenant_id: "t-1",
        product_code: PRODUCT_CODES.CRM_BASE,
        period_months: 3,
      } as BillingPaymentRow);

      mockTxQueryOne
        .mockResolvedValueOnce({ id: "pay-70" }) // claim payment
        .mockResolvedValueOnce(null); // activeSub not found

      mockTxQueryOneOrThrow.mockResolvedValueOnce({ id: "sub-123" }); // created subscription

      const res = await service.handleResultWebhook({
        OutSum: "4990.00",
        InvId: "100070",
        SignatureValue: sig,
        Shp_tenant_id: "t-1",
        Shp_product_code: "crm_base",
      });

      expect(res).toBe("OK100070");

      const insertSubCall = mockTxQueryOneOrThrow.mock.calls.find((c) =>
        (c[0] as string).includes("INSERT INTO subscriptions"),
      );
      expect(insertSubCall).toBeDefined();
      expect(insertSubCall?.[1]).toEqual(["t-1", "crm_base", 3]);
    });
  });

  describe("verifySuccessRedirect", () => {
    it("verifies return redirect signature using Password#1", () => {
      const sig = createHash("sha256")
        .update(`1500.00:100055:pass1_secret:Shp_tenant_id=t-1`)
        .digest("hex");

      const result = service.verifySuccessRedirect({
        OutSum: "1500.00",
        InvId: "100055",
        SignatureValue: sig,
        Shp_tenant_id: "t-1",
      });

      expect(result.valid).toBe(true);
      expect(result.invId).toBe("100055");
    });
  });
});
