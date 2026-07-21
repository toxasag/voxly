-- Voxly: Opportunity INDEX kanban presentation defaults for all workspaces.
-- - Column width 320 (stored in view.overrides.kanbanColumnWidth)
-- - Note object label = bodyV2 (show note text on kanban, not title)
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

-- 2) Note label identifier → bodyV2 (RICH_TEXT body), not title
UPDATE core."objectMetadata" o
SET "labelIdentifierFieldMetadataId" = f.id
FROM core."fieldMetadata" f
WHERE f."objectMetadataId" = o.id
  AND o."nameSingular" = 'note'
  AND f.name = 'bodyV2'
  AND o."labelIdentifierFieldMetadataId" IS DISTINCT FROM f.id;

-- Bump metadata so workspaces refresh caches
UPDATE core.workspace
SET "metadataVersion" = "metadataVersion" + 1
WHERE "activationStatus" = 'ACTIVE';
