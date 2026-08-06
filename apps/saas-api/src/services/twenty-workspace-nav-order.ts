/**
 * Voxly CRM sidebar order (top-level «Рабочая область»):
 * 1 Сделки · 2 Люди · 3 Компании · 4 Рассылка · 5 Задачи · 6 Заметки
 * · 7 Кабинет Voxly · 8 Workflows · 9 Панели управления
 *
 * Positions are 0-based on core.navigationMenuItem (OBJECT rows + app LINK/FOLDER).
 */
import pg from 'pg';

/** From twenty-app/voxly-crm-chat universal-identifiers.ts */
const CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER = 'b29d4371-b02a-456e-a848-d09209052bb5';
const MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER = 'fd4f7581-7979-4d01-ba80-e9921eee9e57';

const OBJECT_NAV_POSITIONS: Record<string, number> = {
  opportunity: 0,
  person: 1,
  company: 2,
  task: 4,
  note: 5,
  dashboard: 8,
};

export async function ensureWorkspaceNavOrder(workspaceId: string): Promise<number> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[provisioning] TWENTY_DATABASE_URL unset — skip workspace nav order',
    );
    return 0;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    let updated = 0;

    for (const [nameSingular, position] of Object.entries(OBJECT_NAV_POSITIONS)) {
      const result = await client.query(
        `UPDATE core."navigationMenuItem" AS n
         SET position = $3,
             "updatedAt" = now()
         FROM core."objectMetadata" AS o
         WHERE n."targetObjectMetadataId" = o.id
           AND n."workspaceId" = $1::uuid
           AND o."workspaceId" = $1::uuid
           AND o."nameSingular" = $2
           AND n.type = 'OBJECT'
           AND n."folderId" IS NULL
           AND n.position IS DISTINCT FROM $3`,
        [workspaceId, nameSingular, position],
      );
      updated += result.rowCount ?? 0;
    }

    const folderUpdates: Array<[string, number]> = [
      [MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER, 3],
      [CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER, 6],
    ];

    for (const [universalId, position] of folderUpdates) {
      const result = await client.query(
        `UPDATE core."navigationMenuItem"
         SET position = $3,
             "updatedAt" = now()
         WHERE "workspaceId" = $1::uuid
           AND "universalIdentifier" = $2::uuid
           AND position IS DISTINCT FROM $3`,
        [workspaceId, universalId, position],
      );
      updated += result.rowCount ?? 0;
    }

    const workflows = await client.query(
      `UPDATE core."navigationMenuItem"
       SET position = 7,
           "updatedAt" = now()
       WHERE "workspaceId" = $1::uuid
         AND type = 'FOLDER'
         AND (
           lower(btrim(name)) = lower('Workflows')
           OR "universalIdentifier" = '20202020-b007-4b07-8b07-c0aba11c0007'::uuid
         )
         AND "folderId" IS NULL
         AND position IS DISTINCT FROM 7`,
      [workspaceId],
    );
    updated += workflows.rowCount ?? 0;

    if (updated > 0) {
      await client.query(
        `UPDATE core.workspace
         SET "metadataVersion" = "metadataVersion" + 1,
             "updatedAt" = now()
         WHERE id = $1::uuid`,
        [workspaceId],
      );
    }

    console.log(
      `[provisioning] workspace nav order: updated=${updated} workspaceId=${workspaceId}`,
    );
    return updated;
  } finally {
    await client.end();
  }
}
