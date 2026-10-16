import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";

// ---------------------------------------------------------------------------
// Изоляция арендаторов (`.cursorrules` §4, `M6.3.3`).
//
// Проверяется не наличие политик в схеме, а фактическое поведение под ролью
// `app_user`: политики объявлены с `FORCE ROW LEVEL SECURITY`, но
// суперпользователь обходит их через `rolbypassrls`. Именно поэтому тестовая база
// подключается непривилегированной ролью — под `postgres` эти проверки проходили
// бы независимо от того, работает изоляция или нет.
//
// Отдельно проверяется, что политика действует и на запись: `WITH CHECK` без
// `platform_scope()` — то, что не даёт платформенной панели писать от имени
// арендаторов.
// ---------------------------------------------------------------------------

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

interface Signed {
  token: string;
  tenantId: string;
  userId: string;
}

async function signedInOwner(): Promise<Signed> {
  const tenant = await createTenant();
  const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });

  return {
    token: res.json<{ data: { access_token: string } }>().data.access_token,
    tenantId: tenant.tenantId,
    userId: owner.id,
  };
}

async function createContact(
  session: Signed,
  firstName: string,
): Promise<{ id: string; status: number }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/crm/contacts",
    headers: { authorization: `Bearer ${session.token}` },
    payload: {
      first_name: firstName,
      last_name: "Тестовый",
      // Телефоны списком: первый номер становится основным (модель PHONES).
      phones: [{ number: "+7 900 000-00-00", country_code: "RU", calling_code: "+7" }],
      company_name: "ООО Тест",
      channel: "phone",
    },
  });

  return {
    id: res.statusCode === 201 ? res.json<{ data: { id: string } }>().data.id : "",
    status: res.statusCode,
  };
}

describe("RLS: контакты", () => {
  it("не показывает контакты чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    await createContact(mine, "Мой");
    await createContact(other, "Чужой");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/crm/contacts",
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{ data: { firstName: string }[]; meta: { total: number } }>();
    expect(body.meta.total).toBe(1);
    expect(body.data.map((item) => item.firstName)).toEqual(["Мой"]);
  });

  it("отвечает 404 на контакт чужого арендатора, а не отдаёт его", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    const foreign = await createContact(other, "Чужой");
    expect(foreign.status).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/contacts/${foreign.id}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("не даёт изменить и удалить контакт чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    const foreign = await createContact(other, "Чужой");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/crm/contacts/${foreign.id}`,
      headers: { authorization: `Bearer ${mine.token}` },
      payload: { first_name: "Переписанный" },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/crm/contacts/${foreign.id}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(patched.statusCode).toBe(404);
    // Строго 404. Прежний `expect([404, 200])` допускал `200`, а этот код
    // маршрут возвращает только когда удаление действительно произошло и у
    // контакта были связанные сделки, — то есть ровно при межарендном удалении,
    // которое тест и запрещает. Ассерт не мог упасть.
    expect(deleted.statusCode).toBe(404);

    // Строка на месте и не переписана — проверяется в БД, а не по ответу.
    const row = await withTestDb(async (client) => {
      const result = await client.query<{ first_name: string; deleted_at: Date | null }>(
        `SELECT first_name, deleted_at FROM contacts WHERE id = $1`,
        [foreign.id],
      );
      return result.rows[0];
    });

    expect(row?.first_name).toBe("Чужой");
    expect(row?.deleted_at).toBeNull();
  });

  it("присваивает tenant_id из токена: подделать его в теле запроса нельзя", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/crm/contacts",
      headers: { authorization: `Bearer ${mine.token}` },
      payload: {
        first_name: "Подмена",
        last_name: "Тестовый",
        phones: [{ number: "+7 900 000-00-01", country_code: "RU", calling_code: "+7" }],
        company_name: "ООО Тест",
        channel: "phone",
        // Лишнее поле: схема его не принимает, а сервис берёт tenant_id из
        // request.tenant_id, а не из тела.
        tenant_id: other.tenantId,
      },
    });

    expect(res.statusCode).toBe(201);

    const tenantId = await withTestDb(async (client) => {
      const result = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM contacts WHERE first_name = 'Подмена'`,
      );
      return result.rows[0]?.tenant_id;
    });

    expect(tenantId).toBe(mine.tenantId);
    expect(tenantId).not.toBe(other.tenantId);
  });
});

describe("RLS: политика действует под app_user", () => {
  it("скрывает строки при чужом app.tenant_id и запрещает запись мимо него", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    await createContact(mine, "Изолированный");

    const { query, runWithTenantContext } = await import("../db/client.js");

    // Тот же пул, что и у приложения (роль `app_user`), но контекст — чужой
    // арендатор. Запрос сознательно БЕЗ `WHERE tenant_id`: проверяется именно
    // политика, а не фильтр в SQL.
    const visibleToOther = await runWithTenantContext(other.tenantId, () =>
      query<{ id: string }>(`SELECT id FROM contacts`),
    );
    expect(visibleToOther).toHaveLength(0);

    const visibleToOwner = await runWithTenantContext(mine.tenantId, () =>
      query<{ id: string }>(`SELECT id FROM contacts`),
    );
    expect(visibleToOwner).toHaveLength(1);

    // Запись с чужим tenant_id должна отклоняться самой политикой (42501),
    // а не только проверкой в коде.
    await expect(
      runWithTenantContext(other.tenantId, () =>
        query(
          `INSERT INTO contacts (tenant_id, first_name, last_name, phone, company_name, channel)
           VALUES ($1, 'Чужой', 'Вставка', '70000000000', 'ООО', 'phone')`,
          [mine.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("без tenant-контекста не видно ни одной строки арендатора", async () => {
    const mine = await signedInOwner();
    await createContact(mine, "Скрытый");

    const { query, runWithTenantContext } = await import("../db/client.js");

    // Пустой GUC: `current_tenant_id()` вернёт NULL, и политика не пропустит
    // ничего. Так ведёт себя забытый вызов `setRequestTenant`.
    const rows = await runWithTenantContext("", () => query<{ id: string }>(`SELECT id FROM contacts`));

    expect(rows).toHaveLength(0);
  });
});

describe("Гейт модулей", () => {
  it("закрывает ремонты, пока модуль не установлен", async () => {
    const session = await signedInOwner();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/repairs",
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("MODULE_NOT_INSTALLED");
  });

  it("открывает ремонты после установки модуля этому арендатору", async () => {
    const session = await signedInOwner();

    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO installed_modules (tenant_id, slug, name)
         VALUES ($1, 'service_center', 'Сервисный центр')`,
        [session.tenantId],
      );
    });

    // Список модулей читается в хуке authenticate при каждом запросе, поэтому
    // новый токен не нужен — достаточно следующего запроса.
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/repairs",
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("установка модуля у одного арендатора не открывает его другому", async () => {
    const withModule = await signedInOwner();
    const without = await signedInOwner();

    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO installed_modules (tenant_id, slug, name)
         VALUES ($1, 'service_center', 'Сервисный центр')`,
        [withModule.tenantId],
      );
    });

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/repairs",
      headers: { authorization: `Bearer ${withModule.token}` },
    });
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/repairs",
      headers: { authorization: `Bearer ${without.token}` },
    });

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
  });

  it("отвечает 404 на неизвестный слаг канала, а не «модуль не установлен»", async () => {
    const session = await signedInOwner();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/channels/not-a-channel/accounts",
      headers: { authorization: `Bearer ${session.token}` },
    });

    // Опечатка в URL не должна выглядеть как отключённый модуль.
    expect(res.statusCode).toBe(404);
  });
});

describe("Права на действия внутри арендатора", () => {
  async function signedInAs(role: "manager" | "viewer" | "technician"): Promise<Signed> {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId, role });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });

    return {
      token: res.json<{ data: { access_token: string } }>().data.access_token,
      tenantId: tenant.tenantId,
      userId: user.id,
    };
  }

  it("наблюдатель читает контакты, но не создаёт", async () => {
    const viewer = await signedInAs("viewer");

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/crm/contacts",
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    const write = await createContact(viewer, "Запрещённый");

    expect(read.statusCode).toBe(200);
    expect(write.status).toBe(403);
  });

  it("менеджер создаёт контакт, но не удаляет его", async () => {
    const manager = await signedInAs("manager");

    const created = await createContact(manager, "Созданный");
    expect(created.status).toBe(201);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/crm/contacts/${created.id}`,
      headers: { authorization: `Bearer ${manager.token}` },
    });

    // `contacts:delete` есть только у admin и owner.
    expect(deleted.statusCode).toBe(403);
  });
});
