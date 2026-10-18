import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  RobokassaClient,
  calculateSubscriptionPrice,
  calculateProratedSeatPrice,
  paymentAmountMatchesOutSum,
} from "../modules/finance/billing/robokassa.client.js";

const config = {
  merchantLogin: "voxly",
  password1: "pass1",
  password2: "pass2",
  isTest: true,
};

describe("calculateSubscriptionPrice", () => {
  it("applies period discount correctly", () => {
    expect(calculateSubscriptionPrice(500, 12, 10)).toBe(5400);
  });

  it("no discount for 1 month", () => {
    expect(calculateSubscriptionPrice(500, 1, 0)).toBe(500);
  });

  it("rounds to 2 decimals", () => {
    expect(calculateSubscriptionPrice(500, 6, 5)).toBe(2850);
  });
});

describe("calculateProratedSeatPrice", () => {
  it("prorates by remaining days", () => {
    expect(calculateProratedSeatPrice(300, 15, 30)).toBe(150);
  });

  it("full price when full period remains", () => {
    expect(calculateProratedSeatPrice(300, 30, 30)).toBe(300);
  });

  it("zero when no days remain", () => {
    expect(calculateProratedSeatPrice(300, 0, 30)).toBe(0);
  });
});

describe("RobokassaClient signatures", () => {
  it("generates a payment URL with MerchantLogin:OutSum:InvId:Password1:shp", () => {
    const client = new RobokassaClient(config);
    const url = client.generatePaymentUrl({
      invId: 1001,
      amount: 500,
      description: "Test",
      items: [],
      customData: { tenant_id: "t1" },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("MerchantLogin")).toBe("voxly");
    expect(parsed.searchParams.get("OutSum")).toBe("500.00");
    expect(parsed.searchParams.get("InvId")).toBe("1001");
    expect(parsed.searchParams.get("Shp_tenant_id")).toBe("t1");
    expect(parsed.searchParams.get("IsTest")).toBe("1");

    const expected = createHash("sha256")
      .update("voxly:500.00:1001:pass1:Shp_tenant_id=t1")
      .digest("hex");
    expect(parsed.searchParams.get("SignatureValue")).toBe(expected);
  });

  it("includes raw Receipt JSON in payment signature (54-ФЗ fiscal receipt)", () => {
    const client = new RobokassaClient(config);
    const url = client.generatePaymentUrl({
      invId: 1001,
      amount: 500,
      description: "Voxly CRM Base",
      email: "a@b.ru",
      items: [
        {
          name: "Voxly CRM Base",
          quantity: 1,
          price: 500,
          tax: "none",
          paymentMethod: "full_payment",
          paymentObject: "service",
        },
      ],
      customData: { tenant_id: "t1" },
    });
    const parsed = new URL(url);
    const receiptJson = parsed.searchParams.get("Receipt");
    expect(receiptJson).toBeTruthy();
    const receipt = JSON.parse(receiptJson!);
    expect(receipt.items[0].payment_method).toBe("full_payment");
    expect(receipt.items[0].payment_object).toBe("service");

    const expected = createHash("sha256")
      .update(`voxly:500.00:1001:${receiptJson}:pass1:Shp_tenant_id=t1`)
      .digest("hex");
    expect(parsed.searchParams.get("SignatureValue")).toBe(expected);
  });

  it("verifies SuccessURL signature without MerchantLogin (Password#1)", () => {
    const client = new RobokassaClient(config);
    const customData = { tenant_id: "t1" };
    const expected = createHash("sha256")
      .update("500.00:1001:pass1:Shp_tenant_id=t1")
      .digest("hex");
    expect(
      client.verifySuccessSignature({
        outSum: "500.00",
        invId: "1001",
        signatureValue: expected,
        customData,
      }),
    ).toBe(true);
  });

  it("rejects a tampered success signature", () => {
    const client = new RobokassaClient(config);
    const ok = client.verifySuccessSignature({
      outSum: "500.00",
      invId: "1001",
      signatureValue: "deadbeef".repeat(8),
      customData: { tenant_id: "t1" },
    });
    expect(ok).toBe(false);
  });

  it("verifies ResultURL signature without MerchantLogin (Password#2)", () => {
    const client = new RobokassaClient(config);
    const customData = { tenant_id: "t1" };
    // Prod may send 6 decimal places — must use raw OutSum
    const outSum = "500.000000";
    const expected = createHash("sha256")
      .update(`${outSum}:1001:pass2:Shp_tenant_id=t1`)
      .digest("hex");
    expect(
      client.verifyResultSignature({
        outSum,
        invId: "1001",
        signatureValue: expected,
        customData,
      }),
    ).toBe(true);
  });

  it("rejects result signature computed with password1", () => {
    const client = new RobokassaClient(config);
    const wrong = createHash("sha256")
      .update("500.00:1001:pass1:Shp_tenant_id=t1")
      .digest("hex");
    expect(
      client.verifyResultSignature({
        outSum: "500.00",
        invId: "1001",
        signatureValue: wrong,
        customData: { tenant_id: "t1" },
      }),
    ).toBe(false);
  });

  it("truncates Description to 100 chars", () => {
    const client = new RobokassaClient(config);
    const long = "x".repeat(150);
    const url = client.generatePaymentUrl({
      invId: 1,
      amount: 10,
      description: long,
      items: [],
    });
    expect(new URL(url).searchParams.get("Description")!.length).toBe(100);
  });

  it("rejects OutSum that does not match the invoice amount", () => {
    expect(paymentAmountMatchesOutSum(1000, "1000.00")).toBe(true);
    expect(paymentAmountMatchesOutSum(1000, "1000")).toBe(true);
    expect(paymentAmountMatchesOutSum("500.50", "500.50")).toBe(true);
    expect(paymentAmountMatchesOutSum(1000, "1.00")).toBe(false);
    expect(paymentAmountMatchesOutSum(1000, "not-a-number")).toBe(false);
  });

  it("supports md5 when configured to match Robokassa cabinet", () => {
    const client = new RobokassaClient({ ...config, hashAlgorithm: "md5" });
    const customData = { tenant_id: "t1" };
    const expected = createHash("md5")
      .update("500.00:1001:pass2:Shp_tenant_id=t1")
      .digest("hex");
    expect(
      client.verifyResultSignature({
        outSum: "500.00",
        invId: "1001",
        signatureValue: expected,
        customData,
      }),
    ).toBe(true);
  });
});
