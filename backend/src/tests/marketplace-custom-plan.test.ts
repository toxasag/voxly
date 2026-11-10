import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monthlyPrice, effectiveMonthly, type PricingInput } from "../modules/marketplace/pricing.js";

describe("Marketplace & Tariff Unification (Custom Plan & Zero Cost)", () => {
  it("Test 1: Standard flat module charges basePrice", () => {
    const input: PricingInput = {
      billingKind: "flat",
      basePrice: 500,
      unitPrice: 0,
      includedUnits: 0,
      quantity: 1,
      usersCount: 5,
    };

    assert.equal(monthlyPrice(input), 500);
    assert.equal(effectiveMonthly(input, null), 500);
  });

  it("Test 2: Standard per_seat charges basePrice + extra seats above included", () => {
    const input: PricingInput = {
      billingKind: "per_seat",
      basePrice: 600,
      unitPrice: 200,
      includedUnits: 10,
      quantity: 1,
      usersCount: 15,
    };

    // 600 + (15 - 10) * 200 = 1600
    assert.equal(monthlyPrice(input), 1600);
    assert.equal(effectiveMonthly(input, null), 1600);
  });

  it("Test 3: Individual free plan (zero cost / unmetered) calculates 0 ₽ regardless of seats or quantity", () => {
    const freeSeatInput: PricingInput = {
      billingKind: "per_seat",
      basePrice: 0,
      unitPrice: 0,
      includedUnits: 999999,
      quantity: 1,
      usersCount: 50,
    };

    assert.equal(monthlyPrice(freeSeatInput), 0);
    assert.equal(effectiveMonthly(freeSeatInput, null), 0);

    const freeMultiInput: PricingInput = {
      billingKind: "per_unit",
      basePrice: 0,
      unitPrice: 0,
      includedUnits: 999999,
      quantity: 25,
      usersCount: 50,
    };

    assert.equal(monthlyPrice(freeMultiInput), 0);
    assert.equal(effectiveMonthly(freeMultiInput, null), 0);
  });

  it("Test 4: Custom plan resolution correctly identifies free partner / individual plan", () => {
    function resolveCustomPlan(tenant: { custom_price_rubles: number | null; custom_plan_name: string | null; plan: string }) {
      const hasCustomPrice = tenant.custom_price_rubles !== null && tenant.custom_price_rubles !== undefined;
      const isFreeCustomPlan = (hasCustomPrice && Number(tenant.custom_price_rubles) === 0) || tenant.plan === "custom_free";
      const customPlanName = tenant.custom_plan_name ?? (isFreeCustomPlan ? "Партнёрский" : "Индивидуальный");
      const customPrice = hasCustomPrice ? Number(tenant.custom_price_rubles) : null;

      return { hasCustomPrice, isFreeCustomPlan, customPlanName, customPrice };
    }

    // Exact remtoua case: custom_price_rubles = 0
    const remtoua = resolveCustomPlan({
      custom_price_rubles: 0,
      custom_plan_name: "Партнёрский VIP",
      plan: "trial",
    });
    assert.equal(remtoua.hasCustomPrice, true);
    assert.equal(remtoua.isFreeCustomPlan, true);
    assert.equal(remtoua.customPlanName, "Партнёрский VIP");
    assert.equal(remtoua.customPrice, 0);

    // Fixed price individual plan: custom_price_rubles = 2500
    const fixedClient = resolveCustomPlan({
      custom_price_rubles: 2500,
      custom_plan_name: "Специальный",
      plan: "custom",
    });
    assert.equal(fixedClient.hasCustomPrice, true);
    assert.equal(fixedClient.isFreeCustomPlan, false);
    assert.equal(fixedClient.customPrice, 2500);

    // Default commercial plan: custom_price_rubles = null
    const regularClient = resolveCustomPlan({
      custom_price_rubles: null,
      custom_plan_name: null,
      plan: "standard",
    });
    assert.equal(regularClient.hasCustomPrice, false);
    assert.equal(regularClient.isFreeCustomPlan, false);
    assert.equal(regularClient.customPrice, null);
  });

  it("Test 5: Partner and 0 ₽ custom plan suppresses trialActive and defaults to 'Партнёрский тариф'", () => {
    function resolveTenantInfo(tenant: {
      plan: string;
      status: string;
      custom_price_rubles: number | null;
      custom_plan_name: string | null;
      trial_ends_at: string | null;
    }) {
      const hasCustomPrice = tenant.custom_price_rubles !== null && tenant.custom_price_rubles !== undefined;
      const isFreeCustomPlan = (hasCustomPrice && Number(tenant.custom_price_rubles) === 0) || tenant.plan === "custom_free";
      const isPartner = isFreeCustomPlan || tenant.plan === "partner" || tenant.plan === "custom_free";
      const isTrialAccount = (tenant.plan === "trial" || tenant.status === "trial") && !isFreeCustomPlan && !isPartner;

      const rawTrialDaysLeft =
        tenant.trial_ends_at === null
          ? 0
          : Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86_400_000));

      const trialActive = isTrialAccount && rawTrialDaysLeft > 0;
      const trialDaysLeft = trialActive ? rawTrialDaysLeft : 0;
      const trialEndsAt = trialActive ? tenant.trial_ends_at : null;

      let customPlanName: string | null = null;
      if (hasCustomPrice || isPartner) {
        if (tenant.custom_plan_name && tenant.custom_plan_name !== "Индивидуальный") {
          customPlanName = tenant.custom_plan_name;
        } else {
          customPlanName = isPartner ? "Партнёрский тариф" : "Индивидуальный";
        }
      }

      return { isPartner, isFreeCustomPlan, trialActive, trialDaysLeft, trialEndsAt, customPlanName };
    }

    // valera exact case: plan enterprise, status active, custom_price_rubles 0, old trial_ends_at
    const valera = resolveTenantInfo({
      plan: "enterprise",
      status: "active",
      custom_price_rubles: 0,
      custom_plan_name: "Индивидуальный",
      trial_ends_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    });

    assert.equal(valera.isPartner, true);
    assert.equal(valera.isFreeCustomPlan, true);
    assert.equal(valera.trialActive, false);
    assert.equal(valera.trialDaysLeft, 0);
    assert.equal(valera.trialEndsAt, null);
    assert.equal(valera.customPlanName, "Партнёрский тариф");

    // Standard new trial account: plan trial, status trial, no custom price
    const newTrial = resolveTenantInfo({
      plan: "trial",
      status: "trial",
      custom_price_rubles: null,
      custom_plan_name: null,
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });

    assert.equal(newTrial.isPartner, false);
    assert.equal(newTrial.isFreeCustomPlan, false);
    assert.equal(newTrial.trialActive, true);
    assert.ok(newTrial.trialDaysLeft > 0);
    assert.ok(newTrial.trialEndsAt !== null);
  });
});
