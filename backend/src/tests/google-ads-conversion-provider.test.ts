import { describe, expect, it, vi } from "vitest";
import { GoogleAdsConversionProvider } from "../modules/analytics/providers/google-ads-conversion.provider.js";
import type { ConversionEventPayload } from "../modules/analytics/analytics.types.js";

describe("GoogleAdsConversionProvider", () => {
  const provider = new GoogleAdsConversionProvider();

  it("returns 422 when no gclid/gbraid/wbraid and no contact details are provided", async () => {
    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      dealId: "deal-1",
      eventName: "Lead",
      budget: 1000,
    };
    const config = {
      counterId: "18543997725",
      conversionLabel: "test_label",
    };

    const res = await provider.sendEvent(payload, config);
    expect(res.success).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain("Отсутствуют идентификаторы клика Google Ads");
  });

  it("returns 400 with diagnostic message when only gtag browser config is provided", async () => {
    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      dealId: "deal-1",
      gclid: "Cj0KCQiAiJXYBhD_ARIsAAx2AHkqjk7CxezPbggRpPTiAhcNrx69d4_GiyldFY3ij1uEY8G6c1gy8SIaArTrEALw_wcB",
      eventName: "Lead",
      budget: 5000,
    };
    const config = {
      counterId: "18543997725",
      conversionId: "18543997725",
      conversionLabel: "dOAeCP6H_b0dEJ3mu4pF",
    };

    const res = await provider.sendEvent(payload, config);
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("Для серверной передачи конверсий в Google Ads требуется");
    expect(res.responseSnippet).toContain("Google Ads API / GA4 credentials required");
  });

  it("successfully forwards via GA4 Measurement Protocol bridge with gclid", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      dealId: "deal-123",
      gclid: "Cj0KCQiAiJXYBhD_test_gclid",
      budget: 15000,
      currency: "RUB",
      eventName: "Purchase",
      isWon: true,
      createdAt: new Date("2026-11-26T12:00:00Z"),
    };

    const config = {
      ga4MeasurementId: "G-6TJPQLGLF5",
      ga4ApiSecret: "mock_api_secret_123",
    };

    const res = await provider.sendEvent(payload, config);
    expect(res.success).toBe(true);
    expect(res.status).toBe(204);
    expect(res.responseSnippet).toContain("GA4 MP Bridge OK");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstCall = mockFetch.mock.calls[0] as [string, { body: string }];
    const [callUrl, callOpts] = firstCall;
    expect(callUrl).toContain("measurement_id=G-6TJPQLGLF5");
    expect(callUrl).toContain("api_secret=mock_api_secret_123");

    const parsedBody = JSON.parse(callOpts.body);
    expect(parsedBody.events[0].name).toBe("purchase");
    expect(parsedBody.events[0].params.gclid).toBe("Cj0KCQiAiJXYBhD_test_gclid");
    expect(parsedBody.events[0].params.transaction_id).toBe("deal-123");
    expect(parsedBody.events[0].params.value).toBe(15000);

    vi.unstubAllGlobals();
  });
});
