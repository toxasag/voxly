import fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env: { VOXLY_SERVICE_TOKEN?: string; NODE_ENV: string } = {
  VOXLY_SERVICE_TOKEN: "service-token-for-tests",
  NODE_ENV: "test",
};

vi.mock("../config/env.js", () => ({ getEnv: () => env }));
vi.mock("../db/client.js", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn(),
  withTenant: vi.fn(),
  runWithTenantContext: vi.fn(),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../plugins/authenticate.js", () => ({ authenticatePlugin: async () => undefined }));
vi.mock("../modules/channels/max-bridge.service.js", () => ({ MaxBridgeService: class {} }));
vi.mock("../modules/crm/crm-pipeline.service.js", () => ({
  CrmPipelineService: class {},
  isBotSender: () => false,
}));
vi.mock("../modules/crm/channel-identity.js", () => ({ isBannedName: () => false }));
vi.mock("../modules/ai/agent-pipeline.service.js", () => ({ AgentPipelineService: class {} }));
vi.mock("../modules/crm/chat/media.service.js", () => ({ ChatMediaService: class {} }));
vi.mock("../modules/crm/media/media-enrichment.service.js", () => ({
  mediaEnrichmentService: {},
}));
vi.mock("../modules/crm/chat/chat-events.js", () => ({ chatEventBus: { emit: vi.fn() } }));
vi.mock("../modules/crm/translation/message-translation.service.js", () => ({
  messageTranslationService: {},
}));

import maxIntegrationRoutes, { maxInternalRoutes } from "../modules/channels/max-integration.routes.js";

async function build(): Promise<FastifyInstance> {
  const app = fastify();
  app.decorate("requirePermission", () => async () => undefined);
  app.decorate("requireModule", () => async () => undefined);
  await app.register(maxInternalRoutes, { prefix: "/api/internal/max" });
  await app.register(maxIntegrationRoutes, { prefix: "/api/v1/integrations/max" });
  await app.ready();
  return app;
}

const URLS = ["/api/internal/max/bots/active", "/api/v1/integrations/max/internal/bots/active"];

describe("внутренние маршруты MAX требуют VOXLY_SERVICE_TOKEN", () => {
  beforeEach(() => {
    env.VOXLY_SERVICE_TOKEN = "service-token-for-tests";
  });

  it.each(URLS)("%s без токена → 401", async (url) => {
    const app = await build();
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it.each(URLS)("%s с неверным токеном → 401", async (url) => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: "Bearer wrong-token-value-xxxxxxxxx" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it.each(URLS)("%s с верным Bearer-токеном → 200", async (url) => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: "Bearer service-token-for-tests" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("токен в x-voxly-service-token тоже принимается", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: URLS[0]!,
      headers: { "x-voxly-service-token": "service-token-for-tests" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("токен не задан → маршрут не блокируется (обратная совместимость)", async () => {
    env.VOXLY_SERVICE_TOKEN = undefined;
    const app = await build();
    const res = await app.inject({ method: "GET", url: URLS[0]! });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
