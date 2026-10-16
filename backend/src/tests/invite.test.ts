import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  createTenant,
  createUser,
  hashToken,
} from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";

// ---------------------------------------------------------------------------
// Интеграционные тесты приглашений сотрудников (M6.3.3).
//
// Приглашение — единственный путь появления пользователя, кроме регистрации
// владельца, и он проходит через публичные `/auth/invite*`, потому что
// приглашённый ещё не может войти. Такой эндпоинт легко ломается незаметно:
// строка `users` создана, но неактивна, и любая ошибка в фильтрах приводит либо
// к 500 на argon2 от NULL-хеша, либо к активации по просроченной ссылке.
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

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, string[]> };
}

/**
 * Приглашение записывается напрямую.
 *
 * Через API его создать можно (`POST /api/v1/tenant/team/invite`), но токен
 * наружу не отдаётся — он уходит только в письме, а SMTP в тестах выключен.
 * Здесь проверяется приём приглашения, поэтому значение токена должно быть
 * известно.
 */
async function inviteUser(input: {
  tenantId: string;
  email?: string;
  role?: "admin" | "manager" | "technician" | "viewer";
  expired?: boolean;
}): Promise<{ userId: string; token: string; email: string }> {
  const email = input.email ?? `invited-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const token = `invite-${Math.random().toString(36).slice(2)}${Date.now()}`;

  const userId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users
         (tenant_id, email, name, role, permissions, invite_token_hash,
          invited_at, invite_expires_at)
       VALUES ($1, $2, $3, $4, '{}', $5, now(),
               now() + ($6::int * INTERVAL '1 hour'))
       RETURNING id`,
      [
        input.tenantId,
        email,
        "Приглашённый",
        input.role ?? "manager",
        hashToken(token),
        input.expired === true ? -1 : 48,
      ],
    );
    return result.rows[0]?.id ?? "";
  });

  return { userId, token, email };
}

/**
 * Приглашение через реальный `POST /api/v1/tenant/team/invite`.
 *
 * Нужно там, где важно поведение самого приглашения (например выдача прав по
 * роли): его выполняет `TeamService.invite`, и прямая вставка строки этот код
 * обошла бы. Токен наружу не отдаётся, поэтому после вызова его хеш заменяется
 * известным значением — так проверяется настоящая цепочка, но остаётся
 * возможность перейти по ссылке.
 */
async function inviteViaApi(input: {
  tenantId: string;
  email: string;
  role: "admin" | "manager" | "technician" | "viewer";
}): Promise<{ userId: string; token: string; email: string }> {
  const owner = await createUser({ tenantId: input.tenantId, role: "owner" });

  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });
  const accessToken = login.json<{ data: { access_token: string } }>().data.access_token;

  const invited = await app.inject({
    method: "POST",
    url: "/api/v1/tenant/team/invite",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {
      name: "Приглашённый",
      email: input.email,
      role: input.role,
      confirmExtraSeat: true,
    },
  });

  if (invited.statusCode !== 201 && invited.statusCode !== 200) {
    throw new Error(`Invite failed: ${invited.statusCode} ${invited.body}`);
  }

  const userId = invited.json<{ data: { member: { id: string } } }>().data.member.id;
  const token = `invite-api-${Math.random().toString(36).slice(2)}${Date.now()}`;

  await withTestDb(async (client) => {
    await client.query(`UPDATE users SET invite_token_hash = $2 WHERE id = $1`, [
      userId,
      hashToken(token),
    ]);
  });

  return { userId, token, email: input.email };
}

describe("GET /auth/invite", () => {
  it("отдаёт компанию и роль, но не идентификаторы и не хеши", async () => {
    const tenant = await createTenant();
    const invite = await inviteUser({ tenantId: tenant.tenantId, role: "manager" });

    const res = await app.inject({ method: "GET", url: `/auth/invite?token=${invite.token}` });

    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: { email: string; companyName: string; role: string; roleLabel: string };
    }>();

    expect(body.data.email).toBe(invite.email);
    expect(body.data.companyName).toBe(tenant.slug);
    expect(body.data.role).toBe("manager");
    expect(body.data.roleLabel).toBe("Менеджер");

    // Ни идентификаторов, ни хешей: эндпоинт публичный.
    expect(res.body).not.toContain(invite.userId);
    expect(res.body).not.toContain("invite_token_hash");
    expect(res.body).not.toContain("password");
  });

  it("отклоняет просроченную и неизвестную ссылку одинаково", async () => {
    const tenant = await createTenant();
    const expired = await inviteUser({ tenantId: tenant.tenantId, expired: true });

    const expiredRes = await app.inject({
      method: "GET",
      url: `/auth/invite?token=${expired.token}`,
    });
    const unknownRes = await app.inject({
      method: "GET",
      url: "/auth/invite?token=never-issued-invite-token",
    });

    expect(expiredRes.statusCode).toBe(400);
    expect(unknownRes.statusCode).toBe(400);
    expect(expiredRes.json<ErrorBody>().error.code).toBe("INVALID_INVITE_TOKEN");
    expect(unknownRes.json<ErrorBody>().error.message).toBe(
      expiredRes.json<ErrorBody>().error.message,
    );
  });
});

describe("POST /auth/invite/accept", () => {
  const password = "invited-password-1";
  const phone = "79005553311";

  it("активирует учётную запись и позволяет войти", async () => {
    const tenant = await createTenant();
    const invite = await inviteUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone },
    });

    expect(res.statusCode).toBe(200);

    const row = await withTestDb(async (client) => {
      const result = await client.query<{
        activated_at: Date | null;
        invite_token_hash: string | null;
        phone: string | null;
      }>(`SELECT activated_at, invite_token_hash, phone FROM users WHERE id = $1`, [invite.userId]);
      return result.rows[0];
    });

    expect(row?.activated_at).not.toBeNull();
    // Токен гасится: ссылка одноразовая.
    expect(row?.invite_token_hash).toBeNull();
    expect(row?.phone).toBe(phone);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: invite.email, password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("выдаёт права по роли, а не пустой набор", async () => {
    const tenant = await createTenant();

    // Приглашение создаётся полным путём через API: права записывает
    // `TeamService.invite`, а не `accept`, поэтому прямая вставка строки
    // проверила бы не тот код. Токен затем подменяется известным значением —
    // наружу он не отдаётся, а SMTP в тестах выключен.
    const invite = await inviteViaApi({
      tenantId: tenant.tenantId,
      role: "manager",
      email: "manager-invite@example.com",
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone },
    });
    expect(accepted.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: invite.email, password },
    });

    const permissions = login.json<{ data: { user: { permissions: string[] } } }>().data.user
      .permissions;

    // Менеджер: CRM целиком, но без `tenant:admin` — иначе приглашённый
    // управлял бы составом сотрудников.
    expect(permissions).toContain("contacts:write");
    expect(permissions).not.toContain("tenant:admin");
  });

  it("не принимает ссылку дважды", async () => {
    const tenant = await createTenant();
    const invite = await inviteUser({ tenantId: tenant.tenantId });

    const first = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone },
    });
    const second = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password: "another-password", phone: "79005553322" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
    expect(second.json<ErrorBody>().error.code).toBe("INVALID_INVITE_TOKEN");
  });

  it("отклоняет просроченную ссылку", async () => {
    const tenant = await createTenant();
    const invite = await inviteUser({ tenantId: tenant.tenantId, expired: true });

    const res = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone },
    });

    expect(res.statusCode).toBe(400);
  });

  it("отклоняет телефон, уже занятый в этой компании", async () => {
    const tenant = await createTenant();
    const existing = await createUser({ tenantId: tenant.tenantId, phone: "79001234567" });
    const invite = await inviteUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone: existing.phone },
    });

    // 409 с полем формы, а не 500 от нарушения уникального индекса.
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("PHONE_TAKEN");
    expect(res.json<ErrorBody>().error.details?.phone?.[0]).toBeDefined();
  });

  it("принимает тот же телефон в другой компании", async () => {
    const first = await createTenant();
    const second = await createTenant();

    const sharedPhone = "79007654321";
    await createUser({ tenantId: first.tenantId, phone: sharedPhone });
    const invite = await inviteUser({ tenantId: second.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone: sharedPhone },
    });

    // Уникальность телефона — в пределах арендатора: один человек законно
    // работает в двух компаниях.
    expect(res.statusCode).toBe(200);
  });

  it("требует телефон и пароль не короче восьми символов", async () => {
    const tenant = await createTenant();
    const invite = await inviteUser({ tenantId: tenant.tenantId });

    const shortPassword = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password: "short", phone },
    });
    const badPhone = await app.inject({
      method: "POST",
      url: "/auth/invite/accept",
      payload: { token: invite.token, password, phone: "123" },
    });

    expect(shortPassword.statusCode).toBe(400);
    expect(badPhone.statusCode).toBe(400);
    expect(shortPassword.json<ErrorBody>().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Управление сотрудниками", () => {
  /** Токен владельца: список и приглашение закрыты `tenant:admin`. */
  async function ownerToken(tenantId: string): Promise<string> {
    const owner = await createUser({ tenantId, role: "owner" });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    return res.json<{ data: { access_token: string } }>().data.access_token;
  }

  it("показывает приглашённого со статусом invited и считает занятые места", async () => {
    const tenant = await createTenant();
    const token = await ownerToken(tenant.tenantId);
    await inviteUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenant/team",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: { members: { status: string }[]; seats: { used: number; included: number } };
    }>();

    // Владелец + приглашённый: место занимает и неактивированная строка, иначе
    // лимит тарифа обходился бы приглашениями.
    expect(body.data.members).toHaveLength(2);
    expect(body.data.members.some((member) => member.status === "invited")).toBe(true);
    expect(body.data.seats.used).toBe(2);
  });

  it("закрывает список сотрудников от рядовой роли", async () => {
    const tenant = await createTenant();
    const manager = await createUser({ tenantId: tenant.tenantId, role: "manager" });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: manager.email, password: manager.password },
    });
    const token = login.json<{ data: { access_token: string } }>().data.access_token;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenant/team",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorBody>().error.code).toBe("PERMISSION_DENIED");
  });

  it("не показывает сотрудников чужой компании", async () => {
    const mine = await createTenant();
    const other = await createTenant();

    const token = await ownerToken(mine.tenantId);
    await createUser({ tenantId: other.tenantId, role: "manager" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenant/team",
      headers: { authorization: `Bearer ${token}` },
    });

    const emails = res
      .json<{ data: { members: { email: string }[] } }>()
      .data.members.map((member) => member.email);

    // Только владелец собственной компании.
    expect(emails).toHaveLength(1);
  });

  it("отклоняет попытку пригласить владельца", async () => {
    const tenant = await createTenant();
    const token = await ownerToken(tenant.tenantId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenant/team/invite",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Второй владелец",
        email: "second-owner@example.com",
        role: "owner",
        confirmExtraSeat: true,
      },
    });

    // Второй владелец через приглашение означал бы неограниченную передачу прав
    // на биллинг.
    expect(res.statusCode).toBe(400);
  });

  it("мягко удаляет сотрудника и сразу закрывает ему доступ", async () => {
    const tenant = await createTenant();
    const token = await ownerToken(tenant.tenantId);
    const victim = await createUser({ tenantId: tenant.tenantId, role: "manager" });

    const victimLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: victim.email, password: victim.password },
    });
    const victimToken = victimLogin.json<{
      data: { access_token: string; refresh_token: string };
    }>().data;

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/tenant/team/${victim.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(200);

    // Access-токен живёт 15 минут, но `resolveUser` фильтрует `deleted_at`:
    // доступ закрывается сразу, а не по истечении токена.
    const afterRemoval = await app.inject({
      method: "GET",
      url: "/api/v1/tenant/info",
      headers: { authorization: `Bearer ${victimToken.access_token}` },
    });
    expect(afterRemoval.statusCode).toBe(401);

    // Refresh-токены отозваны, иначе сессия восстановилась бы.
    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: victimToken.refresh_token },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it("меняет роль и приводит права к новой роли", async () => {
    const tenant = await createTenant();
    const token = await ownerToken(tenant.tenantId);
    const member = await createUser({ tenantId: tenant.tenantId, role: "viewer" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/tenant/team/${member.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "manager" },
    });

    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: member.email, password: member.password },
    });

    const permissions = login.json<{ data: { user: { permissions: string[] } } }>().data.user
      .permissions;

    // Права следуют за ролью: иначе наблюдатель, ставший менеджером, не смог бы
    // редактировать контакты.
    expect(permissions).toContain("contacts:write");
  });

  it("не позволяет менять роль сотруднику чужой компании", async () => {
    const mine = await createTenant();
    const other = await createTenant();

    const token = await ownerToken(mine.tenantId);
    const foreign = await createUser({ tenantId: other.tenantId, role: "viewer" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/tenant/team/${foreign.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(404);

    const unchanged = await withTestDb(async (client) => {
      const result = await client.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
        foreign.id,
      ]);
      return result.rows[0]?.role;
    });

    expect(unchanged).toBe("viewer");
  });
});
