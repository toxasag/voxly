#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Определяет, что делать со схемой: baseline или обычный прогон.
//
// Вынесено из entrypoint отдельным файлом: SQL внутри `node -e` внутри `sh`
// требует трёх уровней экранирования, и такая строка ломается при первой же
// правке.
//
// Печатает одно слово, которое читает entrypoint:
//   baseline — таблицы есть, истории нет → пометить применённым (--fake)
//   up       — обычный прогон непримененных
//   wait     — БД недоступна
//
// Почему baseline вообще нужен: миграции 0001–0009 инкрементальны, они изменяют
// схему из `schema.sql`. На пустой БД они падают с
// `relation "users" does not exist` — проверено. Значит для БД, где схема уже
// создана initdb, а `pgmigrations` ещё нет, единственный корректный путь —
// отметить их применёнными.
// ---------------------------------------------------------------------------

import pg from "pg";
import config from "../migrate-config.cjs";

async function main() {
  if (!config.url) {
    process.stderr.write("migration url is not configured\n");
    process.stdout.write("wait");
    return;
  }

  const client = new pg.Client({ connectionString: config.url, connectionTimeoutMillis: 4000 });

  try {
    await client.connect();
  } catch {
    process.stdout.write("wait");
    return;
  }

  try {
    // `users` появляется только из schema.sql через initdb, поэтому её наличие —
    // надёжный признак уже созданной схемы.
    const { rows } = await client.query(
      `SELECT to_regclass('public.users') IS NOT NULL AS has_schema,
              to_regclass('public.' || $1) IS NOT NULL AS has_tracking`,
      [config["migrations-table"]],
    );

    const row = rows[0];
    process.stdout.write(row.has_schema && !row.has_tracking ? "baseline" : "up");
  } catch (error) {
    process.stderr.write(`schema probe failed: ${error.message}\n`);
    process.stdout.write("wait");
  } finally {
    await client.end().catch(() => {});
  }
}

await main();
