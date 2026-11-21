import fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { PermissionDeniedError, errorHandler } from "../plugins/errorHandler.js";

vi.mock("../plugins/authenticate.js", () => ({ authenticatePlugin: async () => undefined }));
vi.mock("../modules/admin/platform-config.service.js", () => ({
  platformConfigService: { saveSingleWorkingKey: vi.fn() },
  isGoogleCloudPropagationDelay: () => false,
}));
vi.mock("../modules/ai/gemini-key-pool.service.js", () => ({
  geminiKeyPoolService: { getPoolStats: vi.fn().mockResolvedValue({ keys: [] }) },
}));

import geminiIntegrationRoutes from "../modules/ai/gemini-integration.routes.js";

async function buildGeminiApp(isPlatformOwner: boolean): Promise<FastifyInstance> {
  const app = fastify();
  app.setErrorHandler(errorHandler);
  app.decorate("requirePlatformOwner", () => async () => {
    if (!isPlatformOwner) {
      throw new PermissionDeniedError("Platform owner role required");
    }
  });
  await app.register(geminiIntegrationRoutes, { prefix: "/api/v1/integrations/gemini" });
  await app.ready();
  return app;
}

describe("gemini-integration.routes: доступ только platform_owner + защита от SSRF", () => {
  it("обычный пользователь тенанта на POST /verify получает 403", async () => {
    const app = await buildGeminiApp(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/gemini/verify",
      payload: { apiKey: "fake", save: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("обычный пользователь тенанта на GET /pool-stats получает 403", async () => {
    const app = await buildGeminiApp(false);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/gemini/pool-stats",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it.each([
    "http://127.0.0.1:4000",
    "https://localhost/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/v1",
    "https://evolution-api:8080",
    "https://max-bridge:3010",
  ])("platform_owner с внутренним baseUrl %s получает 400 SSRF_FORBIDDEN", async (baseUrl) => {
    const app = await buildGeminiApp(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/gemini/verify",
      payload: { apiKey: "fake", baseUrl },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "SSRF_FORBIDDEN" } });
    await app.close();
  });

  it("platform_owner на GET /pool-stats получает 200", async () => {
    const app = await buildGeminiApp(true);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/gemini/pool-stats",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
