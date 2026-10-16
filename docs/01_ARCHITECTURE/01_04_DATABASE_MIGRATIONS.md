# 01_04 — МИГРАЦИИ БД

Порядок работы с версионированными миграциями (`M6.2.7`). Инструмент —
[`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) 9.x.

> Источник: `backend/migrate-config.cjs`, `backend/docker-entrypoint.sh`,
> `backend/scripts/migrate-status.mjs`, `backend/scripts/migrate-plan.mjs`.
> Создан 2026-08-23.

---

## 1. Почему миграции применяются отдельной ролью

Приложение подключается как **`app_user`** — роль, созданная миграцией `0002`
намеренно лишённой прав (`NOSUPERUSER`, `NOBYPASSRLS`) ради работающего RLS.
Проверено на проде: `CREATE TABLE` от её имени отдаёт
`permission denied for schema public`.

Поэтому раннер использует **`MIGRATION_DATABASE_URL`** (роль-владелец
`getvoxly`), а приложение продолжает работать под `app_user`. Два разных
подключения — следствие модели безопасности, а не дублирование настройки. Выдать
`app_user` права на схему означало бы обесценить изоляцию арендаторов.

По той же причине миграции запускаются **из entrypoint контейнера, а не из
`server.ts`**: внутри процесса приложения доступен только пул `app_user`.

### Подводный камень: `-d MIGRATION_DATABASE_URL`

Все npm-скрипты передают флаг `-d MIGRATION_DATABASE_URL`. Без него CLI читает
`process.env.DATABASE_URL` **до** конфига (строка 227 в
`bin/node-pg-migrate.js`) и применяет значение из конфига через `??=`, то есть
только когда переменной нет. В контейнере `DATABASE_URL` задан и указывает на
`app_user` — раннер подключался его ролью и падал при создании `pgmigrations`.
Локально дефект не проявлялся, потому что там `DATABASE_URL` не выставлен.

**Не убирайте этот флаг** из скриптов.

---

## 2. Команды

Все выполняются из `backend/`.

| Команда | Назначение |
|---|---|
| `npm run migrate:status` | что применено, что ожидает, есть ли «сироты» |
| `npm run migrate:up` | применить непримененные |
| `npm run migrate:down` | откатить последнюю (см. §5 — работает не для всех) |
| `npm run migrate:create <имя>` | создать файл со следующим номером |
| `npm run migrate:dry` | показать SQL без выполнения |
| `npm run migrate:baseline` | пометить применёнными без выполнения (`--fake`) |

Локально нужна переменная окружения:

```bash
MIGRATION_DATABASE_URL="postgres://postgres@127.0.0.1:5432/getvoxly" npm run migrate:status
```

`migrate:status` возвращает код `2`, если есть ожидающие миграции — годится для
проверок в CI. Через `npm run` код проглатывается, поэтому в CI вызывайте
напрямую: `node scripts/migrate-status.mjs`.

---

## 3. Как добавить миграцию

```bash
cd backend
npm run migrate:create add-something      # → src/db/migrations/0010_add-something.sql
```

Затем:

1. **Напишите SQL идемпотентно** (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`).
   Это не суеверие: та же миграция применяется к базам в разных состояниях, а при
   отладке её запускают повторно.
2. **Обновите `src/db/schema.sql`.** Он не генерируется из миграций — это
   отдельный файл, который `initdb` выполняет на чистом volume. Расхождение между
   ними означает, что новая установка получит другую схему, чем существующая.
   Именно так возник дефект с `users.platform_role` (см. §6).
3. Проверьте оба пути:

```bash
# путь миграции — на копии существующей БД
createdb probe && pg_dump getvoxly | psql probe
MIGRATION_DATABASE_URL=...probe npm run migrate:up

# путь чистой установки — schema.sql с нуля
createdb fresh && psql fresh -f src/db/schema.sql && psql fresh -f src/db/02-seed.sql
```

4. Убедитесь, что схемы совпали:

```bash
psql probe -tAc "select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1" | sort > /tmp/a
psql fresh -tAc "select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1" | sort > /tmp/b
diff /tmp/a /tmp/b   # ожидается только pgmigrations.*
```

---

## 4. Что происходит при старте контейнера

`docker-entrypoint.sh` определяет состояние БД (`scripts/migrate-plan.mjs`) и
выбирает действие:

| Состояние БД | Действие |
|---|---|
| Таблиц нет, истории нет | `migrate:up` — обычный прогон |
| Таблицы есть, истории нет | `migrate:baseline` — пометить применёнными |
| История есть | `migrate:up` — применить новые |
| БД недоступна | 30 попыток по 2с, затем контейнер падает |

**При падении миграции контейнер не стартует.** Это осознанно: приложение на
схеме, которая не доехала, работает хуже, чем не работает совсем — часть запросов
проходит, часть падает на отсутствующих колонках, данные пишутся наполовину.

### Почему baseline вообще нужен

Миграции `0001`–`0009` **инкрементальны**: они изменяют схему, созданную
`schema.sql`. На пустой БД они падают с `relation "users" does not exist` —
проверено. Для базы, где схема уже создана `initdb`, а `pgmigrations` ещё нет,
единственный корректный путь — отметить их применёнными, а не прогонять.

Признак «схема создана» — наличие таблицы `users`: она появляется только из
`schema.sql`.

---

## 5. Откат: чего ожидать

`migrate:down` работает **только** для миграций с секцией отката. Существующие
`0001`–`0009` её не имеют — при попытке отката раннер отвечает
`User has disabled down migration on file: …` и ничего не делает. Это лучше, чем
молча испортить схему, но означает, что **откат существующих миграций возможен
только восстановлением из дампа**.

Для новых миграций секцию отката можно добавить явно:

```sql
-- Up Migration
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS nickname;
```

Перед изменением схемы на проде всегда снимайте дамп:

```bash
docker exec getvoxly-db-1 pg_dump -U getvoxly -d getvoxly | gzip > /root/getvoxly-backups/db-$(date +%Y%m%d-%H%M%S).sql.gz
```

Требование не декоративное: `docker-entrypoint.sh` вызывает `migrate:up` при
каждом старте контейнера, поэтому обычный `docker compose up -d backend`
применит и разрушающий backfill. Миграция `0020` из-за этого сохраняет исходные
значения в служебную таблицу `contacts_company_backfill_0020` — она даёт
точечный откат без полного restore и остаётся в БД до отдельной миграции,
которая её снимет после подтверждения результата.

---

## 5.1. Долгие операции: блокировки и транзакция раннера

Раннер оборачивает прогон в транзакцию (`single-transaction` включён по
умолчанию), поэтому `ACCESS EXCLUSIVE`, взятый первым `ALTER TABLE`, держится до
`COMMIT` — то есть до конца файла. Всё, что стоит после, выполняется при
полностью закрытой таблице, включая чтение.

Отсюда правила для больших таблиц:

- **`CHECK` и `FOREIGN KEY` добавляйте как `NOT VALID`**, а `VALIDATE CONSTRAINT`
  выносите отдельным шагом: валидация берёт `SHARE UPDATE EXCLUSIVE` и не
  блокирует ни чтение, ни запись. Добавление сразу валидного ограничения сканирует
  таблицу целиком под `ACCESS EXCLUSIVE`.
- **Индексы создавайте `CONCURRENTLY`** и только в отдельной миграции.
- **`CREATE INDEX CONCURRENTLY` не работает ни в SQL-миграции, ни с
  `--no-single-transaction`.** Проверено на postgres:16: в обоих случаях
  PostgreSQL отвечает `25001 cannot run inside a transaction block`, потому что при
  снятом общем `BEGIN` раннер начинает оборачивать каждый файл по отдельности.
  Единственный работающий способ — JS-миграция с `pgm.noTransaction()`, которая
  выводит файл из транзакции целиком. Пример: `0021_contact_indexes_and_validation.js`.
  Загрузчик раннера выбирает обработчик по расширению файла, а не по
  `migration-file-language`, поэтому `.js` рядом с `.sql` работает без правки
  конфига.
- **Массовый `UPDATE` проходит через триггер `updated_at`** и переписывает дату
  последнего изменения всем затронутым строкам. Если это нежелательно, выключайте
  триггер на время backfill: `ALTER TABLE <t> DISABLE TRIGGER trg_<t>_updated_at`
  перед первым `UPDATE` и `ENABLE TRIGGER` после последнего.
- **`CONCURRENTLY` при сбое оставляет нерабочий индекс.** После прогона проверьте:

```sql
SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
WHERE NOT i.indisvalid;
```

Такой индекс снимается `DROP INDEX CONCURRENTLY <name>` и создаётся заново.

---

## 6. Дефекты, вскрытые внедрением раннера

Сверка двух путей (`schema.sql` против миграций) показала, что **чистая
установка была нерабочей**. Три независимые причины, все исправлены:

| Дефект | Следствие |
|---|---|
| `users.platform_role` отсутствовал в `schema.sql`, хотя миграция `0001` его добавляет | `authenticate.ts` выбирает эту колонку в каждом запросе → аутентификация падала бы на первом обращении |
| Сид использовал `ON CONFLICT (tenant_id, phone)`, а миграция `0008` заменила это ограничение частичным индексом | `there is no unique or exclusion constraint matching…` → владелец не создавался, установка оставалась без пользователей |
| Сид не задавал `activated_at`, а все выборки входа требуют `activated_at IS NOT NULL` | владелец создавался, но войти не мог |

На проде эти расхождения не проявлялись: миграции применялись вручную к уже
работающей БД, а `schema.sql` там выполнялся один раз, до появления большинства
миграций. Ровно эту слепую зону и закрывает раннер.

---

## 7. Проверка на сервере

```bash
cd /opt/getvoxly
PW=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)

docker run --rm --network automation_automation_net \
  -e MIGRATION_DATABASE_URL="postgresql://getvoxly:${PW}@db:5432/getvoxly" \
  -w /app --entrypoint node getvoxly-backend:latest scripts/migrate-status.mjs
```

`--entrypoint node` обязателен: обычный ENTRYPOINT сначала прогнал бы миграции.

Сеть — `automation_automation_net` (внешняя, от стека Nginx Proxy Manager), а не
`getvoxly_default`.

---

## 8. Недавние миграции CRM-раскладки

| Файл | Что делает |
|---|---|
| `0023_record_table_layouts.sql` | персональная раскладка RecordTable (JSONB), FORCE RLS |
| `0024_page_layout_tabs.sql` | вкладки карточек как данные, FORCE RLS |
| `0025_seed_page_layout_tabs.sql` | сид home/tasks/notes (+ chat/files у сделки) для существующих tenant |
| `0026_seed_service_center_tabs.sql` | вкладка `repairs` на контакте у арендаторов с установленным `service_center` |
| `0027_seed_finance_tabs.sql` | вкладка `invoices` на компании у арендаторов с установленным `finance` |

Обе таблицы есть в `schema.sql` (триггеры `updated_at` и список RLS). Новые
арендаторы получают вкладки через `ensureTenantDefaults`, не только миграцией
сида.
