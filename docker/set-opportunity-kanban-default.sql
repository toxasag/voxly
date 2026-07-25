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

-- Verification helper (read-only):
-- SELECT w.subdomain, v.name, v.type, v.key, v.icon, v.overrides
-- FROM core.view v
-- JOIN core."objectMetadata" o ON o.id = v."objectMetadataId"
-- JOIN core.workspace w ON w.id = v."workspaceId"
-- WHERE o."nameSingular" = 'opportunity' AND v."deletedAt" IS NULL
--   AND v.type NOT IN ('FIELDS_WIDGET', 'TABLE_WIDGET')
-- ORDER BY w.subdomain, v.position, v.name;
