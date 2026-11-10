import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { YandexConversionProvider } from "../modules/analytics/providers/yandex-conversion.provider.js";
import type { ConversionEventPayload } from "../modules/analytics/analytics.types.js";

describe("YandexConversionProvider", () => {
  let provider: YandexConversionProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new YandexConversionProvider();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 when counterId is missing", async () => {
    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      eventName: "Lead",
      isTest: true,
    };
    const res = await provider.sendEvent(payload, {});
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain("Не указан номер счётчика");
  });

  it("verifies counter connection via Management API on test call with OAuth token", async () => {
    const mockCounterData = {
      counter: {
        id: 114153352,
        name: "maps3455.pro",
        site: "maps3455.pro",
        status: "Active",
      },
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("api-metrika.yandex.net/management/v1/counter/114153352")) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            Authorization: "OAuth test_valid_token",
          }),
        );
        return new Response(JSON.stringify(mockCounterData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      eventName: "TestConversion",
      isTest: true,
    };

    const res = await provider.sendEvent(payload, {
      counterId: "114153352",
      oauthToken: "test_valid_token",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe(200);
    expect(res.responseSnippet).toContain("maps3455.pro");
    expect(res.responseSnippet).toContain("114153352");
  });

  it("handles 401/403 authorization error gracefully with clear advice", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ code: 403, message: "Invalid oauth_token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      eventName: "TestConversion",
      isTest: true,
    };

    const res = await provider.sendEvent(payload, {
      counterId: "114153352",
      oauthToken: "invalid_token",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toContain("Неверный OAuth-токен или нет прав доступа");
  });

  it("handles 404 counter not found with clear advice", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ code: 404, message: "Counter not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      eventName: "TestConversion",
      isTest: true,
    };

    const res = await provider.sendEvent(payload, {
      counterId: "999999999",
      oauthToken: "some_token",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toContain("не найден в аккаунте Яндекс Метрики");
  });

  it("uploads offline conversion with correct multipart CSV on live event", async () => {
    let capturedBody: unknown = null;
    let capturedUrl = "";

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body;
      return new Response(JSON.stringify({ uploading: { id: 12345, status: "UPLOADED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload: ConversionEventPayload = {
      tenantId: "tenant-1",
      eventName: "Lead",
      clientId: "ym_client_12345",
      budget: 15000,
      currency: "RUB",
      isTest: false,
    };

    const res = await provider.sendEvent(payload, {
      counterId: "114153352",
      oauthToken: "test_oauth_token",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("offline_conversions/upload?client_id_type=CLIENT_ID");
    expect(capturedBody).toBeDefined();
    expect(Buffer.isBuffer(capturedBody)).toBe(true);
    const bodyStr = (capturedBody as Buffer).toString("utf-8");
    expect(bodyStr).toContain("ym_client_12345");
    expect(bodyStr).toContain("lead");
    expect(bodyStr).toContain("15000");
  });
});
