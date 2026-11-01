#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Статус миграций: что применено, что ожидает, чего не хватает.
//
// У node-pg-migrate нет команды `status` — без этого скрипта проверять
// состояние приходилось бы вручную запросом к `pgmigrations`, а именно эта
// ручная сверка и была проблемой M6.2.7.
//
// Отдельно сообщает о «сиротах»: строках в `pgmigrations`, для которых файла
// больше нет. Это признак того, что миграцию удалили из репозитория после
// применения — молчать о таком нельзя, история перестаёт быть воспроизводимой.
// ---------------------------------------------------------------------------

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import config from "../migrate-config.cjs";

const MIGRATIONS_DIR = config["migrations-dir"];
const TABLE = config["migrations-table"];

function fail(message) {
  console.error(`migrate:status — ${message}`);
  process.exit(1);
}

if (!config.url) {
  fail(
    "не задана строка подключения. Укажите MIGRATION_DATABASE_URL либо POSTGRES_USER/POSTGRES_PASSWORD.",
  );
}

const files = (await readdir(join(process.cwd(), MIGRATIONS_DIR)))
  .filter((name) => name.endsWith(".sql") || name.endsWith(".js"))
  .sort();

const client = new pg.Client({ connectionString: config.url });

try {
  await client.connect();
} catch (error) {
  fail(`не удалось подключиться к БД: ${error.message}`);
}

let applied = [];
let tableExists = true;

try {
  const res = await client.query(
    `SELECT name, run_on FROM ${TABLE} ORDER BY id`,
  );
  applied = res.rows;
} catch (error) {
  // 42P01 = undefined_table: раннер ещё ни разу не запускался.
  if (error.code === "42P01") tableExists = false;
  else {
    await client.end();
    fail(`ошибка чтения ${TABLE}: ${error.message}`);
  }
}

await client.end();

const appliedNames = new Set(applied.map((row) => row.name));
const fileNames = files.map((name) => name.replace(/\.(sql|js)$/, ""));

console.log(`Каталог:  ${MIGRATIONS_DIR}`);
console.log(`Таблица:  ${TABLE}${tableExists ? "" : " (ещё не создана)"}`);
console.log("");

if (files.length === 0) {
  console.log("Файлов миграций нет.");
  process.exit(0);
}

const pending = [];

for (const name of fileNames) {
  const row = applied.find((item) => item.name === name);

  if (row === undefined) {
    pending.push(name);
    console.log(`  [ ] ${name}`);
  } else {
    const when = new Date(row.run_on).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  [x] ${name}  ${when}`);
  }
}

const orphans = [...appliedNames].filter((name) => !fileNames.includes(name));

if (orphans.length > 0) {
  console.log("");
  console.log("Применены, но файла нет (история невоспроизводима):");
  for (const name of orphans) console.log(`  [?] ${name}`);
}

console.log("");
console.log(
  `Итого: ${fileNames.length - pending.length} применено, ${pending.length} ожидает` +
    (orphans.length > 0 ? `, ${orphans.length} без файла` : ""),
);

// Ненулевой код при наличии ожидающих: позволяет использовать скрипт в CI и в
// проверках деплоя, а не только глазами.
if (pending.length > 0) process.exit(2);
