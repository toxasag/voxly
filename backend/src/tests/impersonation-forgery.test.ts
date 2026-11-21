import fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockQueryOne = vi.fn();

vi.mock("../db/client.js", () => ({
  query: vi.fn(),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  queryOneOrThrow: vi.fn(),
  transaction: vi.fn(),
  withTenant: vi.fn(),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
}));

import { AuthService } from "../modules/auth/auth.service.js";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function base64url(input: object): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

/** JWT с чужой подписью: структура валидна, подпись не от нашего секрета. */
function forgeToken(payload: Record<string, unknown>): string {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.forgedsignature`;
}

describe("AuthService.exitImpersonation: неподписанный JWT не даёт доступ", () => {
  let app: FastifyInstance;
  let service: AuthService;

  beforeAll(async () => {
    app = fastify();
    await app.register(jwt, { secret: "unit-test-secret-unit-test-secret-1234" });
    await app.ready();
    service = new AuthService(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValue({
      id: ADMIN_ID,
      tenant_id: TENANT_ID,
      platform_role: "platform_owner",
      is_partner: true,
      role: "owner",
      tenant_is_partner: true,
    });
  });

  it("подделанный access token с impersonator_id суперадмина отклоняется", async () => {
    const forged = forgeToken({ sub: "attacker", tenant_id: TENANT_ID, impersonator_id: ADMIN_ID });

    await expect(service.exitImpersonation({ adminAccessToken: forged })).rejects.toThrow();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("подделанный access token с sub суперадмина отклоняется", async () => {
    const forged = forgeToken({ sub: ADMIN_ID, tenant_id: TENANT_ID });

    await expect(service.exitImpersonation({ adminAccessToken: forged })).rejects.toThrow();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("токен без подписи (alg none) отклоняется", async () => {
    const unsigned = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: ADMIN_ID })}.`;

    await expect(service.exitImpersonation({ adminAccessToken: unsigned })).rejects.toThrow();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});
