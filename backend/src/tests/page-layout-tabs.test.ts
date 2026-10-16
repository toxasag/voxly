import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";

let app: FastifyInstance;

beforeAll(async () => {
  await createTestDatabase();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  const { closePool } = await import("../db/client.js");
  await closePool();
  await dropTestDatabase();
});

beforeEach(async () => {
  await truncateTestData();
});

interface Session {
  token: string;
  tenantId: string;
  userId: string;
}

interface TabDTO {
  tabKey: string;
  title: string;
  icon: string;
  position: number;
  isActive: boolean;
  moduleSlug: string | null;
  requiredPermission: string | null;
  updatedAt: string;
}

async function signedInOwner(tenantId?: string): Promise<Session> {
  const tenant = tenantId === undefined ? await createTenant() : { tenantId };
  const user = await createUser({ tenantId: tenant.tenantId, role: "owner" });
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: user.password },
  });

  return {
    token: response.json<{ data: { access_token: string } }>().data.access_token,
    tenantId: tenant.tenantId,
    userId: user.id,
  };
}

function authorization(session: Session): { authorization: string } {
  return { authorization: `Bearer ${session.token}` };
}

describe("Page layout tabs", () => {
  it("requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
    });

    expect(response.statusCode).toBe(401);
  });

  it("seeds and lists default contact tabs in position order", async () => {
    const session = await signedInOwner();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });

    expect(response.statusCode).toBe(200);
    const tabs = response.json<{ data: TabDTO[] }>().data;
    expect(tabs.map((tab) => tab.tabKey)).toEqual(["home", "tasks", "notes"]);
    expect(tabs.map((tab) => tab.position)).toEqual([10, 30, 40]);
  });

  it("lists deal tabs including inactive files and chat permission", async () => {
    const session = await signedInOwner();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/deal/tabs",
      headers: authorization(session),
    });

    expect(response.statusCode).toBe(200);
    const tabs = response.json<{ data: TabDTO[] }>().data;
    expect(tabs.map((tab) => tab.tabKey)).toEqual(["home", "chat", "tasks", "notes", "files"]);
    expect(tabs.find((tab) => tab.tabKey === "chat")?.requiredPermission).toBe("deals:write");
    expect(tabs.find((tab) => tab.tabKey === "files")?.isActive).toBe(false);
  });

  it("updates title, position and isActive of one tab", async () => {
    const session = await signedInOwner();

    await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/company/tabs",
      headers: authorization(session),
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/v1/crm/page-layouts/company/tabs/notes",
      headers: authorization(session),
      payload: { title: "Комментарии", position: 25, isActive: false },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ data: TabDTO }>().data).toMatchObject({
      tabKey: "notes",
      title: "Комментарии",
      position: 25,
      isActive: false,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/company/tabs",
      headers: authorization(session),
    });
    const notes = listed.json<{ data: TabDTO[] }>().data.find((tab) => tab.tabKey === "notes");
    expect(notes?.title).toBe("Комментарии");
    expect(notes?.position).toBe(25);
    expect(notes?.isActive).toBe(false);
  });

  it("returns 404 for unknown tab key", async () => {
    const session = await signedInOwner();

    await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/crm/page-layouts/contact/tabs/missing",
      headers: authorization(session),
      payload: { title: "Нет" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("TAB_NOT_FOUND");
  });

  it("rejects unknown object types", async () => {
    const session = await signedInOwner();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/invoice/tabs",
      headers: authorization(session),
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not expose tabs across tenants", async () => {
    const owner = await signedInOwner();
    const other = await signedInOwner();

    await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/deal/tabs",
      headers: authorization(owner),
    });

    await app.inject({
      method: "PATCH",
      url: "/api/v1/crm/page-layouts/deal/tabs/home",
      headers: authorization(owner),
      payload: { title: "Только у первого" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/deal/tabs",
      headers: authorization(other),
    });

    const home = response.json<{ data: TabDTO[] }>().data.find((tab) => tab.tabKey === "home");
    expect(home?.title).toBe("Главная");

    const foreignCount = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM page_layout_tabs
         WHERE tenant_id = $1 AND title = $2`,
        [other.tenantId, "Только у первого"],
      );
      return result.rows[0]?.count;
    });
    expect(foreignCount).toBe("0");
  });

  it("installs the repairs tab on a contact when service_center is enabled", async () => {
    const session = await signedInOwner();

    await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });
    expect(before.json<{ data: TabDTO[] }>().data.map((tab) => tab.tabKey)).not.toContain("repairs");

    const install = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/modules/service_center/toggle",
      headers: authorization(session),
      payload: { enabled: true },
    });
    expect(install.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });
    const repairs = after.json<{ data: TabDTO[] }>().data.find((tab) => tab.tabKey === "repairs");
    expect(repairs).toMatchObject({
      title: "Ремонты",
      position: 20,
      isActive: true,
      moduleSlug: "service_center",
      requiredPermission: "service_center:read",
    });
  });

  it("hides the module tab on uninstall and restores it on reinstall without duplicating", async () => {
    const session = await signedInOwner();

    await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/modules/service_center/toggle",
      headers: authorization(session),
      payload: { enabled: true },
    });

    await app.inject({
      method: "PATCH",
      url: "/api/v1/crm/page-layouts/contact/tabs/repairs",
      headers: authorization(session),
      payload: { title: "Наряды", position: 22 },
    });

    const off = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/modules/service_center/toggle",
      headers: authorization(session),
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);

    const hidden = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });
    expect(hidden.json<{ data: TabDTO[] }>().data.find((tab) => tab.tabKey === "repairs")?.isActive).toBe(false);

    await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/modules/service_center/toggle",
      headers: authorization(session),
      payload: { enabled: true },
    });

    const restored = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/contact/tabs",
      headers: authorization(session),
    });
    const repairs = restored.json<{ data: TabDTO[] }>().data.filter((tab) => tab.tabKey === "repairs");
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ isActive: true, title: "Наряды", position: 22 });
  });

  it("installs the invoices tab on a company when finance is enabled", async () => {
    const session = await signedInOwner();

    await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/company/tabs",
      headers: authorization(session),
    });

    const install = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/modules/finance/toggle",
      headers: authorization(session),
      payload: { enabled: true },
    });
    expect(install.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/crm/page-layouts/company/tabs",
      headers: authorization(session),
    });
    expect(after.json<{ data: TabDTO[] }>().data.find((tab) => tab.tabKey === "invoices")).toMatchObject({
      title: "Счета",
      position: 20,
      isActive: true,
      moduleSlug: "finance",
      requiredPermission: "finance:read",
    });
  });
});
