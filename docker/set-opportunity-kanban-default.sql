-- Voxly: make Opportunity «By Stage» kanban the default INDEX view.
-- Twenty opens /objects/opportunities on the view with key = INDEX (seeded as TABLE).
-- updateView GraphQL cannot set `key`, so this is applied via SQL.
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

COMMIT;

-- Verification helper (read-only):
-- SELECT w.subdomain, v.name, v.type, v.key, v.position
-- FROM core.view v
-- JOIN core."objectMetadata" o ON o.id = v."objectMetadataId"
-- JOIN core.workspace w ON w.id = v."workspaceId"
-- WHERE o."nameSingular" = 'opportunity' AND v."deletedAt" IS NULL
-- ORDER BY w.subdomain, v.position, v.name;
