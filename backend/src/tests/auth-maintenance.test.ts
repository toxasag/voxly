import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestEnv, createTenant, createUser, hashToken } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import { runAuthMaintenance } from "../services/auth-maintenance.service.js";

// ---------------------------------------------------------------------------
// Тесты очистки просроченных строк аутентификации (M0.8.12).
//
// Проверяется и то, что удаляется, и то, что НЕ удаляется: слишком агрессивная
// очистка опаснее её отсутствия — удалённый преждевременно refresh-токен
// превратил бы кражу токена в обычный отказ без отзыва остальных сессий, а
// удалённый действующий код прервал бы вход у живого пользователя.
//
// Приложение здесь работает без HTTP: очистка вызывается напрямую, а окружение
// нужно только для `DATABASE_URL`.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await createTestDatabase();
  applyTestEnv();
});

afterAll(async () => {
  const { closePool } = await import("../db/client.js");
  await closePool();
  await dropTestDatabase();
});

beforeEach(async () => {
  await truncateTestData();
});

/** Строка `otp_codes` с заданной давностью истечения. */
async function seedOtpCode(input: {
  phone: string;
  expiredDaysAgo?: number;
  consumedDaysAgo?: number;
  validForMinutes?: number;
}): Promise<string> {
  return withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, consumed_at)
       VALUES ($1, 'dummy-hash',
               CASE WHEN $2::int IS NULL
                    THEN now() + ($4::int * INTERVAL '1 minute')
                    ELSE now() - ($2::int * INTERVAL '1 day') END,
               CASE WHEN $3::int IS NULL THEN NULL
                    ELSE now() - ($3::int * INTERVAL '1 day') END)
       RETURNING id`,
      [
        input.phone,
        input.expiredDaysAgo ?? null,
        input.consumedDaysAgo ?? null,
        input.validForMinutes ?? 5,
      ],
    );
    return result.rows[0]?.id ?? "";
  });
}

async function countRows(table: string): Promise<number> {
  return withTestDb(async (client) => {
    // Имя таблицы приходит из литералов этого файла, не из данных запроса.
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
    return Number(result.rows[0]?.count ?? "0");
  });
}

describe("runAuthMaintenance — otp_codes", () => {
  it("удаляет давно просроченные и давно погашенные коды", async () => {
    await seedOtpCode({ phone: "70000000001", expiredDaysAgo: 3 });
    await seedOtpCode({ phone: "70000000002", consumedDaysAgo: 5 });

    const report = await runAuthMaintenance();

    expect(report.otp_codes).toBe(2);
    expect(await countRows("otp_codes")).toBe(0);
  });

  it("сохраняет действующий код и недавно истёкший", async () => {
    await seedOtpCode({ phone: "70000000003", validForMinutes: 5 });
    // Истёк час назад: пользователь ещё должен получить «Срок действия истёк», а
    // не «Неверный код».
    await seedOtpCode({ phone: "70000000004", expiredDaysAgo: 0 });

    const report = await runAuthMaintenance();

    expect(report.otp_codes).toBe(0);
    expect(await countRows("otp_codes")).toBe(2);
  });
});

describe("runAuthMaintenance — auth_sessions", () => {
  async function seedSession(input: {
    expiredDaysAgo?: number;
    consumedDaysAgo?: number;
  }): Promise<void> {
    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO auth_sessions (purpose, channel, phone, expires_at, consumed_at)
         VALUES ('login', 'telegram', '70000000005',
                 CASE WHEN $1::int IS NULL THEN now() + INTERVAL '5 minutes'
                      ELSE now() - ($1::int * INTERVAL '1 day') END,
                 CASE WHEN $2::int IS NULL THEN NULL
                      ELSE now() - ($2::int * INTERVAL '1 day') END)`,
        [input.expiredDaysAgo ?? null, input.consumedDaysAgo ?? null],
      );
    });
  }

  it("удаляет просроченные и погашенные сессии подтверждения", async () => {
    await seedSession({ expiredDaysAgo: 2 });
    await seedSession({ consumedDaysAgo: 4 });
    await seedSession({});

    const report = await runAuthMaintenance();

    expect(report.auth_sessions).toBe(2);
    expect(await countRows("auth_sessions")).toBe(1);
  });
});

describe("runAuthMaintenance — password_reset_tokens", () => {
  async function seedResetToken(input: {
    userId: string;
    tenantId: string;
    expiredDaysAgo?: number;
  }): Promise<void> {
    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, tenant_id, token_hash, expires_at)
         VALUES ($1, $2, $3,
                 CASE WHEN $4::int IS NULL THEN now() + INTERVAL '1 hour'
                      ELSE now() - ($4::int * INTERVAL '1 day') END)`,
        [
          input.userId,
          input.tenantId,
          hashToken(`reset-${Math.random()}`),
          input.expiredDaysAgo ?? null,
        ],
      );
    });
  }

  it("хранит истёкшие ссылки неделю: следы запроса нужны при разборе жалоб", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    await seedResetToken({ userId: user.id, tenantId: tenant.tenantId, expiredDaysAgo: 2 });
    await seedResetToken({ userId: user.id, tenantId: tenant.tenantId, expiredDaysAgo: 10 });

    const report = await runAuthMaintenance();

    // Удаляется только та, что старше срока хранения.
    expect(report.password_reset_tokens).toBe(1);
    expect(await countRows("password_reset_tokens")).toBe(1);
  });
});

describe("runAuthMaintenance — refresh_tokens", () => {
  async function seedRefreshToken(input: {
    userId: string;
    tenantId: string;
    expiredDaysAgo?: number;
    revokedDaysAgo?: number;
    replacedBy?: string | null;
  }): Promise<string> {
    return withTestDb(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at, revoked_at, replaced_by)
         VALUES ($1, $2, $3,
                 CASE WHEN $4::int IS NULL THEN now() + INTERVAL '30 days'
                      ELSE now() - ($4::int * INTERVAL '1 day') END,
                 CASE WHEN $5::int IS NULL THEN NULL
                      ELSE now() - ($5::int * INTERVAL '1 day') END,
                 $6)
         RETURNING id`,
        [
          input.tenantId,
          input.userId,
          hashToken(`refresh-${Math.random()}`),
          input.expiredDaysAgo ?? null,
          input.revokedDaysAgo ?? null,
          input.replacedBy ?? null,
        ],
      );
      return result.rows[0]?.id ?? "";
    });
  }

  it("удаляет давно истёкшие, но сохраняет действующие", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    await seedRefreshToken({ userId: user.id, tenantId: tenant.tenantId, expiredDaysAgo: 40 });
    await seedRefreshToken({ userId: user.id, tenantId: tenant.tenantId });

    const report = await runAuthMaintenance();

    expect(report.refresh_tokens).toBe(1);
    expect(await countRows("refresh_tokens")).toBe(1);
  });

  it("сохраняет недавно отозванный: он ещё нужен для обнаружения кражи", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    await seedRefreshToken({ userId: user.id, tenantId: tenant.tenantId, revokedDaysAgo: 3 });

    const report = await runAuthMaintenance();

    expect(report.refresh_tokens).toBe(0);
    expect(await countRows("refresh_tokens")).toBe(1);
  });

  it("удаляет всю просроченную цепочку ротации за один прогон", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    // Цепочка из четырёх звеньев, как её строит `issueTokens`: каждое старое
    // ссылается через `replaced_by` на следующее, более новое.
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(
        await seedRefreshToken({
          userId: user.id,
          tenantId: tenant.tenantId,
          expiredDaysAgo: 40,
        }),
      );
    }

    await withTestDb(async (client) => {
      for (let index = 0; index < ids.length - 1; index += 1) {
        await client.query(`UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1`, [
          ids[index],
          ids[index + 1],
        ]);
      }
    });

    // Один прогон, а не четыре: прежняя реализация пропускала строки, на которые
    // кто-то ссылается, и снимала по одному звену в сутки — при ротации раз в 15
    // минут таблица продолжала расти.
    const report = await runAuthMaintenance();

    expect(report.refresh_tokens).toBe(4);
    expect(await countRows("refresh_tokens")).toBe(0);
  });

  it("разрывает ссылку из действующего токена на просроченный, не удаляя действующий", async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.tenantId });

    const expired = await seedRefreshToken({
      userId: user.id,
      tenantId: tenant.tenantId,
      expiredDaysAgo: 40,
    });
    const active = await seedRefreshToken({ userId: user.id, tenantId: tenant.tenantId });

    // Просроченное звено ссылается на действующее — обычная картина для сессии,
    // которую давно и непрерывно продлевают.
    await withTestDb(async (client) => {
      await client.query(`UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1`, [
        expired,
        active,
      ]);
    });

    const report = await runAuthMaintenance();

    expect(report.refresh_tokens).toBe(1);

    const remaining = await withTestDb(async (client) => {
      const result = await client.query<{ id: string; replaced_by: string | null }>(
        `SELECT id, replaced_by FROM refresh_tokens`,
      );
      return result.rows;
    });

    // Действующий токен на месте: каскад снёс бы его вместе с родителем.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(active);
  });
});

describe("runAuthMaintenance — приглашения", () => {
  it("снимает токен просроченного приглашения, но не удаляет самого сотрудника", async () => {
    const tenant = await createTenant();

    const userId = await withTestDb(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO users
           (tenant_id, email, name, role, permissions, invite_token_hash,
            invited_at, invite_expires_at)
         VALUES ($1, 'stale-invite@example.com', 'Приглашённый', 'viewer', '{}', $2,
                 now() - INTERVAL '30 days', now() - INTERVAL '20 days')
         RETURNING id`,
        [tenant.tenantId, hashToken("stale-token")],
      );
      return result.rows[0]?.id ?? "";
    });

    const report = await runAuthMaintenance();
    expect(report.invite_tokens).toBe(1);

    const row = await withTestDb(async (client) => {
      const result = await client.query<{
        invite_token_hash: string | null;
        deleted_at: Date | null;
      }>(`SELECT invite_token_hash, deleted_at FROM users WHERE id = $1`, [userId]);
      return result.rows[0];
    });

    // Токен снят: хранить хеш нечего, ссылка всё равно отклоняется по сроку.
    expect(row?.invite_token_hash).toBeNull();
    // Строка на месте: она занимает место в тарифе и видна администратору со
    // статусом «Приглашён». Молчаливое исчезновение сотрудника и уменьшение
    // счёта — решение администратора, а не задачи обслуживания.
    expect(row?.deleted_at).toBeNull();
  });

  it("не трогает действующее приглашение и активированного сотрудника", async () => {
    const tenant = await createTenant();

    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO users
           (tenant_id, email, name, role, permissions, invite_token_hash,
            invited_at, invite_expires_at)
         VALUES ($1, 'fresh-invite@example.com', 'Приглашённый', 'viewer', '{}', $2,
                 now(), now() + INTERVAL '48 hours')`,
        [tenant.tenantId, hashToken("fresh-token")],
      );
    });

    await createUser({ tenantId: tenant.tenantId });

    const report = await runAuthMaintenance();

    expect(report.invite_tokens).toBe(0);
  });
});

describe("runAuthMaintenance — идемпотентность", () => {
  it("повторный прогон на пустых таблицах ничего не удаляет и не падает", async () => {
    const first = await runAuthMaintenance();
    const second = await runAuthMaintenance();

    for (const report of [first, second]) {
      expect(report.otp_codes).toBe(0);
      expect(report.auth_sessions).toBe(0);
      expect(report.password_reset_tokens).toBe(0);
      expect(report.refresh_tokens).toBe(0);
      expect(report.invite_tokens).toBe(0);
    }
  });
});
