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
// Изоляция арендаторов в сделках (`M7.7.13`, `M7.7.14`).
//
// Два места, где изоляция держалась не на проверке, а на удаче:
//
// 1. Подписи связей в выборке сделок собирались JOIN-ами только по id. Таблица
//    `users` не входит в список под RLS (см. блок `tenant_isolation` в
//    schema.sql), а у `deals.contact_id` и `company_id` нет даже внешнего ключа —
//    поэтому чужой идентификатор подставлял в ответ имя пользователя или название
//    компании другого арендатора.
//
// 2. `PATCH /deals/:id` писал `stage_id`, `contact_id`, `company_id` и `owner_id`
//    прямо из тела запроса. `createInTx` и `moveStage` принадлежность проверяли,
//    `update` — нет.
//
// Тесты сознательно записывают кросс-тенантные ссылки напрямую в БД: через API
// их теперь не создать, а проверять нужно именно поведение чтения на уже
// испорченных данных — ровно то, что могло остаться в базе до этих правок.
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
  userName: string;
}

async function signedInOwner(): Promise<Signed> {
  const tenant = await createTenant();
  const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });

  const name = await withTestDb(async (client) => {
    const result = await client.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [
      owner.id,
    ]);
    return result.rows[0]?.name ?? "";
  });

  return {
    token: res.json<{ data: { access_token: string } }>().data.access_token,
    tenantId: tenant.tenantId,
    userId: owner.id,
    userName: name,
  };
}

/** Воронка со одной стадией: без них сделку не создать. */
async function createPipeline(tenantId: string): Promise<{ pipelineId: string; stageId: string }> {
  return withTestDb(async (client) => {
    const pipeline = await client.query<{ id: string }>(
      `INSERT INTO pipelines (tenant_id, name, sort_order) VALUES ($1, 'Основная', 0) RETURNING id`,
      [tenantId],
    );
    const pipelineId = pipeline.rows[0]?.id ?? "";

    // У stages нет своего tenant_id: арендатор наследуется через воронку. Именно
    // поэтому проверка стадии в сервисе идёт JOIN-ом на pipelines.
    const stage = await client.query<{ id: string }>(
      `INSERT INTO stages (pipeline_id, name, sort_order)
       VALUES ($1, 'Новая', 0) RETURNING id`,
      [pipelineId],
    );

    return { pipelineId, stageId: stage.rows[0]?.id ?? "" };
  });
}

async function createContact(tenantId: string, firstName: string): Promise<string> {
  return withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO contacts (tenant_id, first_name) VALUES ($1, $2) RETURNING id`,
      [tenantId, firstName],
    );
    return result.rows[0]?.id ?? "";
  });
}

async function createCompany(tenantId: string, name: string): Promise<string> {
  return withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO companies (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, name],
    );
    return result.rows[0]?.id ?? "";
  });
}

interface DealBody {
  id: string;
  companyName: string | null;
  contactName: string | null;
  ownerName: string | null;
}

async function createDeal(
  session: Signed,
  pipelineId: string,
  stageId: string,
  title = "Сделка",
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/crm/deals",
    headers: { authorization: `Bearer ${session.token}` },
    payload: { title, budget: 1000, currency: "RUB", pipeline_id: pipelineId, stage_id: stageId },
  });

  return res.json<{ data: DealBody }>().data.id;
}

describe("Сделки: подписи связей не пересекают арендаторов", () => {
  it("не показывает название компании чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);

    const dealId = await createDeal(mine, pipelineId, stageId);
    const foreignCompany = await createCompany(other.tenantId, "ЧУЖАЯ КОМПАНИЯ");

    // Ссылка ставится напрямую: у deals.company_id нет FK, поэтому такие данные
    // могли попасть в базу до появления проверок.
    await withTestDb(async (client) => {
      await client.query("UPDATE deals SET company_id = $1 WHERE id = $2", [foreignCompany, dealId]);
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: DealBody }>().data.companyName).toBeNull();
  });

  it("не показывает имя контакта чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);

    const dealId = await createDeal(mine, pipelineId, stageId);
    const foreignContact = await createContact(other.tenantId, "Чужой");

    await withTestDb(async (client) => {
      await client.query("UPDATE deals SET contact_id = $1 WHERE id = $2", [foreignContact, dealId]);
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(res.json<{ data: DealBody }>().data.contactName).toBeNull();
  });

  it("не показывает имя ответственного из чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);

    const dealId = await createDeal(mine, pipelineId, stageId);

    // users вне RLS: без предиката по арендатору JOIN достал бы эту строку.
    await withTestDb(async (client) => {
      await client.query("UPDATE deals SET owner_id = $1 WHERE id = $2", [other.userId, dealId]);
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    const deal = res.json<{ data: DealBody }>().data;
    expect(deal.ownerName).toBeNull();
    expect(deal.ownerName).not.toBe(other.userName);
  });

  it("показывает собственные подписи связей", async () => {
    const session = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(session.tenantId);

    const dealId = await createDeal(session, pipelineId, stageId);
    const companyId = await createCompany(session.tenantId, "ООО Своя");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { company_id: companyId },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });

    // Предикат по арендатору не должен ломать нормальный случай.
    const deal = res.json<{ data: DealBody }>().data;
    expect(deal.companyName).toBe("ООО Своя");
    expect(deal.ownerName).toBe(session.userName);
  });
});

describe("Сделки: PATCH отклоняет чужие ссылки", () => {
  async function patchDeal(
    session: Signed,
    dealId: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; code?: string }> {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/crm/deals/${dealId}`,
      headers: { authorization: `Bearer ${session.token}` },
      payload,
    });

    return {
      status: res.statusCode,
      code: res.statusCode >= 400
        ? res.json<{ error: { code: string } }>().error.code
        : undefined,
    };
  }

  it("отклоняет контакт чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);
    const dealId = await createDeal(mine, pipelineId, stageId);

    const foreignContact = await createContact(other.tenantId, "Чужой");
    const result = await patchDeal(mine, dealId, { contact_id: foreignContact });

    expect(result.status).toBe(400);
    expect(result.code).toBe("VALIDATION_ERROR");

    const stored = await withTestDb(async (client) => {
      const rows = await client.query<{ contact_id: string | null }>(
        "SELECT contact_id FROM deals WHERE id = $1",
        [dealId],
      );
      return rows.rows[0]?.contact_id ?? null;
    });

    expect(stored).toBeNull();
  });

  it("отклоняет компанию чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);
    const dealId = await createDeal(mine, pipelineId, stageId);

    const foreignCompany = await createCompany(other.tenantId, "ЧУЖАЯ");
    const result = await patchDeal(mine, dealId, { company_id: foreignCompany });

    expect(result.status).toBe(400);
  });

  it("отклоняет ответственного из чужого арендатора", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);
    const dealId = await createDeal(mine, pipelineId, stageId);

    const result = await patchDeal(mine, dealId, { owner_id: other.userId });

    expect(result.status).toBe(400);
  });

  it("отклоняет стадию из чужой воронки", async () => {
    const mine = await signedInOwner();
    const other = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(mine.tenantId);
    const foreign = await createPipeline(other.tenantId);
    const dealId = await createDeal(mine, pipelineId, stageId);

    const result = await patchDeal(mine, dealId, { stage_id: foreign.stageId });

    // Ту же проверку делает moveStage: сделка не может стоять в стадии чужой воронки.
    expect(result.status).toBe(400);
  });

  it("принимает собственные ссылки", async () => {
    const session = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(session.tenantId);
    const dealId = await createDeal(session, pipelineId, stageId);

    const contactId = await createContact(session.tenantId, "Свой");
    const companyId = await createCompany(session.tenantId, "ООО Своя");

    const result = await patchDeal(session, dealId, {
      contact_id: contactId,
      company_id: companyId,
      owner_id: session.userId,
      stage_id: stageId,
    });

    expect(result.status).toBe(200);
  });

  it("позволяет снять связь пустой строкой", async () => {
    const session = await signedInOwner();
    const { pipelineId, stageId } = await createPipeline(session.tenantId);
    const dealId = await createDeal(session, pipelineId, stageId);
    const contactId = await createContact(session.tenantId, "Свой");

    await patchDeal(session, dealId, { contact_id: contactId });
    const result = await patchDeal(session, dealId, { contact_id: "" });

    expect(result.status).toBe(200);

    const stored = await withTestDb(async (client) => {
      const rows = await client.query<{ contact_id: string | null }>(
        "SELECT contact_id FROM deals WHERE id = $1",
        [dealId],
      );
      return rows.rows[0]?.contact_id ?? null;
    });

    expect(stored).toBeNull();
  });
});
