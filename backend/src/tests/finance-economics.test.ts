import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNetProfitSummary } from "../modules/finance/finance.types.js";

describe("computeNetProfitSummary (прямые расходы и чистая прибыль сделки/наряда)", () => {
  it("subtracts COGS and direct expenses from revenue and computes net margin", () => {
    const res = computeNetProfitSummary({
      revenue: 15000,
      cogs: 4000,
      directExpenses: 900,
    });

    assert.equal(res.revenue, 15000);
    assert.equal(res.cogs, 4000);
    assert.equal(res.grossProfit, 11000);
    assert.equal(res.directExpenses, 900);
    assert.equal(res.netProfit, 10100);
    assert.equal(res.netMarginPercent, 67.3);
  });

  it("handles negative net profit (loss) when direct expenses exceed gross profit", () => {
    const res = computeNetProfitSummary({
      revenue: 1000,
      cogs: 400,
      directExpenses: 900,
    });

    assert.equal(res.grossProfit, 600);
    assert.equal(res.netProfit, -300);
    assert.equal(res.netMarginPercent, -30);
  });

  it("returns 0 net margin when revenue is 0", () => {
    const res = computeNetProfitSummary({
      revenue: 0,
      cogs: 0,
      directExpenses: 900,
    });

    assert.equal(res.grossProfit, 0);
    assert.equal(res.netProfit, -900);
    assert.equal(res.netMarginPercent, 0);
  });
});
