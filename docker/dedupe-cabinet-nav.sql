-- Voxly: dedupe sidebar «Кабинет Voxly» navigation menu items (core schema).
-- Prefer the row whose universalIdentifier matches the SDK cabinet item;
-- otherwise keep the oldest. Hard-delete extras (no deletedAt column).
-- Safe to re-run.

-- Canonical id from twenty-app/.../cabinet-voxly.ts
-- CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER = b29d4371-b02a-456e-a848-d09209052bb5

WITH ranked AS (
  SELECT
    id,
    "workspaceId",
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId"
      ORDER BY
        CASE
          WHEN "universalIdentifier" = 'b29d4371-b02a-456e-a848-d09209052bb5' THEN 0
          ELSE 1
        END,
        "createdAt" ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM core."navigationMenuItem"
  WHERE lower(btrim(name)) = lower('Кабинет Voxly')
)
DELETE FROM core."navigationMenuItem" n
USING ranked
WHERE n.id = ranked.id
  AND ranked.rn > 1;

UPDATE core.workspace
SET "metadataVersion" = "metadataVersion" + 1
WHERE "activationStatus" = 'ACTIVE';
