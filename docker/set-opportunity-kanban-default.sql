-- Voxly: Opportunity views — default «Канбан» (board) + secondary «Списком» (table).
-- Twenty opens /objects/opportunities on key = INDEX (seeded as TABLE «All …»).
-- updateView GraphQL cannot set `key`; GraphQL type/icon often land in view.overrides
-- while columns stay TABLE/IconList — UI then shows a second fake kanban «All Сделки».
--
-- Re-apply after Twenty DB reset / new workspace seed:
--   docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty \
--     < docker/set-opportunity-kanban-default.sql

BEGIN;

-- Drop INDEX from the seeded table view for opportunities.
UPDATE core.view AS v
SET
  key = NULL,
  position = GREATEST(v.position, 2),
  "updatedAt" = now()
FROM core."objectMetadata" AS o
WHERE v."objectMetadataId" = o.id
  AND o."nameSingular" = 'opportunity'
  AND v."deletedAt" IS NULL
  AND v.key = 'INDEX'
  AND v.type = 'TABLE';

-- Prefer «By Stage» / stage-grouped kanban as the new INDEX.
UPDATE core.view AS v
SET
  key = 'INDEX',
  position = 0,
  "updatedAt" = now()
FROM core."objectMetadata" AS o
WHERE v."objectMetadataId" = o.id
  AND o."nameSingular" = 'opportunity'
  AND v."deletedAt" IS NULL
  AND v.type = 'KANBAN'
  AND v.key IS NULL
  AND v."mainGroupByFieldMetadataId" IS NOT NULL
  AND (
    v.name ILIKE '%stage%'
    OR v.name ILIKE '%этап%'
    OR v.name = 'By Stage'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM core.view AS v2
    WHERE v2."objectMetadataId" = v."objectMetadataId"
      AND v2."workspaceId" = v."workspaceId"
      AND v2."deletedAt" IS NULL
      AND v2.key = 'INDEX'
  );

-- Rename default Opportunity INDEX board to «Канбан» (view selector label).
UPDATE core.view AS v
SET
  name = 'Канбан',
  icon = 'IconLayoutKanban',
  "updatedAt" = now()
FROM core."objectMetadata" AS o
WHERE v."objectMetadataId" = o.id
  AND o."nameSingular" = 'opportunity'
  AND v."deletedAt" IS NULL
  AND v.key = 'INDEX'
  AND (
    v.name IS DISTINCT FROM 'Канбан'
    OR v.icon IS DISTINCT FROM 'IconLayoutKanban'
  )
  AND (
    v.name = 'Канбан'
    OR v.name ILIKE 'All%'
    OR v.name ILIKE 'Все%'
    OR v.name ILIKE '%Opportunit%'
    OR v.name ILIKE '%Возможност%'
    OR v.name ILIKE '%Сделк%'
    OR v.name ILIKE '%stage%'
    OR v.name ILIKE '%этап%'
    OR v.name = 'By Stage'
    OR v.name ILIKE '%{objectLabelPlural}%'
  );

-- Demoted / seeded table views → «Списком» (real TABLE, list icon).
-- Strip GraphQL overrides that force type=KANBAN / IconLayoutKanban on the UI.
UPDATE core.view AS v
SET
  name = 'Списком',
  type = 'TABLE',
  icon = 'IconList',
  "mainGroupByFieldMetadataId" = NULL,
  "kanbanColumnWidth" = NULL,
  overrides = CASE
    WHEN v.overrides IS NULL THEN NULL
    ELSE (
      v.overrides
      - 'type'
      - 'icon'
      - 'mainGroupByFieldMetadataId'
      - 'kanbanColumnWidth'
      - 'kanbanAggregateOperation'
      - 'kanbanAggregateOperationFieldMetadataId'
    )
  END,
  position = GREATEST(COALESCE(v.position, 0), 1),
  "updatedAt" = now()
FROM core."objectMetadata" AS o
WHERE v."objectMetadataId" = o.id
  AND o."nameSingular" = 'opportunity'
  AND v."deletedAt" IS NULL
  AND v.key IS DISTINCT FROM 'INDEX'
  AND v.type IN ('TABLE', 'KANBAN')
  AND (
    v.name ILIKE 'All%'
    OR v.name ILIKE 'Все%'
    OR v.name ILIKE '%Opportunit%'
    OR v.name ILIKE '%Возможност%'
    OR v.name ILIKE '%{objectLabelPlural}%'
    OR v.name IN ('Список', 'Списком', 'List', 'Table')
    OR COALESCE(v.overrides->>'type', '') = 'KANBAN'
    OR COALESCE(v.overrides->>'icon', '') ILIKE '%Kanban%'
    OR v.icon ILIKE '%Kanban%'
    OR v.icon = 'LayoutKanban'
  );

-- Soft-delete duplicate list views (keep one «Списком» per workspace object).
WITH ranked AS (
  SELECT
    v.id,
    ROW_NUMBER() OVER (
      PARTITION BY v."workspaceId", v."objectMetadataId"
      ORDER BY
        CASE WHEN v.name = 'Списком' AND v.type = 'TABLE' THEN 0 ELSE 1 END,
        v."isCustom" ASC,
        v."createdAt" ASC,
        v.id ASC
    ) AS rn
  FROM core.view AS v
  JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
  WHERE o."nameSingular" = 'opportunity'
    AND v."deletedAt" IS NULL
    AND v.key IS DISTINCT FROM 'INDEX'
    AND v.type = 'TABLE'
    AND (
      v.name = 'Списком'
      OR v.name = 'Список'
      OR v.name ILIKE 'All%'
      OR v.name ILIKE '%{objectLabelPlural}%'
    )
)
UPDATE core.view AS v
SET
  "deletedAt" = now(),
  "updatedAt" = now()
FROM ranked AS r
WHERE v.id = r.id
  AND r.rn > 1;

-- RU object labels for Opportunity (GraphQL cannot set isLabelSyncedWithName on standard objects).
UPDATE core."objectMetadata" AS o
SET
  "labelSingular" = 'Сделка',
  "labelPlural" = 'Сделки',
  "isLabelSyncedWithName" = false,
  "updatedAt" = now()
WHERE o."nameSingular" = 'opportunity'
  AND (
    o."labelSingular" IS DISTINCT FROM 'Сделка'
    OR o."labelPlural" IS DISTINCT FROM 'Сделки'
    OR COALESCE(o."isLabelSyncedWithName", true) IS DISTINCT FROM false
  );

COMMIT;

-- Stage pipeline = john-crm golden board (enum + options + viewGroups).
-- Run after COMMIT: ALTER TYPE ADD/RENAME should not share the labels txn.
-- For a single workspace, prefer ensureOpportunityRuDefaults(workspaceId) in saas-api.
-- Bulk (all active workspaces) — mirror of TS ensureOpportunityStagePipeline:

DO $$
DECLARE
  r record;
  has_new boolean;
  has_novyy boolean;
  has_customer boolean;
  has_success boolean;
  has_lost boolean;
  stage_json jsonb := '[
    {"id":"20202020-8e01-4afd-9c39-d2063097587a","color":"red","label":"Новый лид","value":"NOVYY_LID","position":0},
    {"id":"20202020-e685-4671-ac32-26d304dacb6e","color":"purple","label":"Screening","value":"SCREENING","position":1},
    {"id":"20202020-dde9-4acc-b5ca-f6531a8ecb4a","color":"sky","label":"Meeting","value":"MEETING","position":2},
    {"id":"20202020-696e-4f6b-91bc-f413e9b2f654","color":"turquoise","label":"Proposal","value":"PROPOSAL","position":3},
    {"id":"20202020-0bb5-4a6f-a8b2-774bbad21104","color":"green","label":"Успешная сделка","value":"USPESHNAYA_SDELKA","position":4},
    {"id":"bb012687-b6a9-4e1a-8f52-dcce5e0f310a","color":"red","label":"Сделка провалена","value":"SDELKA_PROVALENA","position":5}
  ]'::jsonb;
BEGIN
  FOR r IN
    SELECT w.id AS workspace_id, w."databaseSchema" AS sch
    FROM core.workspace w
    WHERE w."deletedAt" IS NULL
      AND w."activationStatus" = 'ACTIVE'
      AND w."databaseSchema" IS NOT NULL
      AND w."databaseSchema" ~ '^[a-zA-Z_][a-zA-Z0-9_]*$'
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = r.sch AND t.typname = 'opportunity_stage_enum' AND e.enumlabel = 'NEW'
    ) INTO has_new;
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = r.sch AND t.typname = 'opportunity_stage_enum' AND e.enumlabel = 'NOVYY_LID'
    ) INTO has_novyy;
    IF has_new AND NOT has_novyy THEN
      EXECUTE format('ALTER TYPE %I.opportunity_stage_enum RENAME VALUE %L TO %L', r.sch, 'NEW', 'NOVYY_LID');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = r.sch AND t.typname = 'opportunity_stage_enum' AND e.enumlabel = 'CUSTOMER'
    ) INTO has_customer;
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = r.sch AND t.typname = 'opportunity_stage_enum' AND e.enumlabel = 'USPESHNAYA_SDELKA'
    ) INTO has_success;
    IF has_customer AND NOT has_success THEN
      EXECUTE format('ALTER TYPE %I.opportunity_stage_enum RENAME VALUE %L TO %L', r.sch, 'CUSTOMER', 'USPESHNAYA_SDELKA');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = r.sch AND t.typname = 'opportunity_stage_enum' AND e.enumlabel = 'SDELKA_PROVALENA'
    ) INTO has_lost;
    IF NOT has_lost THEN
      EXECUTE format('ALTER TYPE %I.opportunity_stage_enum ADD VALUE IF NOT EXISTS %L', r.sch, 'SDELKA_PROVALENA');
    END IF;

    UPDATE core."fieldMetadata" fm
    SET options = stage_json, "updatedAt" = now()
    FROM core."objectMetadata" o
    WHERE fm."objectMetadataId" = o.id
      AND o."workspaceId" = r.workspace_id
      AND o."nameSingular" = 'opportunity'
      AND fm.name = 'stage'
      AND fm.options IS DISTINCT FROM stage_json;

    UPDATE core."viewGroup" vg
    SET "fieldValue" = 'NOVYY_LID', "updatedAt" = now()
    FROM core.view v
    JOIN core."objectMetadata" o ON o.id = v."objectMetadataId"
    WHERE vg."viewId" = v.id
      AND o."workspaceId" = r.workspace_id
      AND o."nameSingular" = 'opportunity'
      AND v.key = 'INDEX' AND v.type = 'KANBAN'
      AND v."deletedAt" IS NULL AND vg."deletedAt" IS NULL
      AND vg."fieldValue" = 'NEW';

    UPDATE core."viewGroup" vg
    SET "fieldValue" = 'USPESHNAYA_SDELKA', "updatedAt" = now()
    FROM core.view v
    JOIN core."objectMetadata" o ON o.id = v."objectMetadataId"
    WHERE vg."viewId" = v.id
      AND o."workspaceId" = r.workspace_id
      AND o."nameSingular" = 'opportunity'
      AND v.key = 'INDEX' AND v.type = 'KANBAN'
      AND v."deletedAt" IS NULL AND vg."deletedAt" IS NULL
      AND vg."fieldValue" = 'CUSTOMER';
  END LOOP;
END $$;

UPDATE core.view AS v
SET
  "openRecordIn" = 'SIDE_PANEL',
  overrides = COALESCE(v.overrides, '{}'::jsonb) || '{"kanbanColumnWidth": 320}'::jsonb,
  "updatedAt" = now()
FROM core."objectMetadata" AS o
WHERE v."objectMetadataId" = o.id
  AND o."nameSingular" = 'opportunity'
  AND v."deletedAt" IS NULL
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN';

-- Lock system stages (Новый лид / Успешная / Провалена). Middle stages stay editable.
-- Same functions as ensureOpportunityStageLockTrigger in saas-api.
CREATE OR REPLACE FUNCTION core.voxly_merge_locked_opportunity_stages(opts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  locked_first jsonb := '{"id":"20202020-8e01-4afd-9c39-d2063097587a","color":"red","label":"Новый лид","value":"NOVYY_LID","position":0}'::jsonb;
  locked_won jsonb := '{"id":"20202020-0bb5-4a6f-a8b2-774bbad21104","color":"green","label":"Успешная сделка","value":"USPESHNAYA_SDELKA","position":4}'::jsonb;
  locked_lost jsonb := '{"id":"bb012687-b6a9-4e1a-8f52-dcce5e0f310a","color":"red","label":"Сделка провалена","value":"SDELKA_PROVALENA","position":5}'::jsonb;
  locked_ids text[] := ARRAY[
    '20202020-8e01-4afd-9c39-d2063097587a',
    '20202020-0bb5-4a6f-a8b2-774bbad21104',
    'bb012687-b6a9-4e1a-8f52-dcce5e0f310a'
  ];
  default_middle jsonb := '[
    {"id":"20202020-e685-4671-ac32-26d304dacb6e","color":"purple","label":"Screening","value":"SCREENING","position":1},
    {"id":"20202020-dde9-4acc-b5ca-f6531a8ecb4a","color":"sky","label":"Meeting","value":"MEETING","position":2},
    {"id":"20202020-696e-4f6b-91bc-f413e9b2f654","color":"turquoise","label":"Proposal","value":"PROPOSAL","position":3}
  ]'::jsonb;
  middle jsonb := '[]'::jsonb;
  elem jsonb;
  i int := 0;
  result jsonb;
BEGIN
  IF opts IS NULL OR jsonb_typeof(opts) IS DISTINCT FROM 'array' OR jsonb_array_length(opts) = 0 THEN
    middle := default_middle;
  ELSE
    FOR elem IN SELECT value FROM jsonb_array_elements(opts)
    LOOP
      IF NOT (elem->>'id' = ANY (locked_ids)) THEN
        middle := middle || jsonb_build_array(
          jsonb_set(elem, '{position}', to_jsonb(i + 1), true)
        );
        i := i + 1;
      END IF;
    END LOOP;
    IF jsonb_array_length(middle) = 0 THEN
      middle := default_middle;
      i := jsonb_array_length(middle);
    END IF;
  END IF;

  locked_won := jsonb_set(locked_won, '{position}', to_jsonb(i + 1), true);
  locked_lost := jsonb_set(locked_lost, '{position}', to_jsonb(i + 2), true);
  result := jsonb_build_array(locked_first) || middle || jsonb_build_array(locked_won, locked_lost);
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION core.voxly_lock_opportunity_stage_options()
RETURNS trigger
LANGUAGE plpgsql
AS $tg$
BEGIN
  IF NEW.name IS DISTINCT FROM 'stage' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core."objectMetadata" o
    WHERE o.id = NEW."objectMetadataId"
      AND o."nameSingular" = 'opportunity'
  ) THEN
    RETURN NEW;
  END IF;
  NEW.options := core.voxly_merge_locked_opportunity_stages(NEW.options);
  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_voxly_lock_opportunity_stage_options ON core."fieldMetadata";
CREATE TRIGGER trg_voxly_lock_opportunity_stage_options
  BEFORE INSERT OR UPDATE OF options ON core."fieldMetadata"
  FOR EACH ROW
  EXECUTE FUNCTION core.voxly_lock_opportunity_stage_options();

-- Verification helper (read-only):
-- SELECT w.subdomain, v.name, v.type, v.key, v.icon, v.overrides
-- FROM core.view v
-- JOIN core."objectMetadata" o ON o.id = v."objectMetadataId"
-- JOIN core.workspace w ON w.id = v."workspaceId"
-- WHERE o."nameSingular" = 'opportunity' AND v."deletedAt" IS NULL
--   AND v.type NOT IN ('FIELDS_WIDGET', 'TABLE_WIDGET')
-- ORDER BY w.subdomain, v.position, v.name;
