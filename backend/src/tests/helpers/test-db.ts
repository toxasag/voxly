import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

// ---------------------------------------------------------------------------
// Тестовая база: создаётся с нуля, схема применяется из `db/schema.sql`.
//
// Подключение приложения идёт под `app_user` — той же непривилегированной ролью,
// что и на проде. Это не формальность: политики RLS объявлены с
// `FORCE ROW LEVEL SECURITY`, но суперпользователь обходит их через
// `rolbypassrls`, поэтому тест под `postgres` показывал бы изоляцию работающей
// независимо от того, работает ли она. Ровно этот дефект миграция 0002 и
// закрывала на проде.
//
// Схема берётся из `schema.sql`, а не из прогона миграций: миграции применяются
// к уже существующей базе (0001–0009 писались как заплатки к работающему проду),
// а `schema.sql` описывает чистую установку целиком, включая RLS и триггеры.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, "../../db/schema.sql");

/** Подключение суперпользователя для DDL. Локально Homebrew-postgres без пароля. */
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres";

const TEST_DB_NAME = process.env.TEST_DATABASE_NAME ?? "getvoxly_test";

/**
 * Роль приложения **для тестов**, отдельная от рабочей `app_user`.
 *
 * Имя обязано отличаться: `CREATE ROLE` и `ALTER ROLE` — операции уровня
 * кластера, а не базы данных. Прежняя версия безусловно выполняла
 * `ALTER ROLE app_user PASSWORD '<тестовый>'`, то есть прогон тестов менял пароль
 * роли, под которой к тому же кластеру подключается рабочая или локальная
 * dev-база, и ломал ей аутентификацию. Проверено: роль `app_user` на машине
 * разработчика существует, и запуск тестов её пароль перезаписывал.
 *
 * Переопределяется `TEST_APP_ROLE`, если на кластере это имя уже занято.
 */
const TEST_APP_ROLE = process.env.TEST_APP_ROLE ?? "getvoxly_test_app_user";

/** Пароль тестовой роли. Не секрет: база локальная и пересоздаётся каждый прогон. */
const TEST_APP_PASSWORD = "test_app_user";

/**
 * Идентификатор роли для интерполяции в DDL.
 *
 * Имя роли нельзя передать параметром запроса, поэтому значение проверяется по
 * закрытому шаблону: оно приходит из константы либо из переменной окружения
 * разработчика, но интерполируется в SQL и обязано быть безопасным.
 */
function quotedTestRole(): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(TEST_APP_ROLE)) {
    throw new Error(
      `TEST_APP_ROLE must match /^[a-z_][a-z0-9_]{0,62}$/, got: ${TEST_APP_ROLE}`,
    );
  }

  // Явный запрет на рабочую роль: тесты выполняют по ней ALTER, и переданное
  // через окружение `app_user` вернуло бы исправленный дефект — смену пароля у
  // роли, под которой к тому же кластеру подключается рабочая база.
  if (TEST_APP_ROLE === "app_user") {
    throw new Error(
      "TEST_APP_ROLE must not be the production role `app_user`: the test harness alters this role.",
    );
  }

  return `"${TEST_APP_ROLE}"`;
}

function adminUrlFor(database: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Строка подключения приложения к тестовой базе — под непривилегированной ролью. */
export function testDatabaseUrl(): string {
  const url = new URL(adminUrlFor(TEST_DB_NAME));
  url.username = TEST_APP_ROLE;
  url.password = TEST_APP_PASSWORD;
  return url.toString();
}

async function withAdminClient<T>(
  database: string,
  handler: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: adminUrlFor(database) });
  await client.connect();

  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

/**
 * Пересоздаёт тестовую базу и применяет схему.
 *
 * `DROP DATABASE` вместо очистки таблиц: остаток от предыдущего прогона с другой
 * схемой давал бы ошибки, которые выглядят как дефекты кода.
 */
export async function createTestDatabase(): Promise<void> {
  await withAdminClient("postgres", async (client) => {
    // Активные соединения предыдущего прогона (например от упавшего теста)
    // блокируют DROP; отключаем их принудительно.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB_NAME],
    );

    // Идентификатор базы нельзя передать параметром — интерполируется имя из
    // константы/переменной окружения этого файла, а не из данных запроса.
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
    await client.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  });

  const schema = readFileSync(SCHEMA_PATH, "utf8");

  await withAdminClient(TEST_DB_NAME, async (client) => {
    // Один вызов со всем файлом: pg отправляет запрос без параметров простым
    // протоколом, который допускает несколько операторов и dollar-quoted блоки.
    await client.query(schema);

    // Роль приложения для тестов: те же ограничения, что задаёт миграция 0002
    // рабочей роли `app_user`, включая NOINHERIT — без него тест проверял бы
    // роль с иным набором прав, чем на проде.
    //
    // Пароль задаётся только при создании: если роль уже существует (прошлый
    // прогон), менять её пароль незачем, а безусловный ALTER именно и был
    // дефектом прежней версии.
    const role = quotedTestRole();

    await client.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_APP_ROLE}') THEN
           CREATE ROLE ${role} LOGIN PASSWORD '${TEST_APP_PASSWORD}'
             NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
         END IF;
       END
       $$`,
    );

    // Идемпотентно приводит роль к ожидаемому состоянию, если она осталась от
    // прогона со старой версией харнесса. Пароль выравнивается здесь же —
    // иначе роль с забытым паролем сделала бы тесты неподключаемыми. Это
    // безопасно ровно потому, что `quotedTestRole()` запрещает подставить сюда
    // рабочую `app_user`.
    await client.query(
      `ALTER ROLE ${role} PASSWORD '${TEST_APP_PASSWORD}'
         NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
    );

    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  });
}

/**
 * Таблицы, которые чистятся между тестами.
 *
 * Перечислены явно, а не через `pg_tables`: справочники (`reserved_slugs`,
 * `marketplace_modules`) заполняются схемой, и очистка сломала бы проверку
 * зарезервированных поддоменов.
 *
 * `tenants` и `users` идут каскадом, поэтому дочерние таблицы перечислять не
 * нужно; `otp_codes`, `auth_sessions` и `password_reset_tokens` не ссылаются на
 * арендатора обязательным ключом и очищаются отдельно.
 */
const TRUNCATED_TABLES = [
  "tenants",
  "otp_codes",
  "auth_sessions",
  "password_reset_tokens",
] as const;

/** Очищает данные между тестами, сохраняя схему и справочники. */
export async function truncateTestData(): Promise<void> {
  await withAdminClient(TEST_DB_NAME, async (client) => {
    await client.query(
      `TRUNCATE ${TRUNCATED_TABLES.map((table) => `"${table}"`).join(", ")} CASCADE`,
    );
  });
}

/** Прямой доступ к БД под суперпользователем — для подготовки данных и проверок. */
export async function withTestDb<T>(handler: (client: Client) => Promise<T>): Promise<T> {
  return withAdminClient(TEST_DB_NAME, handler);
}

/** Сносит тестовую базу после прогона. */
export async function dropTestDatabase(): Promise<void> {
  await withAdminClient("postgres", async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB_NAME],
    );
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
  });
}
