import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { ROLE_PERMISSIONS } from "../config/permissions.js";
import type { ModuleSlug, Role } from "../types/index.js";

let currentRole: Role = "viewer";
let currentModules: ModuleSlug[] = ["products_services", "service_center"];

vi.mock("../plugins/authenticate.js", () => ({
  authenticatePlugin: fp(async (fastify: FastifyInstance) => {
    fastify.addHook("onRequest", async (request: FastifyRequest) => {
      request.tenant_id = "00000000-0000-0000-0000-000000000001";
      request.authUser = {
        id: "00000000-0000-0000-0000-000000000099",
        tenant_id: request.tenant_id,
        email: `${currentRole}@example.com`,
        phone: "+79990000000",
        name: currentRole,
        role: currentRole,
        platform_role: null,
        permissions: [...ROLE_PERMISSIONS[currentRole]],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      request.permissions = new Set(ROLE_PERMISSIONS[currentRole]);
      request.installed_modules = [...currentModules];
    });
  }),
}));

vi.mock("../modules/warehouse/warehouse.service.js", () => ({
  warehouseService: {
    listItems: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
    createItem: vi.fn().mockResolvedValue({ id: "item-1", name: "Screen" }),
    updateSettings: vi.fn().mockResolvedValue({ allow_negative_stock: true }),
    paySupplierOrder: vi.fn().mockResolvedValue({ order: { id: "so-1" }, transactionId: "tx-1" }),
  },
}));

vi.mock("../modules/services/services.service.js", () => ({
  servicesService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "srv-1", name: "Diagnostics" }),
  },
}));

vi.mock("../modules/analytics/analytics.service.js", () => ({
  AnalyticsService: class {
    async getOverview() {
      return { revenue: 0 };
    }
  },
}));

vi.mock("../modules/analytics/analytics-integrations.service.js", () => ({
  analyticsIntegrationsService: {
    listIntegrations: vi.fn().mockResolvedValue([]),
    createIntegration: vi.fn().mockResolvedValue({ id: "int-1" }),
  },
}));

vi.mock("../modules/analytics/pre-chat-modal.service.js", () => ({
  preChatModalService: {
    getConfig: vi.fn().mockResolvedValue({ enabled: false }),
    updateConfig: vi.fn().mockResolvedValue({ enabled: true }),
    getStats: vi.fn().mockResolvedValue({ clicks: 0 }),
  },
}));

vi.mock("../modules/print-templates/print-templates.service.js", () => ({
  printTemplatesService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "tpl-1" }),
    updateSettings: vi.fn().mockResolvedValue({ company_name: "Test" }),
  },
}));

vi.mock("../modules/channels/sites/sites.service.js", () => ({
  SitesService: class {
    async listSites() {
      return [];
    }
    async createSite() {
      return { id: "site-1", name: "Landing" };
    }
    async regenerateToken() {
      return { id: "site-1", webhook_token: "tok-2" };
    }
  },
}));

import { errorHandler } from "../plugins/errorHandler.js";
import { authorizePlugin } from "../plugins/authorize.js";
import { warehouseRoutes } from "../modules/warehouse/warehouse.routes.js";
import { servicesRoutes } from "../modules/services/services.routes.js";
import { analyticsRoutes } from "../modules/analytics/analytics.routes.js";
import { printTemplatesRoutes } from "../modules/print-templates/print-templates.routes.js";
import { siteManagementRoutes } from "../modules/channels/sites/sites.routes.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(authorizePlugin);
  await app.register(warehouseRoutes, { prefix: "/api/v1/warehouse" });
  await app.register(servicesRoutes, { prefix: "/api/v1/services" });
  await app.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
  await app.register(printTemplatesRoutes, { prefix: "/api/v1/print-templates" });
  await app.register(siteManagementRoutes, { prefix: "/api/v1/channels/sites" });
  await app.ready();
  return app;
}

describe("RBAC & module gates for warehouse, services, analytics, print-templates, sites", () => {
  beforeEach(() => {
    currentRole = "viewer";
    currentModules = ["products_services", "service_center"];
  });

  it("blocks viewer on write/admin routes across all 5 modules while allowing reads", async () => {
    const app = await buildApp();

    // Reads allowed where viewer has deals:read
    expect((await app.inject({ method: "GET", url: "/api/v1/warehouse/items" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/services/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/analytics/overview" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/channels/sites" })).statusCode).toBe(200);

    // Print templates require service_center:read (viewer lacks it)
    expect((await app.inject({ method: "GET", url: "/api/v1/print-templates/" })).statusCode).toBe(403);

    // Writes forbidden for viewer across all 5 modules
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/warehouse/items",
          payload: { name: "LCD" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/v1/warehouse/settings",
          payload: { allow_negative_stock: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/warehouse/supplier-orders/so-1/pay",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/services/",
          payload: { name: "Fix", price: 1000 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/analytics/integrations",
          payload: { provider: "yandex_metrika", counter_id: "123" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/channels/sites",
          payload: { name: "My site" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/channels/sites/00000000-0000-0000-0000-000000000010/regenerate-token",
        })
      ).statusCode,
    ).toBe(403);

    await app.close();
  });

  it("allows technician to write warehouse/services/print-templates but blocks admin/pay routes", async () => {
    currentRole = "technician";
    const app = await buildApp();

    expect((await app.inject({ method: "GET", url: "/api/v1/print-templates/" })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/warehouse/items",
          payload: { name: "Battery" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/services/",
          payload: { name: "Cleaning", price: 500 },
        })
      ).statusCode,
    ).toBe(201);

    // Admin/finance actions remain blocked for technician
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/warehouse/supplier-orders/so-1/pay",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/print-templates/settings",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/analytics/pre-chat-config",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/channels/sites",
          payload: { name: "Site" },
        })
      ).statusCode,
    ).toBe(403);

    await app.close();
  });

  it("enforces module gates with 403 MODULE_NOT_INSTALLED when module is absent", async () => {
    currentRole = "owner";
    currentModules = [];
    const app = await buildApp();

    const whRes = await app.inject({ method: "GET", url: "/api/v1/warehouse/items" });
    expect(whRes.statusCode).toBe(403);
    expect(whRes.json().error.code).toBe("MODULE_NOT_INSTALLED");

    const srvRes = await app.inject({ method: "GET", url: "/api/v1/services/" });
    expect(srvRes.statusCode).toBe(403);
    expect(srvRes.json().error.code).toBe("MODULE_NOT_INSTALLED");

    const ptRes = await app.inject({ method: "GET", url: "/api/v1/print-templates/" });
    expect(ptRes.statusCode).toBe(403);
    expect(ptRes.json().error.code).toBe("MODULE_NOT_INSTALLED");

    // Analytics & Sites are always-on core/channel features — owner still allowed
    expect((await app.inject({ method: "GET", url: "/api/v1/analytics/overview" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/channels/sites" })).statusCode).toBe(200);

    await app.close();
  });

  it("allows owner full access when modules are installed", async () => {
    currentRole = "owner";
    const app = await buildApp();

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/warehouse/supplier-orders/so-1/pay",
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/channels/sites",
          payload: { name: "Prod Landing" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/print-templates/settings",
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    await app.close();
  });
});
