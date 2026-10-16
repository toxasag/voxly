// ---------------------------------------------------------------------------
// Конфигурация node-pg-migrate.
//
// Отдельное подключение под владельцем БД, а НЕ основной `DATABASE_URL`.
//
// Причина не в удобстве: приложение подключается как `app_user` — роль,
// созданная миграцией 0002 специально лишённой прав (`NOSUPERUSER`,
// `NOBYPASSRLS`) ради работающего RLS. Проверено на проде: `CREATE TABLE` от её
// имени отдаёт `permission denied for schema public`. Выдать ей права на схему
// означало бы обесценить изоляцию арендаторов, ради которой она и появилась.
//
// Поэтому раннер использует `MIGRATION_DATABASE_URL` (роль-владелец
// `getvoxly`), а приложение продолжает работать под `app_user`. Два разных
// подключения — это следствие модели безопасности, а не дублирование.
//
// Файл в CommonJS: node-pg-migrate читает конфиг через `require`, и ESM-модуль
// (`"type": "module"` в package.json) он загрузить не сможет — отсюда
// расширение `.cjs`.
// ---------------------------------------------------------------------------

/**
 * Строка подключения для миграций.
 *
 * Приоритет: явный `MIGRATION_DATABASE_URL` → сборка из `POSTGRES_*`.
 *
 * `DATABASE_URL` сознательно НЕ используется как откат: он указывает на
 * `app_user`, у которого нет прав на DDL, и такой откат давал бы не рабочий
 * запуск, а невнятное `permission denied for schema public` на первой же
 * миграции. Лучше явно вернуть `undefined` — вызывающий (`migrate-status`,
 * `migrate-plan`) сообщит, какую переменную нужно задать.
 */
function resolveDatabaseUrl() {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;

  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT } =
    process.env;

  if (POSTGRES_USER && POSTGRES_PASSWORD) {
    const host = POSTGRES_HOST || "db";
    const port = POSTGRES_PORT || "5432";
    const database = POSTGRES_DB || POSTGRES_USER;
    // Пароль может содержать `@`, `/` и `#` — без экранирования строка
    // подключения распалась бы на неверные части.
    const password = encodeURIComponent(POSTGRES_PASSWORD);
    return `postgresql://${POSTGRES_USER}:${password}@${host}:${port}/${database}`;
  }

  return undefined;
}

// Имена ключей соответствуют тому, что CLI действительно читает (функция
// `readJson` в `bin/node-pg-migrate.js`), а не документации: строка подключения
// берётся из `url`, каталог — из `migrations-dir`. Проверено чтением исходника
// после того, как вариант с `databaseUrl`/`dir` молча не сработал и раннер
// пожаловался на отсутствие DATABASE_URL.
//
// ВАЖНО: npm-скрипты передают `-d MIGRATION_DATABASE_URL`. Без этого флага CLI
// читает `process.env.DATABASE_URL` **до** конфига (строка 227 в
// `bin/node-pg-migrate.js`) и присваивает значение из конфига через `??=`, то
// есть только когда переменной нет. В контейнере `DATABASE_URL` задан и указывает
// на `app_user` — раннер подключался его ролью и падал с
// `permission denied for schema public` при создании `pgmigrations`. Локально
// дефект не проявлялся, потому что там `DATABASE_URL` не выставлен.
module.exports = {
  url: resolveDatabaseUrl(),

  // Существующие файлы 0001–0009 остаются на месте: путь к ним не менялся,
  // потому что все девять уже применены на проде и упомянуты в CHANGELOG по
  // этим именам. Переносить их в другой каталог значило бы рассинхронизировать
  // историю с документацией без единой выгоды.
  "migrations-dir": "src/db/migrations",

  // Чистый SQL, без обёрток на JS: миграции писались как `.sql` и содержат
  // DO-блоки, которые в JS-обёртке пришлось бы экранировать.
  "migration-file-language": "sql",

  // Нумерация `0001_name.sql` вместо метки времени по умолчанию: девять
  // существующих файлов названы так, и смена формата рассинхронизировала бы
  // новые файлы с историей.
  "migration-filename-format": "index",

  // Имя по умолчанию у node-pg-migrate; задание называет именно `pgmigrations`.
  "migrations-table": "pgmigrations",

  // Порядок применения проверяется: файл с меньшим номером, добавленный после
  // уже применённого старшего, должен остановить прогон, а не примениться вне
  // очереди.
  "check-order": true,
};
