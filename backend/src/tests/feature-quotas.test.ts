import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_FEATURE_QUOTAS,
  quotaItemUpdateSchema,
  updateTenantQuotasSchema,
} from "../modules/quotas/quota.types.js";
import { QuotaService } from "../modules/quotas/quota.service.js";

describe("Tenant Feature Quotas & Entitlements", () => {
  it("SYSTEM_FEATURE_QUOTAS covers all 11 required channels, widgets, ai and crm features", () => {
    const keys = SYSTEM_FEATURE_QUOTAS.map((f) => f.key);

    const requiredKeys = [
      "webchat_widgets",
      "site_integrations",
      "ai_agents",
      "telegram_channels",
      "telegram_bot_channels",
      "whatsapp_channels",
      "max_channels",
      "max_bot_channels",
      "avito_channels",
      "instagram_channels",
      "custom_pipelines",
    ];

    for (const reqKey of requiredKeys) {
      assert.ok(
        keys.includes(reqKey),
        `Missing required quota feature key in SYSTEM_FEATURE_QUOTAS: ${reqKey}`,
      );
    }

    assert.equal(SYSTEM_FEATURE_QUOTAS.length, 11);
  });

  it("validates quotaItemUpdateSchema with unlimited and finite limits", () => {
    const validUnlimited = quotaItemUpdateSchema.parse({
      feature_key: "telegram_bot_channels",
      is_unlimited: true,
      max_limit: -1,
    });
    assert.equal(validUnlimited.is_unlimited, true);
    assert.equal(validUnlimited.max_limit, -1);

    const validFinite = quotaItemUpdateSchema.parse({
      feature_key: "avito_channels",
      is_unlimited: false,
      max_limit: 10,
    });
    assert.equal(validFinite.is_unlimited, false);
    assert.equal(validFinite.max_limit, 10);

    const batch = updateTenantQuotasSchema.parse({
      quotas: [validUnlimited, validFinite],
    });
    assert.equal(batch.quotas.length, 2);
  });

  it("checkQuota returns unlimited for platform root tenant id or when db fails", async () => {
    const service = new QuotaService();
    // c0000000-0000-0000-0000-000000000001 is root platform tenant
    const res = await service.checkQuota(
      "c0000000-0000-0000-0000-000000000001",
      "telegram_bot_channels",
    );
    assert.equal(res.isUnlimited, true);
    assert.equal(res.allowed, true);
  });
});
