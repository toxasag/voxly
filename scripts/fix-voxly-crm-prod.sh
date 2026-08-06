#!/usr/bin/env bash
# One-off prod fix for voxly CRM workspace (nav + profile + kanban redis).
set -euo pipefail

WS="${1:-203f6a07-cac2-47db-a15e-e74f9c374ccb}"
SCHEMA="${2:-workspace_1wq8yf0onztgj481pz4llos0b}"
OWNER_EMAIL="${3:-anton@genadich.com}"
OWNER_FIRST="${4:-voxly}"

echo "Fixing workspace $WS ..."

docker exec -i docker-postgres-twenty-1 psql -U twenty -d twenty <<SQL
UPDATE core."navigationMenuItem" AS n
SET position = v.pos, "updatedAt" = now()
FROM core."objectMetadata" AS o
JOIN (VALUES
  ('opportunity', 0), ('person', 1), ('company', 2),
  ('task', 4), ('note', 5), ('dashboard', 8)
) AS v(name_singular, pos) ON o."nameSingular" = v.name_singular
WHERE n."targetObjectMetadataId" = o.id AND n."workspaceId" = '${WS}'::uuid
  AND o."workspaceId" = '${WS}'::uuid AND n.type = 'OBJECT' AND n."folderId" IS NULL;

UPDATE core."navigationMenuItem" SET position = 3, "updatedAt" = now()
WHERE "workspaceId" = '${WS}'::uuid AND "universalIdentifier" = 'fd4f7581-7979-4d01-ba80-e9921eee9e57';

UPDATE core."navigationMenuItem" SET position = 6, "updatedAt" = now()
WHERE "workspaceId" = '${WS}'::uuid AND "universalIdentifier" = 'b29d4371-b02a-456e-a848-d09209052bb5';

UPDATE core."navigationMenuItem" SET position = 7, "updatedAt" = now()
WHERE "workspaceId" = '${WS}'::uuid AND type = 'FOLDER' AND "folderId" IS NULL
  AND (lower(btrim(name)) = lower('Workflows') OR "universalIdentifier" = '20202020-b007-4b07-8b07-c0aba11c0007'::uuid);

UPDATE "${SCHEMA}"."workspaceMember"
SET "nameFirstName" = COALESCE(NULLIF(btrim("nameFirstName"), ''), '${OWNER_FIRST}'),
    "updatedAt" = now()
WHERE lower(trim("userEmail")) = lower('${OWNER_EMAIL}') AND "deletedAt" IS NULL
  AND NULLIF(btrim("nameFirstName"), '') IS NULL;

UPDATE core.workspace SET "metadataVersion" = "metadataVersion" + 1 WHERE id = '${WS}'::uuid;
SQL

docker exec docker-redis-1 redis-cli --scan --pattern "*${WS}*" | xargs -r docker exec -i docker-redis-1 redis-cli DEL || true

echo "Nav order:"
docker exec docker-postgres-twenty-1 psql -U twenty -d twenty -c "
SELECT n.position, COALESCE(n.name, o.\"labelPlural\") AS label
FROM core.\"navigationMenuItem\" n
LEFT JOIN core.\"objectMetadata\" o ON o.id = n.\"targetObjectMetadataId\"
WHERE n.\"workspaceId\" = '${WS}' AND n.\"folderId\" IS NULL AND n.type IN ('OBJECT','LINK','FOLDER')
ORDER BY n.position;"

echo "Kanban view:"
docker exec docker-postgres-twenty-1 psql -U twenty -d twenty -c "
SELECT v.name, v.type, (SELECT count(*) FROM core.\"viewGroup\" vg WHERE vg.\"viewId\"=v.id) groups
FROM core.view v JOIN core.\"objectMetadata\" o ON o.id=v.\"objectMetadataId\"
WHERE o.\"workspaceId\"='${WS}' AND o.\"nameSingular\"='opportunity' AND v.key='INDEX';"

echo "Member:"
docker exec docker-postgres-twenty-1 psql -U twenty -d twenty -c "
SELECT \"nameFirstName\", \"nameLastName\", \"userEmail\" FROM \"${SCHEMA}\".\"workspaceMember\" WHERE \"deletedAt\" IS NULL;"
