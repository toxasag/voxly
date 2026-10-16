import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  createAuthSession,
  createTenant,
  createUser,
  uniqueRemoteAddress,
} from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";

// ---------------------------------------------------------------------------
// Интеграционные тесты авторизации (M6.3.3).
//
// Проверяется поведение через HTTP, а не внутренние методы: регрессия auth-потока
// раньше ловилась одноразовыми скриптами, которые затем удалялись, поэтому
// повторно ошибка обнаруживалась только вручную на проде.
//
// Отдельное внимание к дефектам, исправленным в этой итерации: `M0.12.6`
// (адресат кода по e-mail, не по номеру), `M0.12.8` (код не расходуется при
// ошибке регистрации), `M0.12.11` (время ответа восстановления пароля).
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

interface TokensBody {
  data: {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string; role: string; permissions: string[] };
    tenant: { id: string; slug: string; plan: string; status: string };
  };
}

describe("POST /auth/login", () => {
  it("выдаёт токены и права владельца по верному паролю", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<TokensBody>();
    expect(body.data.user.email).toBe(user.email);
    expect(body.data.tenant.slug).toBe(tenant.slug);
    expect(body.data.user.permissions).toContain("tenant:admin");
    expect(body.data.access_token.length).toBeGreaterThan(0);
  });

  it("отвечает одинаково на неизвестный адрес и на неверный пароль", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "not-the-password" },
    });

    const unknownEmail = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: user.password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    // Тексты обязаны совпадать: различие превращало бы эндпоинт в проверку
    // существования адреса.
    expect(unknownEmail.json<ErrorBody>().error.message).toBe(
      wrongPassword.json<ErrorBody>().error.message,
    );
  });

  it("не пускает удалённого сотрудника", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId, deleted: true });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(401);
  });

  it("не пускает приглашённого без пароля и не падает на NULL-хеше", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId, activated: false });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "anything" },
    });

    // Именно 401, а не 500: argon2 на NULL-хеше бросал бы исключение.
    expect(res.statusCode).toBe(401);
  });

  it("отклоняет вход в приостановленный аккаунт", async () => {
    const tenant = await createTenant({ status: "suspended" });
    const user = await createUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorBody>().error.code).toBe("TENANT_INACTIVE");
  });
});

describe("POST /auth/login/verify — второй фактор", () => {
  it("пускает при верном пароле и коде", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const session = await createAuthSession({
      purpose: "login",
      phone: user.phone,
      email: user.email,
      verified: false,
      telegramChatId: 100_500,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<TokensBody>().data.user.email).toBe(user.email);
  });

  it("проверяет пароль раньше кода: верный код не пускает с чужим паролем", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const session = await createAuthSession({
      purpose: "login",
      phone: user.phone,
      email: user.email,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: "wrong",
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(401);

    // Код не должен быть израсходован отказом по паролю: попытки остаются на
    // нуле, а сессия — непогашенной.
    const row = await withTestDb(async (client) => {
      const result = await client.query<{ attempts: number; consumed_at: Date | null }>(
        `SELECT attempts, consumed_at FROM auth_sessions WHERE id = $1`,
        [session.sessionId],
      );
      return result.rows[0];
    });

    expect(row?.attempts).toBe(0);
    expect(row?.consumed_at).toBeNull();
  });

  it("расходует попытку на неверный код и гасит сессию после исчерпания", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const session = await createAuthSession({
      purpose: "login",
      phone: user.phone,
      email: user.email,
      code: "111111",
      // OTP_MAX_ATTEMPTS по умолчанию 5: одна оставшаяся попытка.
      attempts: 4,
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: "999999",
      },
    });

    expect(wrong.statusCode).toBe(401);

    const exhausted = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: "111111",
      },
    });

    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json<ErrorBody>().error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("пускает пользователя без телефона: сверка идёт по владельцу, не по номеру", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    // Телефон очищен — состояние достижимо через профиль (`profile.service.ts`
    // пишет NULL при пустом значении) и у приглашённого сотрудника.
    await withTestDb(async (client) => {
      await client.query(`UPDATE users SET phone = NULL WHERE id = $1`, [user.id]);
    });

    // Сессия с заглушкой вместо номера — ровно то, что теперь создаёт
    // `requestCode` для пользователя без телефона.
    const session = await createAuthSession({
      purpose: "login",
      phone: "unknown-deadbeefdeadbeef",
      email: user.email,
      userId: user.id,
      telegramChatId: 555_001,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    // Сверка по телефону отказала бы здесь всегда: у пользователя номера нет, а
    // в сессии стоит заглушка.
    expect(res.statusCode).toBe(200);
  });

  it("не принимает сессию, выданную другому пользователю", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const other = await createUser({ tenantId: tenant.tenantId, role: "manager" });

    // Сессия принадлежит другому владельцу, но e-mail и телефон подставлены от
    // атакуемого: сверка обязана опереться на `user_id`.
    const session = await createAuthSession({
      purpose: "login",
      phone: user.phone,
      email: user.email,
      userId: other.id,
      telegramChatId: 555_002,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<ErrorBody>().error.message).toContain("другой учётной записи");
  });

  it("не принимает код, выданный для другого номера (M0.12.6)", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    // Сессия того же назначения, но с чужим телефоном: ровно та ситуация,
    // которую создавал прежний резолв адресата по номеру среди всех арендаторов.
    const foreign = await createAuthSession({
      purpose: "login",
      phone: "70000000000",
      email: user.email,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: foreign.sessionId,
        code: foreign.code,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<ErrorBody>().error.message).toContain("другого номера");
  });

  it("сохраняет адресата у пользователя только после доказанного входа", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const session = await createAuthSession({
      purpose: "login",
      phone: user.phone,
      email: user.email,
      telegramChatId: 777_001,
      verified: false,
    });

    const before = await withTestDb(async (client) => {
      const result = await client.query<{ telegram_chat_id: string | null }>(
        `SELECT telegram_chat_id::text FROM users WHERE id = $1`,
        [user.id],
      );
      return result.rows[0]?.telegram_chat_id ?? null;
    });
    expect(before).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(200);

    const after = await withTestDb(async (client) => {
      const result = await client.query<{ telegram_chat_id: string | null }>(
        `SELECT telegram_chat_id::text FROM users WHERE id = $1`,
        [user.id],
      );
      return result.rows[0]?.telegram_chat_id ?? null;
    });

    expect(after).toBe("777001");
  });
});

describe("POST /auth/register", () => {
  const password = "register-password-1";

  it("создаёт арендатора с владельцем и сразу выдаёт токены", async () => {
    const phone = "79001112233";
    const session = await createAuthSession({
      purpose: "register",
      phone,
      email: "owner@newco.example",
      verified: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        slug: "newco",
        email: "owner@newco.example",
        phone,
        password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(201);

    const body = res.json<TokensBody>();
    expect(body.data.tenant.slug).toBe("newco");
    expect(body.data.user.role).toBe("owner");
    expect(body.data.tenant.status).toBe("trial");

    // Владелец активен сразу: без `activated_at` он не прошёл бы выборки входа.
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@newco.example", password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("отклоняет зарезервированный поддомен", async () => {
    const phone = "79001112244";
    const session = await createAuthSession({
      purpose: "register",
      phone,
      email: "owner@reserved.example",
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        slug: "admin",
        email: "owner@reserved.example",
        phone,
        password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>().error.details?.slug?.[0]).toContain("зарезервирован");
  });

  it("не расходует код при занятом поддомене — тем же кодом проходит вторая попытка (M0.12.8)", async () => {
    const existing = await createTenant({ slug: "occupied" });
    expect(existing.slug).toBe("occupied");

    const phone = "79001112255";
    const email = "owner@retry.example";
    const session = await createAuthSession({ purpose: "register", phone, email });

    const failed = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        slug: "occupied",
        email,
        phone,
        password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(failed.statusCode).toBe(400);

    // Сессия осталась непогашенной — это и есть суть исправления.
    const row = await withTestDb(async (client) => {
      const result = await client.query<{ consumed_at: Date | null }>(
        `SELECT consumed_at FROM auth_sessions WHERE id = $1`,
        [session.sessionId],
      );
      return result.rows[0];
    });
    expect(row?.consumed_at).toBeNull();

    const retried = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        slug: "free-slug",
        email,
        phone,
        password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(retried.statusCode).toBe(201);
    expect(retried.json<TokensBody>().data.tenant.slug).toBe("free-slug");
  });

  it("не принимает повторное использование погашенного кода", async () => {
    const phone = "79001112266";
    const email = "owner@once.example";
    const session = await createAuthSession({ purpose: "register", phone, email });

    const first = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { slug: "once-a", email, phone, password, session_id: session.sessionId, code: session.code },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        slug: "once-b",
        email: "other@once.example",
        phone,
        password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(second.statusCode).toBe(401);
  });

  it("не принимает код, выданный для регистрации, на входе", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });
    const session = await createAuthSession({
      purpose: "register",
      phone: user.phone,
      email: user.email,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login/verify",
      payload: {
        email: user.email,
        password: user.password,
        session_id: session.sessionId,
        code: session.code,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<ErrorBody>().error.message).toContain("другой операции");
  });
});

describe("GET /auth/slug-available", () => {
  it("различает свободный, занятый и зарезервированный поддомен", async () => {
    await createTenant({ slug: "taken-slug" });

    const free = await app.inject({ method: "GET", url: "/auth/slug-available?slug=quite-free" });
    const taken = await app.inject({ method: "GET", url: "/auth/slug-available?slug=taken-slug" });
    const reserved = await app.inject({ method: "GET", url: "/auth/slug-available?slug=api" });

    expect(free.json<{ data: { available: boolean } }>().data.available).toBe(true);
    expect(taken.json<{ data: { reason: string } }>().data.reason).toBe("TAKEN");
    expect(reserved.json<{ data: { reason: string } }>().data.reason).toBe("RESERVED");
  });
});

describe("POST /auth/refresh и /auth/logout", () => {
  async function signIn(): Promise<{ refresh: string; access: string; userId: string }> {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });

    const body = res.json<TokensBody>();
    return { refresh: body.data.refresh_token, access: body.data.access_token, userId: user.id };
  }

  it("ротирует токен: прежний перестаёт действовать", async () => {
    const { refresh } = await signIn();

    const first = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: refresh },
    });
    expect(first.statusCode).toBe(200);

    const rotated = first.json<TokensBody>().data.refresh_token;
    expect(rotated).not.toBe(refresh);

    const replay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: refresh },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("повторное предъявление отозванного токена гасит всю семью", async () => {
    const { refresh, userId } = await signIn();

    const rotated = (
      await app.inject({ method: "POST", url: "/auth/refresh", payload: { refresh_token: refresh } })
    ).json<TokensBody>().data.refresh_token;

    // Утечка: старый токен предъявляют снова.
    await app.inject({ method: "POST", url: "/auth/refresh", payload: { refresh_token: refresh } });

    // Свежий токен обязан перестать работать — иначе кража остаётся незамеченной.
    const afterFamilyRevoke = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: rotated },
    });
    expect(afterFamilyRevoke.statusCode).toBe(401);

    const active = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      return result.rows[0]?.count ?? "0";
    });
    expect(active).toBe("0");
  });

  it("не выдаёт токены по refresh-токену удалённого сотрудника", async () => {
    const { refresh, userId } = await signIn();

    await withTestDb(async (client) => {
      await client.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [userId]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: refresh },
    });

    expect(res.statusCode).toBe(401);
  });

  it("logout идемпотентен", async () => {
    const { refresh } = await signIn();

    const first = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: refresh },
    });
    const second = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: refresh },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: refresh },
    });
    expect(reuse.statusCode).toBe(401);
  });
});

describe("POST /auth/forgot-password", () => {
  it("отвечает одинаково для известного и неизвестного адреса", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const known = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: user.email },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: "nobody@example.com" },
    });

    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.body).toBe(unknown.body);
  });

  it("не ждёт SMTP: ответ приходит, токен записан (M0.12.11)", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const res = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: user.email },
    });

    expect(res.statusCode).toBe(200);

    const tokens = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM password_reset_tokens WHERE user_id = $1`,
        [user.id],
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(tokens).toBe("1");
  });

  it("выдаёт ссылку живому сотруднику, а не его удалённому однофамильцу", async () => {
    const tenant = await createTenant();

    // Уволенный и повторно принятый под тем же адресом: частичный индекс
    // `idx_users_tenant_email_active` (WHERE deleted_at IS NULL) это допускает.
    const removed = await createUser({
      tenantId: tenant.tenantId,
      email: "same@example.com",
      deleted: true,
    });
    const active = await createUser({
      tenantId: tenant.tenantId,
      email: "same@example.com",
      role: "manager",
    });

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: "same@example.com" },
    });

    const owners = await withTestDb(async (client) => {
      const result = await client.query<{ user_id: string }>(
        `SELECT user_id FROM password_reset_tokens`,
      );
      return result.rows.map((row) => row.user_id);
    });

    // Токен обязан принадлежать живой строке: иначе пароль менялся бы у
    // удалённой, а настоящий аккаунт оставался с прежним при погашенной ссылке.
    expect(owners).toEqual([active.id]);
    expect(owners).not.toContain(removed.id);
  });

  it("не создаёт ссылку для приглашённого, ещё не задавшего пароль", async () => {
    const tenant = await createTenant();
    const invited = await createUser({ tenantId: tenant.tenantId, activated: false });

    const res = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: invited.email },
    });

    expect(res.statusCode).toBe(200);

    const tokens = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM password_reset_tokens WHERE user_id = $1`,
        [invited.id],
      );
      return result.rows[0]?.count ?? "0";
    });

    // Сброс задал бы пароль аккаунту, который вход всё равно отвергает
    // (`activated_at IS NULL`): активация идёт по ссылке приглашения.
    expect(tokens).toBe("0");
  });

  it("новый запрос гасит прежнюю ссылку", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: user.email },
    });
    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress: uniqueRemoteAddress(),
      payload: { email: user.email },
    });

    const active = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM password_reset_tokens
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id],
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(active).toBe("1");
  });
});

describe("POST /auth/reset-password", () => {
  /** Токен пишется напрямую: письмо не отправляется, а значение известно только сервису. */
  async function issueResetToken(
    userId: string,
    tenantId: string,
    options: { expired?: boolean; consumed?: boolean } = {},
  ): Promise<string> {
    const { hashToken } = await import("./helpers/test-app.js");
    const token = `reset-${Math.random().toString(36).slice(2)}${Date.now()}`;

    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, tenant_id, token_hash, expires_at, consumed_at)
         VALUES ($1, $2, $3, now() + ($4::int * INTERVAL '1 minute'), $5)`,
        [
          userId,
          tenantId,
          hashToken(token),
          options.expired === true ? -10 : 60,
          options.consumed === true ? new Date() : null,
        ],
      );
    });

    return token;
  }

  it("меняет пароль и завершает все сессии", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const signedIn = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const oldRefresh = signedIn.json<TokensBody>().data.refresh_token;

    const token = await issueResetToken(user.id, tenant.tenantId);

    const res = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token, password: "brand-new-password" },
    });
    expect(res.statusCode).toBe(200);

    const withNew = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "brand-new-password" },
    });
    expect(withNew.statusCode).toBe(200);

    const withOld = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    expect(withOld.statusCode).toBe(401);

    // Смену пароля используют при подозрении на компрометацию: уцелевшая сессия
    // обесценила бы её.
    const refreshAfterReset = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: oldRefresh },
    });
    expect(refreshAfterReset.statusCode).toBe(401);
  });

  it("отклоняет просроченный, погашенный и неизвестный токен", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const expired = await issueResetToken(user.id, tenant.tenantId, { expired: true });
    const consumed = await issueResetToken(user.id, tenant.tenantId, { consumed: true });

    for (const token of [expired, consumed, "never-issued-token"]) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "another-password" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe("INVALID_RESET_TOKEN");
    }
  });
});

describe("POST /auth/code/request", () => {
  it("отвечает 503, когда транспорт канала не настроен", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/code/request",
      remoteAddress: uniqueRemoteAddress(),
      payload: { purpose: "login", channel: "telegram", email: "someone@example.com" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json<ErrorBody>().error.code).toBe("TELEGRAM_UNAVAILABLE");
  });

  it("требует телефон для регистрации и e-mail для входа", async () => {
    const noPhone = await app.inject({
      method: "POST",
      url: "/auth/code/request",
      remoteAddress: uniqueRemoteAddress(),
      payload: { purpose: "register", channel: "telegram" },
    });
    const noEmail = await app.inject({
      method: "POST",
      url: "/auth/code/request",
      remoteAddress: uniqueRemoteAddress(),
      payload: { purpose: "login", channel: "telegram" },
    });

    expect(noPhone.statusCode).toBe(400);
    expect(noEmail.statusCode).toBe(400);
    expect(noPhone.json<ErrorBody>().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Вебхуки ботов", () => {
  it("отклоняют вызов без секрета, когда секрет не настроен", async () => {
    for (const url of ["/auth/telegram/webhook", "/auth/max/webhook"]) {
      const res = await app.inject({ method: "POST", url, payload: { message: {} } });

      // 401, а не 200: отсутствие ожидаемого секрета трактуется как отказ, иначе
      // публичный эндпоинт принимал бы поддельные обновления.
      expect(res.statusCode).toBe(401);
    }
  });
});

describe("Гейт аутентификации на защищённых маршрутах", () => {
  const protectedRoutes = [
    "/api/v1/crm/contacts",
    "/api/v1/tenant/info",
    "/api/v1/profile",
    "/api/v1/ai/agents",
    "/api/v1/marketplace/modules",
  ] as const;

  it("отвечает 401 без токена", async () => {
    for (const url of protectedRoutes) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("отвечает 401 на подделанный токен", async () => {
    for (const url of protectedRoutes) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer not.a.real.token" },
      });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("не принимает refresh-токен как bearer", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const refresh = login.json<TokensBody>().data.refresh_token;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/crm/contacts",
      headers: { authorization: `Bearer ${refresh}` },
    });

    // Refresh-токен — случайные байты, а не JWT: подпись не проверяется.
    expect(res.statusCode).toBe(401);
  });

  it("пропускает владельца с валидным access-токеном", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const access = login.json<TokensBody>().data.access_token;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenant/info",
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("закрывает платформенную админку от владельца арендатора", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId, role: "owner" });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const access = login.json<TokensBody>().data.access_token;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tenants",
      headers: { authorization: `Bearer ${access}` },
    });

    // Тенантный owner ≠ platform_owner: иначе владелец любой компании видел бы
    // данные всех остальных.
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /health", () => {
  it("подтверждает доступность БД", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ database: string }>().database).toBe("up");
  });
});
