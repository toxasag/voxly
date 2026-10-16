-- =============================================================================
-- 0003: Персональные поддомены арендаторов ({slug}.getvoxly.ru)
--
-- Каждый арендатор получает адрес вида firma.getvoxly.ru. Slug хранится в
-- tenants.slug и должен быть уникален глобально (в отличие от почти всех
-- остальных данных, которые уникальны только внутри арендатора): поддомен —
-- это ресурс всей платформы.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT;

-- -----------------------------------------------------------------------------
-- 1. Заполнение существующих арендаторов
-- -----------------------------------------------------------------------------
-- Колонка добавляется как NULL-able, потому что таблица уже содержит строки;
-- сразу NOT NULL сломало бы миграцию. Slug выводится из имени, а при коллизии
-- или пустом результате — из префикса UUID, чтобы гарантировать уникальность
-- без ручного вмешательства.

UPDATE tenants t
SET slug = candidate.value
FROM (
  SELECT
    id,
    COALESCE(
      NULLIF(
        regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
        ''
      ),
      'tenant'
    ) AS value
  FROM tenants
) AS candidate
WHERE t.id = candidate.id
  AND t.slug IS NULL;

-- Обрезка ведущих/замыкающих дефисов, появившихся после regexp_replace.
UPDATE tenants
SET slug = trim(both '-' from slug)
WHERE slug IS NOT NULL AND slug <> trim(both '-' from slug);

-- Фолбэк на id ДО разведения коллизий. Порядок важен: имя вида `--`
-- нормализуется в пустую строку, и если сначала добавить суффикс коллизии,
-- получится `-abc123` — значение с ведущим дефисом, которое не проходит
-- CHECK `tenants_slug_format`. Проверено на данных: миграция падала именно
-- здесь.
UPDATE tenants
SET slug = 'tenant-' || left(replace(id::text, '-', ''), 8)
WHERE slug IS NULL OR length(slug) < 3;

-- Разведение коллизий: второму и последующим арендаторам с тем же slug
-- добавляется префикс id. Выполняется до создания уникального индекса.
UPDATE tenants t
SET slug = t.slug || '-' || left(replace(t.id::text, '-', ''), 6)
FROM (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY created_at) AS rn
  FROM tenants
  WHERE slug IS NOT NULL
) dup
WHERE t.id = dup.id AND dup.rn > 1;

-- Страховка от значений длиннее 63 символов (лимит DNS-метки): длинное
-- название компании плюс суффикс коллизии могли выйти за границу.
UPDATE tenants
SET slug = left(slug, 63)
WHERE length(slug) > 63;

UPDATE tenants
SET slug = trim(both '-' from slug)
WHERE slug <> trim(both '-' from slug);

ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Ограничения
-- -----------------------------------------------------------------------------
-- Уникальность глобальная, а не в рамках арендатора: slug адресует поддомен.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

-- Формат проверяется и в БД, а не только Zod-схемой: slug попадает в имя
-- хоста, поэтому запись вида `Ф ирма_1` не должна существовать даже при
-- прямом INSERT из psql или будущего скрипта импорта.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_slug_format'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_slug_format CHECK (
      slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
    );
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Зарезервированные поддомены
-- -----------------------------------------------------------------------------
-- Служебные имена нельзя отдавать арендаторам: `api` и `app` уже заняты
-- реальными хостами, остальные — типовые цели фишинга и путаницы. Список
-- лежит в БД, а не только в коде, чтобы проверка не обходилась при прямой
-- вставке.

CREATE TABLE IF NOT EXISTS reserved_slugs (
  slug TEXT PRIMARY KEY
);

INSERT INTO reserved_slugs (slug) VALUES
  ('api'), ('app'), ('www'), ('admin'), ('superadmin'), ('mail'), ('smtp'),
  ('ftp'), ('ns1'), ('ns2'), ('cdn'), ('static'), ('assets'), ('status'),
  ('help'), ('support'), ('docs'), ('blog'), ('billing'), ('pay'), ('login'),
  ('auth'), ('register'), ('dashboard'), ('test'), ('staging'), ('dev'),
  ('n8n'), ('baserow'), ('nocodb'), ('npm'), ('getvoxly')
ON CONFLICT (slug) DO NOTHING;

-- Уже существующие арендаторы не должны занимать зарезервированное имя.
UPDATE tenants t
SET slug = t.slug || '-' || left(replace(t.id::text, '-', ''), 6)
WHERE EXISTS (SELECT 1 FROM reserved_slugs r WHERE r.slug = t.slug);

-- reserved_slugs — платформенный справочник, читается до появления
-- tenant-контекста (при регистрации пользователь ещё не привязан к
-- арендатору), поэтому вне RLS. Права нужны явно: app_user не владелец.
GRANT SELECT ON reserved_slugs TO app_user;
