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

interface LayoutResponse {
  data: {
    tableId: string;
    layout: {
      widths: Record<string, number>;
      order: string[];
      hidden: string[];
    };
    updatedAt: string;
  };
}

const contactsLayout = {
  widths: { name: 280, email: 220 },
  order: ["name", "email", "phone"],
  hidden: ["phone"],
};

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

describe("Record table layouts", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/crm/table-layouts/contacts" });

    expect(response.statusCode).toBe(401);
  });

  it("upserts and retrieves the authenticated user's layout", async () => {
    const session = await signedInOwner();

    const firstWrite = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(session),
      payload: contactsLayout,
    });
    expect(firstWrite.statusCode).toBe(200);
    expect(firstWrite.json<LayoutResponse>().data.layout).toEqual(contactsLayout);

    const replacement = { widths: { name: 320 }, order: ["email", "name"], hidden: [] };
    const secondWrite = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(session),
      payload: replacement,
    });
    expect(secondWrite.statusCode).toBe(200);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(session),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<LayoutResponse>().data.layout).toEqual(replacement);

    const storedCount = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM record_table_layouts
         WHERE tenant_id = $1 AND user_id = $2 AND table_id = $3`,
        [session.tenantId, session.userId, "contacts"],
      );
      return result.rows[0]?.count;
    });
    expect(storedCount).toBe("1");
  });

  it("does not expose a layout to a different user in the same tenant", async () => {
    const tenant = await createTenant();
    const owner = await signedInOwner(tenant.tenantId);
    const colleague = await signedInOwner(tenant.tenantId);

    await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(owner),
      payload: contactsLayout,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(colleague),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: null }>().data).toBeNull();
  });

  it("does not expose a layout across tenants", async () => {
    const owner = await signedInOwner();
    const otherTenantUser = await signedInOwner();

    await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/deals",
      headers: authorization(owner),
      payload: contactsLayout,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/crm/table-layouts/deals",
      headers: authorization(otherTenantUser),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: null }>().data).toBeNull();
  });

  it("rejects unknown tables and malformed layouts", async () => {
    const session = await signedInOwner();

    const unknownTable = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/unknown",
      headers: authorization(session),
      payload: contactsLayout,
    });
    expect(unknownTable.statusCode).toBe(400);
    expect(unknownTable.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");

    const malformed = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/contacts",
      headers: authorization(session),
      payload: {
        widths: { name: 103 },
        order: ["name", "name"],
        hidden: ["invalid column!"],
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ error: { details: Record<string, string[]> } }>().error.details).toHaveProperty("widths.name");
    expect(malformed.json<{ error: { details: Record<string, string[]> } }>().error.details).toHaveProperty("order");
    expect(malformed.json<{ error: { details: Record<string, string[]> } }>().error.details).toHaveProperty("hidden.0");
  });

  it("accepts optional kanbanColumnWidth and rejects out of range", async () => {
    const session = await signedInOwner();

    const ok = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/deals",
      headers: authorization(session),
      payload: { widths: {}, order: [], hidden: [], kanbanColumnWidth: 320 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<LayoutResponse>().data.layout).toMatchObject({ kanbanColumnWidth: 320 });

    const tooNarrow = await app.inject({
      method: "PUT",
      url: "/api/v1/crm/table-layouts/deals",
      headers: authorization(session),
      payload: { widths: {}, order: [], hidden: [], kanbanColumnWidth: 199 },
    });
    expect(tooNarrow.statusCode).toBe(400);
  });
});
