-- Voxly: canonical CRM sidebar order (core.navigationMenuItem).
-- 1 Сделки · 2 Люди · 3 Компании · 4 Рассылка · 5 Задачи · 6 Заметки
-- · 7 Кабинет Voxly · 8 Workflows · 9 Панели управления
-- Safe to re-run on all ACTIVE workspaces.

UPDATE core."navigationMenuItem" AS n
SET position = v.pos,
    "updatedAt" = now()
FROM core."objectMetadata" AS o
JOIN (
  VALUES
    ('opportunity', 0),
    ('person', 1),
    ('company', 2),
    ('task', 4),
    ('note', 5),
    ('dashboard', 8)
) AS v(name_singular, pos) ON o."nameSingular" = v.name_singular
WHERE n."targetObjectMetadataId" = o.id
  AND n."workspaceId" = o."workspaceId"
  AND n.type = 'OBJECT'
  AND n."folderId" IS NULL;

UPDATE core."navigationMenuItem"
SET position = 3, "updatedAt" = now()
WHERE "universalIdentifier" = 'fd4f7581-7979-4d01-ba80-e9921eee9e57';

UPDATE core."navigationMenuItem"
SET position = 6, "updatedAt" = now()
WHERE "universalIdentifier" = 'b29d4371-b02a-456e-a848-d09209052bb5';

UPDATE core."navigationMenuItem"
SET position = 7, "updatedAt" = now()
WHERE type = 'FOLDER'
  AND "folderId" IS NULL
  AND (
    lower(btrim(name)) = lower('Workflows')
    OR "universalIdentifier" = '20202020-b007-4b07-8b07-c0aba11c0007'::uuid
  );

UPDATE core.workspace
SET "metadataVersion" = "metadataVersion" + 1,
    "updatedAt" = now()
WHERE "activationStatus" = 'ACTIVE';
