-- Voxly: Opportunity INDEX kanban presentation defaults for all workspaces.
-- - Column width 320 (stored in view.overrides.kanbanColumnWidth)
-- - Note chips show body text via title label (TEXT). bodyV2 is RICH_TEXT and
--   stringifies to "[object Object]" when used as labelIdentifier — do not use it.
-- Safe to re-run.

-- 1) Kanban column width on Opportunity INDEX views
UPDATE core.view v
SET overrides = COALESCE(v.overrides, '{}'::jsonb) || '{"kanbanColumnWidth": 320}'::jsonb
FROM core."objectMetadata" o
WHERE o.id = v."objectMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND COALESCE(v.overrides->>'kanbanColumnWidth', '') IS DISTINCT FROM '320';

-- Also set the typed column when present / used by GraphQL DTO
UPDATE core.view v
SET "kanbanColumnWidth" = 320
FROM core."objectMetadata" o
WHERE o.id = v."objectMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND (v."kanbanColumnWidth" IS NULL OR v."kanbanColumnWidth" <> 320);

-- 1b) Widen noteTargets on INDEX kanban cards (100px only shows avatar initial)
UPDATE core."viewField" vf
SET size = 280
FROM core.view v,
     core."objectMetadata" o,
     core."fieldMetadata" f
WHERE vf."viewId" = v.id
  AND o.id = v."objectMetadataId"
  AND f.id = vf."fieldMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND f.name = 'noteTargets'
  AND vf.size IS DISTINCT FROM 280;

-- 2) Note label identifier → title (TEXT). Never bodyV2 (RICH_TEXT).
UPDATE core."objectMetadata" o
SET "labelIdentifierFieldMetadataId" = f.id
FROM core."fieldMetadata" f
WHERE f."objectMetadataId" = o.id
  AND o."nameSingular" = 'note'
  AND f.name = 'title'
  AND o."labelIdentifierFieldMetadataId" IS DISTINCT FROM f.id;

-- 3) Keep note.title in sync with body markdown (kanban chip text = body).
-- Twenty's note editor often sets title = first line of body on save; a narrow
-- UPDATE OF bodyV2Markdown trigger loses to a later title-only UPDATE. Force
-- title ← body on every INSERT/UPDATE when markdown is non-empty.
CREATE OR REPLACE FUNCTION core.voxly_sync_note_title_from_body()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  body_text text;
BEGIN
  body_text := NULLIF(btrim(COALESCE(NEW."bodyV2Markdown", '')), '');
  IF body_text IS NOT NULL THEN
    NEW.title := left(body_text, 2000);
  END IF;
  RETURN NEW;
END;
$$;

-- Newest noteTargets sort first (position ASC on board chips).
CREATE OR REPLACE FUNCTION core.voxly_note_target_latest_first()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Negative epoch ⇒ later inserts get smaller position ⇒ appear first with ASC.
  NEW.position := -EXTRACT(EPOCH FROM clock_timestamp());
  RETURN NEW;
END;
$$;

-- 4) Per-workspace: backfill titles/positions + attach triggers
DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT w."databaseSchema"
    FROM core.workspace w
    WHERE w."deletedAt" IS NULL
      AND w."activationStatus" = 'ACTIVE'
      AND w."databaseSchema" IS NOT NULL
  LOOP
    EXECUTE format(
      'UPDATE %I.note n
       SET title = left(btrim(n."bodyV2Markdown"), 2000)
       WHERE n."deletedAt" IS NULL
         AND n."bodyV2Markdown" IS NOT NULL
         AND btrim(n."bodyV2Markdown") <> ''''
         AND n.title IS DISTINCT FROM left(btrim(n."bodyV2Markdown"), 2000)',
      sch
    );

    -- Latest note per parent target → position 0, then 1, 2… (ASC = latest first)
    EXECUTE format(
      'UPDATE %I."noteTarget" nt
       SET position = ranked.new_pos
       FROM (
         SELECT nt2.id,
           (ROW_NUMBER() OVER (
             PARTITION BY
               nt2."targetOpportunityId",
               nt2."targetPersonId",
               nt2."targetCompanyId"
             ORDER BY n2."createdAt" DESC NULLS LAST
           ) - 1)::float8 AS new_pos
         FROM %I."noteTarget" nt2
         JOIN %I.note n2 ON n2.id = nt2."noteId"
         WHERE nt2."deletedAt" IS NULL
           AND n2."deletedAt" IS NULL
       ) ranked
       WHERE nt.id = ranked.id
         AND nt.position IS DISTINCT FROM ranked.new_pos',
      sch, sch, sch
    );

    EXECUTE format('DROP TRIGGER IF EXISTS voxly_sync_note_title_from_body ON %I.note', sch);
    EXECUTE format(
      'CREATE TRIGGER voxly_sync_note_title_from_body
         BEFORE INSERT OR UPDATE
         ON %I.note
         FOR EACH ROW
         EXECUTE FUNCTION core.voxly_sync_note_title_from_body()',
      sch
    );

    EXECUTE format('DROP TRIGGER IF EXISTS voxly_note_target_latest_first ON %I."noteTarget"', sch);
    EXECUTE format(
      'CREATE TRIGGER voxly_note_target_latest_first
         BEFORE INSERT
         ON %I."noteTarget"
         FOR EACH ROW
         EXECUTE FUNCTION core.voxly_note_target_latest_first()',
      sch
    );
  END LOOP;
END $$;

-- Bump metadata so workspaces refresh caches.
-- IMPORTANT: Twenty also caches objectMetadata in Redis. After changing
-- labelIdentifier, flush keys matching:
--   engine:workspace:flat-maps:object-metadata:<workspaceId>:*
--   engine:workspace:graphql:operations:ObjectMetadataItems:<workspaceId>:*
-- or restart twenty-server. Stale Redis keeps bodyV2 → chip "[object Object]".
UPDATE core.workspace
SET "metadataVersion" = "metadataVersion" + 1
WHERE "activationStatus" = 'ACTIVE';
