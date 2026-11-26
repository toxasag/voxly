import fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env: { VOXLY_SERVICE_TOKEN?: string; NODE_ENV: string } = {
  VOXLY_SERVICE_TOKEN: "service-token-for-tests",
  NODE_ENV: "test",
};

const { mockQuery, mockQueryOne, mockCheckSession, mockTxQuery, mockTxQueryOne, mockTxQueryOneOrThrow } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue([]),
  mockQueryOne: vi.fn(),
  mockCheckSession: vi.fn(),
  mockTxQuery: vi.fn().mockResolvedValue([]),
  mockTxQueryOne: vi.fn(),
  mockTxQueryOneOrThrow: vi.fn(),
}));

vi.mock("../config/env.js", () => ({ getEnv: () => env }));
vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  withTenant: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: mockTxQuery,
      queryOne: mockTxQueryOne,
      queryOneOrThrow: mockTxQueryOneOrThrow,
    }),
  runWithTenantContext: vi.fn(),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../plugins/authenticate.js", () => ({ authenticatePlugin: async () => undefined }));
vi.mock("../modules/channels/max-bridge.service.js", () => ({
  invalidateMaxBridgeLiveBotsCache: vi.fn(),
  MaxBridgeService: class {
    checkSession = mockCheckSession;
  },
}));
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

import { encryptSecret } from "../services/credentials-cipher.js";
import maxIntegrationRoutes, { maxInternalRoutes } from "../modules/channels/max-integration.routes.js";

async function build(): Promise<FastifyInstance> {
  const app = fastify();
  app.decorateRequest("tenant_id", "00000000-0000-0000-0000-000000000001");
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
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    mockTxQuery.mockResolvedValue([]);
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

  it("GET /bots/active возвращает error-аккаунты и расшифрованный sessionBackup", async () => {
    const encrypted = encryptSecret(
      JSON.stringify({ token: "tok-secret-1", deviceId: "dev1234567890abc" }),
    );
    mockQuery.mockResolvedValueOnce([
      {
        id: "021eb35f-2fd8-488c-bd64-6e14abfba252",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        label: "Основной",
        external_id: "254468389",
        remote_user_id: "254468389",
        status: "error",
        credentials: { encrypted_session: encrypted },
      },
    ]);
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/api/internal/max/bots/active",
      headers: { authorization: "Bearer service-token-for-tests" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bots).toHaveLength(1);
    expect(body.bots[0].status).toBe("error");
    expect(body.bots[0].sessionBackup).toEqual({
      token: "tok-secret-1",
      deviceId: "dev1234567890abc",
    });
    await app.close();
  });

  it("POST /bots/upsert по botId обновляет существующую запись и шифрует sessionBackup", async () => {
    mockTxQueryOne.mockResolvedValueOnce({
      id: "021eb35f-2fd8-488c-bd64-6e14abfba252",
      label: "79776282049 (Ремонт)",
    });
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/max/bots/upsert",
      headers: { authorization: "Bearer service-token-for-tests" },
      payload: {
        tenantId: "00000000-0000-0000-0000-000000000001",
        botId: "021eb35f-2fd8-488c-bd64-6e14abfba252",
        name: "79776282049 (Ремонт)",
        maxUserId: "254468389",
        firstName: "Дэн",
        sessionBackup: {
          token: "tok-new-123",
          deviceId: "dev1234567890abc",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, botId: "021eb35f-2fd8-488c-bd64-6e14abfba252" });
    const updateArgs = mockTxQuery.mock.calls[0]?.[1] as unknown[];
    expect(updateArgs[2]).toBe("79776282049 (Ремонт)");
    expect(String(updateArgs[5])).toMatch(/^v1:/);
    await app.close();
  });

  it("POST /bots/status переводит статус и очищает бэкап только при clearSession=true", async () => {
    mockQueryOne.mockResolvedValueOnce({
      tenant_id: "00000000-0000-0000-0000-000000000001",
    });
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/max/bots/status",
      headers: { authorization: "Bearer service-token-for-tests" },
      payload: {
        botId: "021eb35f-2fd8-488c-bd64-6e14abfba252",
        status: "error",
        statusMessage: "login.token revoked",
        clearSession: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const params = mockTxQuery.mock.calls[0]?.[1] as unknown[];
    expect(params[2]).toBe("error");
    expect(params[5]).toBe(true);
    await app.close();
  });

  it("POST /api/v1/integrations/max/accounts/:id/check синхронизирует статус", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "021eb35f-2fd8-488c-bd64-6e14abfba252",
      label: "Основной",
      credentials: {},
    });
    mockCheckSession.mockResolvedValueOnce({
      ok: true,
      alive: true,
      maxUserId: "254468389",
    });
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/max/accounts/021eb35f-2fd8-488c-bd64-6e14abfba252/check",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { alive: true } });
    const updateParams = mockTxQuery.mock.calls[0]?.[1] as unknown[];
    expect(updateParams[2]).toBe("connected");
    await app.close();
  });
});
