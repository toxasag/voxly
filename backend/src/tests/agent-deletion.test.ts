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
// Тесты безопасного удаления AI-агента (Soft Delete + Tenant Isolation).
//
// Проверяется:
// 1. Успешный DELETE /api/v1/ai/agents/:id (возвращает HTTP 204 No Content).
// 2. Исключение удалённого агента из списка GET /api/v1/ai/agents.
// 3. Повторный запрос DELETE по тому же id возвращает 404.
// 4. Попытка GET /api/v1/ai/agents/:id для удалённого агента возвращает 404.
// 5. Защита от IDOR: другой арендатор не может удалить чужого агента (404).
// 6. Очистка привязок каналов связи из `ai_agent_channel_bindings`.
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

interface SignedSession {
  token: string;
  tenantId: string;
  agentId: string;
}

async function signedInWithAgent(): Promise<SignedSession> {
  const tenant = await createTenant();
  const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

  await withTestDb(async (client) => {
    await client.query(
      `INSERT INTO installed_modules (tenant_id, slug, name)
       VALUES ($1, 'ai_bots', 'AI-агенты')`,
      [tenant.tenantId],
    );
  });

  const agentId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai_agents (tenant_id, name, model, system_prompt, status)
       VALUES ($1, $2, 'gpt-4o-mini', 'Ты консультант.', 'active')
       RETURNING id`,
      [tenant.tenantId, `Агент ${Math.random().toString(36).slice(2, 8)}`],
    );
    return result.rows[0]?.id ?? "";
  });

  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });

  return {
    token: login.json<{ data: { access_token: string } }>().data.access_token,
    tenantId: tenant.tenantId,
    agentId,
  };
}

describe("AI Agent Deletion (Safe Lifecycle & Tenant Isolation)", () => {
  it("удаляет агента со статусом 204 No Content и скрывает из списка", async () => {
    const session = await signedInWithAgent();

    // 1. Агент виден в списке до удаления
    const listBefore = await app.inject({
      method: "GET",
      url: "/api/v1/ai/agents",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(listBefore.statusCode).toBe(200);
    const botsBefore = listBefore.json<{ data: { id: string }[] }>().data;
    expect(botsBefore.some((b) => b.id === session.agentId)).toBe(true);

    // 2. Вызываем DELETE
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/ai/agents/${session.agentId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // 3. Агент больше не отдаётся в списке
    const listAfter = await app.inject({
      method: "GET",
      url: "/api/v1/ai/agents",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(listAfter.statusCode).toBe(200);
    const botsAfter = listAfter.json<{ data: { id: string }[] }>().data;
    expect(botsAfter.some((b) => b.id === session.agentId)).toBe(false);

    // 4. Прямой запрос по ID возвращает 404
    const getDeleted = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/${session.agentId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(getDeleted.statusCode).toBe(404);

    // 5. Повторный DELETE возвращает 404
    const deleteAgain = await app.inject({
      method: "DELETE",
      url: `/api/v1/ai/agents/${session.agentId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(deleteAgain.statusCode).toBe(404);
  });

  it("защита от IDOR: другой арендатор не может удалить чужого агента", async () => {
    const tenantA = await signedInWithAgent();
    const tenantB = await signedInWithAgent();

    // Tenant B пытается удалить агента Tenant A
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/ai/agents/${tenantA.agentId}`,
      headers: { authorization: `Bearer ${tenantB.token}` },
    });
    expect(res.statusCode).toBe(404);

    // Проверяем, что агент Tenant A остался жив
    const checkA = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/${tenantA.agentId}`,
      headers: { authorization: `Bearer ${tenantA.token}` },
    });
    expect(checkA.statusCode).toBe(200);
  });

  it("удаление агента очищает привязки каналов связи", async () => {
    const session = await signedInWithAgent();

    // Создаём канал и привязываем агента
    let channelAccountId = "";
    await withTestDb(async (client) => {
      const channelRes = await client.query<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
         VALUES ($1, 'telegram', 'Тест бот', '123456789', 'connected')
         RETURNING id`,
        [session.tenantId],
      );
      channelAccountId = channelRes.rows[0]?.id ?? "";

      await client.query(
        `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
         VALUES ($1, $2, $3, TRUE)`,
        [session.tenantId, session.agentId, channelAccountId],
      );
    });

    // Удаляем агента
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/ai/agents/${session.agentId}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Проверяем в БД, что привязка удалена
    const bindingsCount = await withTestDb(async (client) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS count FROM ai_agent_channel_bindings WHERE agent_id = $1`,
        [session.agentId],
      );
      return res.rows[0].count;
    });
    expect(bindingsCount).toBe(0);
  });
});
