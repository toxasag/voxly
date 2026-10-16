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
// Модель контакта (`M7.6.1`–`M7.6.10`).
//
// Проверяется то, что было сломано и переделано, а не CRUD как таковой:
//  - обязательно только имя: фамилия, телефон и компания необязательны;
//  - телефоны раскладываются на основной (плоские колонки) и дополнительные
//    (JSONB), как в composite-типе PHONES у Twenty;
//  - соцсети лежат списком, а колонки telegram_username / whatsapp остаются
//    согласованными с ним — по ним ищет транспорт каналов;
//  - название компании создаёт запись в `companies` и связывает контакт с ней.
//    Именно этого не происходило раньше: список компаний был пуст при
//    заполненных компаниях в контактах.
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
  };
}

interface ContactPhone {
  number: string;
  countryCode: string;
  callingCode: string;
  isPrimary: boolean;
}

interface ContactSocial {
  kind: string;
  value: string;
}

interface ContactBody {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  phone: string;
  phones: ContactPhone[];
  telegramUsername: string | null;
  whatsapp: string | null;
  socials: ContactSocial[];
  companyName: string;
  companyId: string | null;
}

async function post(session: Signed, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/crm/contacts",
    headers: { authorization: `Bearer ${session.token}` },
    payload,
  });
}

async function patch(session: Signed, id: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/api/v1/crm/contacts/${id}`,
    headers: { authorization: `Bearer ${session.token}` },
    payload,
  });
}

describe("Контакт: обязательные поля", () => {
  it("создаётся с одним именем — без фамилии, телефона и компании", async () => {
    const session = await signedInOwner();

    const res = await post(session, { first_name: "Клиент" });

    expect(res.statusCode).toBe(201);

    const contact = res.json<{ data: ContactBody }>().data;
    expect(contact.lastName).toBe("");
    expect(contact.middleName).toBe("");
    expect(contact.phone).toBe("");
    expect(contact.phones).toEqual([]);
    expect(contact.companyName).toBe("");
    expect(contact.companyId).toBeNull();
  });

  it("отклоняет пустое имя", async () => {
    const session = await signedInOwner();

    const res = await post(session, { first_name: "" });

    expect(res.statusCode).toBe(400);
  });

  it("сохраняет отчество", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      last_name: "Петров",
      middle_name: "Сергеевич",
    });

    expect(res.json<{ data: ContactBody }>().data.middleName).toBe("Сергеевич");
  });
});

describe("Контакт: телефоны", () => {
  it("первый номер становится основным, остальные уходят в additional_phones", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      phones: [
        { number: "+7 916 123-45-67", country_code: "RU", calling_code: "+7" },
        { number: "+7 903 111-22-33", country_code: "RU", calling_code: "+7" },
      ],
    });

    const contact = res.json<{ data: ContactBody }>().data;

    // Разделители снимаются схемой: иначе поиск по номеру не нашёл бы запись.
    expect(contact.phone).toBe("+79161234567");
    expect(contact.phones).toHaveLength(2);
    expect(contact.phones[0]?.isPrimary).toBe(true);
    expect(contact.phones[1]).toMatchObject({ number: "+79031112233", isPrimary: false });

    const row = await withTestDb(async (client) => {
      const result = await client.query<{ phone: string; additional_phones: unknown }>(
        "SELECT phone, additional_phones FROM contacts WHERE id = $1",
        [contact.id],
      );
      return result.rows[0];
    });

    expect(row?.phone).toBe("+79161234567");
    expect(row?.additional_phones).toEqual([
      { number: "+79031112233", countryCode: "RU", callingCode: "+7" },
    ]);
  });

  it("снимает дубли номеров", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      phones: [
        { number: "+79161234567" },
        { number: "+7 916 123 45 67" },
      ],
    });

    expect(res.json<{ data: ContactBody }>().data.phones).toHaveLength(1);
  });

  it("заменяет список целиком при PATCH", async () => {
    const session = await signedInOwner();
    const created = await post(session, {
      first_name: "Иван",
      phones: [{ number: "+79161234567" }, { number: "+79031112233" }],
    });
    const id = created.json<{ data: ContactBody }>().data.id;

    const updated = await patch(session, id, { phones: [{ number: "+79995554433" }] });
    const contact = updated.json<{ data: ContactBody }>().data;

    // Замена, а не слияние: у Twenty PhonesFieldInput тоже отдаёт весь composite.
    expect(contact.phones).toHaveLength(1);
    expect(contact.phone).toBe("+79995554433");
  });

  it("отклоняет номер с буквами", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      phones: [{ number: "позвонить позже" }],
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("Контакт: соцсети", () => {
  it("держит telegram_username и whatsapp согласованными со списком", async () => {
    const session = await signedInOwner();

    const created = await post(session, {
      first_name: "Иван",
      socials: [
        { kind: "telegram", value: "@ivan" },
        { kind: "whatsapp", value: "+79161234567" },
        { kind: "max", value: "@ivanmax" },
      ],
    });

    const contact = created.json<{ data: ContactBody }>().data;
    expect(contact.socials).toHaveLength(3);
    // Колонки нужны транспорту каналов, поэтому обновляются вместе со списком.
    expect(contact.telegramUsername).toBe("@ivan");
    expect(contact.whatsapp).toBe("+79161234567");

    const updated = await patch(session, contact.id, {
      socials: [{ kind: "vk", value: "ivan" }],
    });
    const after = updated.json<{ data: ContactBody }>().data;

    expect(after.socials).toEqual([{ kind: "vk", value: "ivan" }]);
    expect(after.telegramUsername).toBeNull();
    expect(after.whatsapp).toBeNull();
  });

  it("снимает дубли по паре (сеть, значение) без учёта регистра", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      socials: [
        { kind: "telegram", value: "@Ivan" },
        { kind: "telegram", value: "@ivan" },
      ],
    });

    expect(res.json<{ data: ContactBody }>().data.socials).toHaveLength(1);
  });

  it("отклоняет неизвестную сеть", async () => {
    const session = await signedInOwner();

    const res = await post(session, {
      first_name: "Иван",
      socials: [{ kind: "myspace", value: "@ivan" }],
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("Контакт: связь с компанией", () => {
  async function companyNames(tenantId: string): Promise<string[]> {
    return withTestDb(async (client) => {
      const result = await client.query<{ name: string }>(
        "SELECT name FROM companies WHERE tenant_id = $1 ORDER BY created_at",
        [tenantId],
      );
      return result.rows.map((row) => row.name);
    });
  }

  it("создаёт компанию по названию и связывает контакт с ней", async () => {
    const session = await signedInOwner();

    const res = await post(session, { first_name: "Иван", company_name: "ООО ТехКорп" });
    const contact = res.json<{ data: ContactBody }>().data;

    // Ровно то, чего не происходило раньше: название оставалось строкой, и
    // список компаний был пуст при заполненной компании у контакта.
    expect(contact.companyId).not.toBeNull();
    expect(await companyNames(session.tenantId)).toEqual(["ООО ТехКорп"]);
  });

  it("переиспользует существующую компанию, игнорируя регистр и пробелы", async () => {
    const session = await signedInOwner();

    const first = await post(session, { first_name: "Иван", company_name: "ООО ТехКорп" });
    const second = await post(session, { first_name: "Пётр", company_name: "  ооо техкорп " });

    const firstId = first.json<{ data: ContactBody }>().data.companyId;
    const second_ = second.json<{ data: ContactBody }>().data;

    expect(second_.companyId).toBe(firstId);
    // Название приводится к названию компании: источник правды один.
    expect(second_.companyName).toBe("ООО ТехКорп");
    expect(await companyNames(session.tenantId)).toEqual(["ООО ТехКорп"]);
  });

  it("отвязывает компанию, когда название стёрли", async () => {
    const session = await signedInOwner();
    const created = await post(session, { first_name: "Иван", company_name: "ООО ТехКорп" });
    const id = created.json<{ data: ContactBody }>().data.id;

    const updated = await patch(session, id, { company_name: "" });
    const contact = updated.json<{ data: ContactBody }>().data;

    expect(contact.companyId).toBeNull();
    expect(contact.companyName).toBe("");
  });

  it("сбрасывает связь на компанию чужого арендатора, а не принимает её", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();

    const foreign = await post(other, { first_name: "Чужой", company_name: "ООО Чужая" });
    const foreignCompanyId = foreign.json<{ data: ContactBody }>().data.companyId;

    const res = await post(mine, {
      first_name: "Иван",
      company_id: foreignCompanyId,
      company_name: "ООО Чужая",
    });

    const contact = res.json<{ data: ContactBody }>().data;

    // Чужой идентификатор не сохраняется: у своего арендатора появляется своя
    // компания с тем же названием.
    expect(contact.companyId).not.toBe(foreignCompanyId);
    expect(await companyNames(mine.tenantId)).toEqual(["ООО Чужая"]);
  });
});

describe("Контакт: поиск", () => {
  it("находит по дополнительному номеру и по значению соцсети", async () => {
    const session = await signedInOwner();

    await post(session, {
      first_name: "Иван",
      phones: [{ number: "+79161234567" }, { number: "+79031112233" }],
      socials: [{ kind: "telegram", value: "@ivanuniq" }],
    });

    const byExtraPhone = await app.inject({
      method: "GET",
      url: "/api/v1/crm/contacts?search=79031112233",
      headers: { authorization: `Bearer ${session.token}` },
    });
    const bySocial = await app.inject({
      method: "GET",
      url: "/api/v1/crm/contacts?search=ivanuniq",
      headers: { authorization: `Bearer ${session.token}` },
    });

    // Клиент звонит со второго номера так же часто, как с первого.
    expect(byExtraPhone.json<{ data: ContactBody[] }>().data).toHaveLength(1);
    expect(bySocial.json<{ data: ContactBody[] }>().data).toHaveLength(1);
  });
});
