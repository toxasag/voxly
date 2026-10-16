// ---------------------------------------------------------------------------
// Индексы и валидация ограничений после 0020.
//
// Единственная миграция проекта на JavaScript, а не на SQL, и причина
// конкретная: `CREATE INDEX CONCURRENTLY` нельзя выполнить внутри транзакции
// («cannot run inside a transaction block»), а раннер оборачивает в транзакцию
// каждую миграцию. Флаг `--no-single-transaction` не помогает — проверено на
// postgres:16, миграция падает с той же ошибкой 25001, потому что при снятом
// общем BEGIN раннер начинает оборачивать каждый файл по отдельности. Обойти это
// умеет только `pgm.noTransaction()`, доступный из JS-миграции: он выводит файл
// из транзакции целиком.
//
// Почему индексы и валидация вообще вынесены из 0020: там уже удерживается
// ACCESS EXCLUSIVE на contacts от первого ALTER TABLE до COMMIT. Сборка двух
// GIN-индексов и валидация трёх ограничений внутри этого окна означали бы
// недоступность таблицы контактов на всё время прогона — на проде это заметно, а
// на тестовой базе нет.
//
// CONCURRENTLY при сбое оставляет нерабочий индекс. Проверка после прогона:
//   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
//   WHERE NOT i.indisvalid AND c.relname LIKE 'idx_contacts_%';
// Такой индекс снимается `DROP INDEX CONCURRENTLY <name>` и создаётся заново.
// ---------------------------------------------------------------------------

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // Выводит эту миграцию из транзакции: без этого CONCURRENTLY не выполнится.
  pgm.noTransaction();

  // Поиск контакта по любому из его номеров (crm-pipeline ищет по входящему
  // звонку или сообщению) идёт по JSONB — без GIN он читал бы таблицу целиком.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_additional_phones
      ON contacts USING gin (additional_phones jsonb_path_ops)
  `);

  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_socials
      ON contacts USING gin (socials jsonb_path_ops)
  `);

  // Секция «Контакты» на карточке компании фильтрует по company_id. Индекс
  // создаётся до VALIDATE CONSTRAINT ниже: валидации внешнего ключа он тоже
  // пригодится.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company
      ON contacts(tenant_id, company_id)
      WHERE deleted_at IS NULL AND company_id IS NOT NULL
  `);

  // VALIDATE CONSTRAINT берёт SHARE UPDATE EXCLUSIVE: чтение и запись в contacts
  // продолжают работать, в отличие от добавления сразу валидного ограничения,
  // которое держит ACCESS EXCLUSIVE на весь скан.
  //
  // Данные к этому моменту заведомо соответствуют ограничениям: JSONB-колонки
  // созданы в 0020 с DEFAULT '[]', висячие и кросс-тенантные company_id там же
  // обнулены. Валидация — подтверждение, а не исправление.
  pgm.sql("ALTER TABLE contacts VALIDATE CONSTRAINT contacts_additional_phones_shape");
  pgm.sql("ALTER TABLE contacts VALIDATE CONSTRAINT contacts_socials_shape");
  pgm.sql("ALTER TABLE contacts VALIDATE CONSTRAINT contacts_company_id_fkey");
};

/**
 * Откат: индексы снимаются, ограничения возвращаются в состояние NOT VALID.
 *
 * `DROP INDEX CONCURRENTLY` тоже требует работы вне транзакции, поэтому
 * `noTransaction` нужен и здесь.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.noTransaction();

  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_company");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_socials");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_additional_phones");

  // Снять признак «валидно» отдельной командой нельзя: ограничение пересоздаётся
  // как NOT VALID. Определения повторяют 0020 — при их правке нужно менять оба
  // места, поэтому здесь стоит эта пометка.
  pgm.sql(`
    ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_company_id_fkey;
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      NOT VALID
  `);
};
