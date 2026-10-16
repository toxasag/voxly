-- =============================================================================
-- Контакт: ФИО, множественные телефоны и соцсети, необязательная компания.
--
-- Источник модели — Twenty:
--   packages/twenty-shared/src/types/composite-types/phones.composite-type.ts
--   packages/twenty-server/src/modules/person/standard-objects/person.workspace-entity.ts
--
-- У них PHONES хранится основным номером в трёх колонках
-- (primaryPhoneNumber / primaryPhoneCountryCode / primaryPhoneCallingCode) плюс
-- JSONB `additionalPhones` с массивом {number, countryCode, callingCode}. Здесь
-- та же схема: существующая колонка `phone` остаётся основным номером (её читают
-- crm-pipeline и поиск по телефону), рядом появляются код страны, код звонка и
-- JSONB для дополнительных. Отдельная таблица телефонов дала бы JOIN на каждом
-- чтении списка ради данных, которые всегда нужны целиком вместе с контактом.
--
-- Соцсети — один JSONB-массив {kind, value}: у Twenty под каждую сеть отдельное
-- поле LINKS, но у них состав сетей меняется миграцией метаданных, а у нас
-- пользователь добавляет мессенджеры сам. Существующие telegram_username и
-- whatsapp остаются: их читает транспорт каналов по имени колонки.
--
-- Обязательность полей: у Twenty на Person нет ни одного NOT NULL среди
-- name/phones/company — обязательно только имя на уровне интерфейса. Здесь
-- снимаются NOT NULL с last_name, phone и company_name.
--
-- ВРЕМЯ БЛОКИРОВКИ. Раннер оборачивает миграцию в одну транзакцию
-- (node-pg-migrate, single-transaction по умолчанию), поэтому ACCESS EXCLUSIVE,
-- взятый первым ALTER TABLE, держится до конца файла. Отсюда два решения:
--  - CHECK и FOREIGN KEY добавляются как NOT VALID, а VALIDATE выносится в
--    отдельную миграцию 0021: валидация NOT VALID-ограничения берёт
--    SHARE UPDATE EXCLUSIVE и не блокирует ни чтение, ни запись;
--  - индексы тоже уходят в 0021 и строятся CONCURRENTLY.
-- Здесь остаются только быстрый DDL и разовый backfill, который иначе выполнить
-- нечем: данные исторические, фильтровать их по дате по смыслу нельзя.
-- =============================================================================

-- Метка backfill: она отключает триггер updated_at ------------------------------
--
-- На contacts висит BEFORE UPDATE ... set_updated_at(), который безусловно
-- ставит now(). Массовый backfill через него переписал бы дату последнего
-- изменения всем контактам, и «недавно изменённые» после выкладки показали бы
-- всю таблицу. Триггер выключается на время миграции и включается в конце.
--
-- DISABLE TRIGGER берёт ACCESS EXCLUSIVE, но он и так уже удерживается
-- транзакцией — дополнительной блокировки это не добавляет.
ALTER TABLE contacts DISABLE TRIGGER trg_contacts_updated_at;

-- ФИО -------------------------------------------------------------------------

-- Отчество: русская специфика, у Twenty в FULL_NAME только firstName/lastName.
-- Пустая строка вместо NULL — как у остальных наших текстовых полей карточки,
-- чтобы UI не разбирал два вида «не заполнено».
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS middle_name TEXT NOT NULL DEFAULT '';

-- Фамилия перестаёт быть обязательной: клиент часто известен только по имени
-- (входящее сообщение в мессенджере), и требовать фамилию значило бы записывать
-- в неё мусор вроде «-».
ALTER TABLE contacts ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE contacts ALTER COLUMN last_name SET DEFAULT '';
UPDATE contacts SET last_name = '' WHERE last_name IS NULL;

-- Телефоны --------------------------------------------------------------------

-- Основной номер перестаёт быть обязательным: контакт может прийти из e-mail
-- или из Telegram, где номер скрыт настройками приватности.
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE contacts ALTER COLUMN phone SET DEFAULT '';
UPDATE contacts SET phone = '' WHERE phone IS NULL;

-- Twenty: primaryPhoneCountryCode — ISO-2 код страны ('RU'). Хранится отдельно
-- от кода звонка, потому что один код звонка принадлежит нескольким странам
-- (+1 — США и Канада), и без ISO-кода не выбрать флаг в селекторе.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_country_code TEXT NOT NULL DEFAULT '';

-- Twenty: primaryPhoneCallingCode — префикс набора со знаком плюс ('+7').
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_calling_code TEXT NOT NULL DEFAULT '';

-- Twenty: additionalPhones (RAW_JSON). Массив объектов
-- {number, countryCode, callingCode}; основной номер в него не входит.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS additional_phones JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Структура проверяется в БД, а не только в Zod: этот JSONB пишут ещё и
-- crm-pipeline с импортом, и битый элемент массива иначе всплыл бы уже на
-- отрисовке карточки.
--
-- Проверка через jsonb_path_exists, а не подзапросом с jsonb_array_elements:
-- PostgreSQL отвергает подзапрос в CHECK («cannot use subquery in check
-- constraint»). Проверено на postgres:16 — вариант с EXISTS не создаётся.
--
-- NOT VALID: существующие строки заведомо проходят проверку — колонка только что
-- создана с DEFAULT '[]'. Полный скан с вызовом jsonb_path_exists на каждую
-- строку под ACCESS EXCLUSIVE был бы дорогим и бесполезным. VALIDATE — в 0021.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_additional_phones_shape;
ALTER TABLE contacts ADD CONSTRAINT contacts_additional_phones_shape CHECK (
  jsonb_typeof(additional_phones) = 'array'
  AND NOT jsonb_path_exists(
    additional_phones,
    '$[*] ? (@.type() != "object" || !(exists(@.number ? (@.type() == "string"))))'
  )
) NOT VALID;

-- Соцсети ---------------------------------------------------------------------

-- Массив {kind, value}: kind — telegram | whatsapp | max | viber | vk |
-- instagram | other, value — username или ссылка. Отдельной таблицы нет по той
-- же причине, что и у телефонов: значения всегда читаются вместе с контактом.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_socials_shape;
ALTER TABLE contacts ADD CONSTRAINT contacts_socials_shape CHECK (
  jsonb_typeof(socials) = 'array'
  AND NOT jsonb_path_exists(
    socials,
    '$[*] ? (@.type() != "object" || !(exists(@.kind ? (@.type() == "string"))) || !(exists(@.value ? (@.type() == "string"))))'
  )
) NOT VALID;

-- Перенос уже заполненных мессенджеров в новый массив. Колонки telegram_username
-- и whatsapp сохраняются: по ним ищет транспорт каналов (channel_accounts) и
-- crm-pipeline при поиске контакта по входящему сообщению.
--
-- Условие «массив пуст, а колонка заполнена» вместо простого «массив пуст»:
-- прогон должен добирать расхождение колонок и массива, а не только полностью
-- пустое состояние. Это важно для догоняющего прогона, если старая версия
-- приложения успела записать контакт уже после первого применения.
UPDATE contacts
SET socials = (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('kind', 'telegram', 'value', telegram_username) AS entry
    WHERE telegram_username IS NOT NULL AND telegram_username <> ''
    UNION ALL
    SELECT jsonb_build_object('kind', 'whatsapp', 'value', whatsapp) AS entry
    WHERE whatsapp IS NOT NULL AND whatsapp <> ''
  ) AS entries
)
WHERE socials = '[]'::jsonb
  AND ((telegram_username IS NOT NULL AND telegram_username <> '')
    OR (whatsapp IS NOT NULL AND whatsapp <> ''));

-- Компания --------------------------------------------------------------------

-- Компания перестаёт быть обязательной: у физлица её нет, а заглушка
-- «Не указана» — именно то, что засоряло список компаний.
ALTER TABLE contacts ALTER COLUMN company_name DROP NOT NULL;
ALTER TABLE contacts ALTER COLUMN company_name SET DEFAULT '';
UPDATE contacts SET company_name = '' WHERE company_name IS NULL;

-- Снимок исходных значений перед разрушающими шагами.
--
-- Дальше затираются заглушки названий и обнуляются висячие ссылки, а секции Down
-- у SQL-миграций node-pg-migrate нет — единственным откатом иначе оставалось бы
-- восстановление из дампа. Снимок даёт точечный откат и разбор кросс-тенантных
-- ссылок, которые до сих пор были возможны из-за отсутствия FK.
CREATE TABLE IF NOT EXISTS contacts_company_backfill_0020 (
  contact_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  old_company_id UUID,
  old_company_name TEXT,
  /* Ссылка вела на компанию другого арендатора — инцидент изоляции, а не мусор. */
  was_cross_tenant BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO contacts_company_backfill_0020
  (contact_id, tenant_id, old_company_id, old_company_name, was_cross_tenant)
SELECT
  c.id,
  c.tenant_id,
  c.company_id,
  c.company_name,
  c.company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM companies co
    WHERE co.id = c.company_id AND co.tenant_id <> c.tenant_id
  )
FROM contacts c
ON CONFLICT (contact_id) DO NOTHING;

-- Заглушки из автосоздания контактов каналом (crm-pipeline подставлял
-- «Не указана») очищаются: это не название компании, а отсутствие данных.
--
-- Односимвольные прочерки чистятся только вместе с отсутствующей связью: у
-- контакта со связанной компанией «-» в названии не заглушка, а расхождение,
-- которое ниже перезапишется названием самой компании.
UPDATE contacts
SET company_name = ''
WHERE company_name IN ('Не указана', 'Не указано')
   OR (company_name IN ('—', '-') AND company_id IS NULL);

-- Ссылка на компанию получает настоящий внешний ключ. До этой миграции
-- company_id был UUID без REFERENCES, поэтому в нём мог оказаться идентификатор
-- удалённой компании, а карточка молча показывала пустую связь.
--
-- Условие включает сверку арендатора: без неё ссылка на компанию ДРУГОГО
-- арендатора проходила проверку (компания существует), принималась внешним
-- ключом и ниже подставляла чужое название в contacts.company_name. FK по
-- одному id этого не ловит — составного ключа (id, tenant_id) у companies нет.
UPDATE contacts c
SET company_id = NULL
WHERE company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM companies co
    WHERE co.id = c.company_id AND co.tenant_id = c.tenant_id
  );

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_company_id_fkey;
-- NOT VALID: висячие ссылки только что обнулены, поэтому скан ничего не найдёт,
-- а валидация под ACCESS EXCLUSIVE держала бы ещё и SHARE ROW EXCLUSIVE на
-- companies до конца миграции. VALIDATE — в 0021, после индекса по company_id.
ALTER TABLE contacts
  ADD CONSTRAINT contacts_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  NOT VALID;

-- Компании из названий у контактов -------------------------------------------
--
-- Причина: список компаний был пуст, хотя в контактах названия стояли. Названия
-- лежали строкой в contacts.company_name и не создавали записи в companies —
-- контакт ссылался на компанию, которой не существует. Здесь для каждого
-- непустого названия без company_id создаётся компания того же тенанта и
-- связывается с контактом.
--
-- Сопоставление по нормализованному названию (trim + lower): одна и та же
-- компания записана у разных контактов с разным регистром и пробелами, и без
-- нормализации получилось бы несколько дублей на одну организацию.
WITH missing AS (
  -- DISTINCT ON по ключу, а не DISTINCT по паре (name, name_key): «ООО ТехКорп»
  -- и «ооо техкорп» дают один ключ, но две разные строки name, и без выбора
  -- одного написания вставились бы две компании на одну организацию. Проверено
  -- на postgres:16 — первый вариант миграции создавал ровно такой дубль.
  SELECT DISTINCT ON (c.tenant_id, lower(btrim(c.company_name)))
    c.tenant_id,
    btrim(c.company_name) AS name,
    lower(btrim(c.company_name)) AS name_key
  FROM contacts c
  WHERE c.deleted_at IS NULL
    AND c.company_name IS NOT NULL
    AND btrim(c.company_name) <> ''
    AND c.company_id IS NULL
  -- Каноническим становится написание из самой ранней записи: оно с большей
  -- вероятностью введено вручную, а не восстановлено из переписки.
  ORDER BY c.tenant_id, lower(btrim(c.company_name)), c.created_at ASC
), to_create AS (
  SELECT m.tenant_id, m.name
  FROM missing m
  WHERE NOT EXISTS (
    SELECT 1 FROM companies co
    WHERE co.tenant_id = m.tenant_id
      AND lower(btrim(co.name)) = m.name_key
      AND co.deleted_at IS NULL
  )
)
INSERT INTO companies (tenant_id, name, notes)
SELECT tenant_id, name, 'Создана автоматически из названия у контакта'
FROM to_create;

-- Связывание коррелированным подзапросом с LIMIT 1, а не JOIN-ом: если в тенанте
-- уже были две компании с одинаковым названием, JOIN размножил бы строки
-- обновления и выбор компании оказался бы произвольным. LATERAL здесь не
-- подходит — в UPDATE ... FROM он не видит целевую таблицу («invalid reference
-- to FROM-clause entry»), проверено на postgres:16.
UPDATE contacts c
SET company_id = (
  SELECT co.id
  FROM companies co
  WHERE co.tenant_id = c.tenant_id
    AND co.deleted_at IS NULL
    AND lower(btrim(co.name)) = lower(btrim(c.company_name))
  ORDER BY co.created_at ASC, co.id ASC
  LIMIT 1
)
WHERE c.company_id IS NULL
  AND c.deleted_at IS NULL
  AND c.company_name IS NOT NULL
  AND btrim(c.company_name) <> '';

-- Название у контакта приводится к названию связанной компании: после связывания
-- источник правды один, и расхождение строки с записью снова дало бы «компания
-- есть в контакте, но её нет в списке».
--
-- Сверка арендатора обязательна и здесь: без неё этот шаг копировал бы название
-- компании чужого арендатора в карточку контакта и в его поисковый индекс.
UPDATE contacts c
SET company_name = co.name
FROM companies co
WHERE c.company_id = co.id
  AND co.tenant_id = c.tenant_id
  AND c.deleted_at IS NULL
  AND co.deleted_at IS NULL
  AND c.company_name <> co.name;

-- Триггер возвращается на место: дальнейшие изменения контактов снова должны
-- обновлять updated_at.
ALTER TABLE contacts ENABLE TRIGGER trg_contacts_updated_at;
